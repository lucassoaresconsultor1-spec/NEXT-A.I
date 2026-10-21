import "server-only";
import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { fiscalDocuments, saleItems, sales, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/guard";
import { forbidden, invalid, notFound } from "@/server/errors";
import { pageResult, pageWindow } from "@/server/pagination";
import { salesVisibility } from "@/server/sales/queries";
import { isUuid } from "@/server/stores/schemas";
import type { FiscalStatus } from "./port";
import { getFiscalProvider } from "./registry";
import { acceptProviderStatus, type FiscalFilters } from "./schemas";

// Fiscal documents of completed sales (ADR-005). Without a provider the request
// is recorded as not_configured and the receipt stays "sem valor fiscal". With
// a provider, every fiscal field comes from its answers; nothing is generated
// here. Provider calls run outside database transactions.

const SALE_NOT_FOUND = () => notFound("Venda não encontrada.");
const DOCUMENT_NOT_FOUND = () => notFound("Documento fiscal não encontrado.");

const documentColumns = {
  id: fiscalDocuments.id,
  saleId: fiscalDocuments.saleId,
  storeId: fiscalDocuments.storeId,
  status: fiscalDocuments.status,
  provider: fiscalDocuments.provider,
  providerReference: fiscalDocuments.providerReference,
  accessKey: fiscalDocuments.accessKey,
  number: fiscalDocuments.number,
  series: fiscalDocuments.series,
  protocol: fiscalDocuments.protocol,
  rejectionReason: fiscalDocuments.rejectionReason,
  createdAt: fiscalDocuments.createdAt,
  updatedAt: fiscalDocuments.updatedAt,
};

function assertCanRequest(context: TenantContext) {
  if (!can(context, "sales.read") && !can(context, "sales.create")) throw forbidden();
}

/** Completed (or cancelled) sale visible to the member, with what the provider needs. */
async function loadSale(tx: Tx, context: TenantContext, saleId: string) {
  if (!isUuid(saleId)) throw SALE_NOT_FOUND();
  const orgId = context.organization.id;
  const [sale] = await tx
    .select({ id: sales.id, storeId: sales.storeId, status: sales.status, totalCents: sales.totalCents, storeDocument: stores.document })
    .from(sales)
    .innerJoin(stores, and(eq(stores.organizationId, sales.organizationId), eq(stores.id, sales.storeId)))
    .where(and(eq(sales.organizationId, orgId), eq(sales.id, saleId), salesVisibility(context)));
  if (!sale) throw SALE_NOT_FOUND();
  if (sale.status !== "completed" && sale.status !== "cancelled") throw invalid("Só vendas finalizadas têm documento fiscal.");
  return sale;
}

async function findForSale(tx: Tx, organizationId: string, saleId: string) {
  const [row] = await tx
    .select(documentColumns)
    .from(fiscalDocuments)
    .where(and(eq(fiscalDocuments.organizationId, organizationId), eq(fiscalDocuments.saleId, saleId), eq(fiscalDocuments.kind, "nfce")));
  return row ?? null;
}

async function setStatus(tx: Tx, context: TenantContext, documentId: string, next: ReturnType<typeof acceptProviderStatus>, current: FiscalStatus, storeId: string) {
  await tx
    .update(fiscalDocuments)
    .set({
      status: next.status,
      accessKey: next.accessKey ?? null,
      number: next.number ?? null,
      series: next.series ?? null,
      protocol: next.protocol ?? null,
      rejectionReason: next.rejectionReason ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(fiscalDocuments.organizationId, context.organization.id), eq(fiscalDocuments.id, documentId)));
  if (next.status !== current) {
    await recordAudit(tx, {
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      action: "fiscal_document.status_changed",
      entityType: "fiscal_document",
      entityId: documentId,
      storeId,
      changes: { status: { from: current, to: next.status } },
    });
  }
}

/** One NFC-e request per sale: a second call returns the existing document. */
export async function requestFiscalDocument(context: TenantContext, saleId: string): Promise<{ id: string; status: FiscalStatus }> {
  assertCanRequest(context);
  const orgId = context.organization.id;
  const provider = getFiscalProvider();
  const created = await withScope(dbScope(context), async (tx) => {
    const sale = await loadSale(tx, context, saleId);
    const existing = await findForSale(tx, orgId, sale.id);
    if (existing) return { document: existing, sale, isNew: false };
    const [document] = await tx
      .insert(fiscalDocuments)
      .values({
        organizationId: orgId,
        storeId: sale.storeId,
        saleId: sale.id,
        status: provider ? "pending" : "not_configured",
        provider: provider?.key ?? null,
        requestedBy: context.user.id,
      })
      .onConflictDoNothing()
      .returning(documentColumns);
    if (!document) return { document: (await findForSale(tx, orgId, sale.id))!, sale, isNew: false };
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "fiscal_document.requested",
      entityType: "fiscal_document",
      entityId: document.id,
      storeId: sale.storeId,
      changes: { saleId: sale.id, status: document.status },
    });
    const items = await tx
      .select({ productName: saleItems.productName, variantName: saleItems.variantName, quantity: saleItems.quantity, unitPriceCents: saleItems.unitPriceCents, totalCents: saleItems.totalCents })
      .from(saleItems)
      .where(and(eq(saleItems.organizationId, orgId), eq(saleItems.saleId, sale.id)))
      .orderBy(asc(saleItems.line));
    return { document, sale, isNew: true, items };
  });
  if (!created.isNew || !provider || !("items" in created) || !created.items) return { id: created.document.id, status: created.document.status };

  let answer: { providerReference: string; status: FiscalStatus } | null = null;
  try {
    answer = await provider.issue({
      saleId: created.sale.id,
      storeDocument: created.sale.storeDocument,
      totalCents: created.sale.totalCents,
      items: created.items.map((item) => ({
        description: `${item.productName} ${item.variantName}`.trim(),
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents,
      })),
    });
  } catch (error) {
    // The document stays pending; refreshing later asks the provider again.
    logger.warn({ provider: provider.key, err: { name: (error as Error)?.name } }, "Fiscal provider unavailable");
  }
  if (!answer) return { id: created.document.id, status: "pending" };
  const accepted = acceptProviderStatus({ status: answer.status });
  await withScope(dbScope(context), async (tx) => {
    await tx
      .update(fiscalDocuments)
      .set({ providerReference: answer.providerReference, updatedAt: new Date() })
      .where(and(eq(fiscalDocuments.organizationId, orgId), eq(fiscalDocuments.id, created.document.id)));
    await setStatus(tx, context, created.document.id, accepted, "pending", created.sale.storeId);
  });
  return { id: created.document.id, status: accepted.status };
}

/** Asks the provider for the current state and stores only what it returned. */
export async function refreshFiscalDocument(context: TenantContext, documentId: string): Promise<{ status: FiscalStatus }> {
  assertCanRequest(context);
  if (!isUuid(documentId)) throw DOCUMENT_NOT_FOUND();
  const orgId = context.organization.id;
  const document = await withScope(dbScope(context), async (tx) => {
    const [row] = await tx.select(documentColumns).from(fiscalDocuments).where(and(eq(fiscalDocuments.organizationId, orgId), eq(fiscalDocuments.id, documentId)));
    if (!row) throw DOCUMENT_NOT_FOUND();
    await loadSale(tx, context, row.saleId);
    return row;
  });
  const provider = getFiscalProvider();
  if (!provider || provider.key !== document.provider || !document.providerReference) return { status: document.status };
  const accepted = acceptProviderStatus(await provider.getStatus(document.providerReference));
  await withScope(dbScope(context), (tx) => setStatus(tx, context, document.id, accepted, document.status, document.storeId));
  return { status: accepted.status };
}

/** For the sale detail and the receipt. */
export async function getFiscalDocumentForSale(context: TenantContext, saleId: string) {
  assertCanRequest(context);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const sale = await loadSale(tx, context, saleId);
    return findForSale(tx, orgId, sale.id);
  });
}

export async function listFiscalDocuments(context: TenantContext, filters: FiscalFilters) {
  assertCan(context, "fiscal.read");
  const orgId = context.organization.id;
  const conditions: (SQL | undefined)[] = [eq(fiscalDocuments.organizationId, orgId), storeScopeCondition(context.storeScope, fiscalDocuments.storeId)];
  if (filters.status) conditions.push(eq(fiscalDocuments.status, filters.status));
  if (filters.storeId) conditions.push(eq(fiscalDocuments.storeId, filters.storeId));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(fiscalDocuments).where(where);
    const rows = await tx
      .select({ ...documentColumns, saleNumber: sales.number })
      .from(fiscalDocuments)
      .innerJoin(sales, and(eq(sales.organizationId, fiscalDocuments.organizationId), eq(sales.id, fiscalDocuments.saleId)))
      .where(where)
      // Problems first: rejected, then pending/contingency, then the rest.
      .orderBy(
        asc(sql`case ${fiscalDocuments.status} when 'rejected' then 0 when 'pending' then 1 when 'contingency' then 1 else 2 end`),
        desc(fiscalDocuments.createdAt),
      )
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}
