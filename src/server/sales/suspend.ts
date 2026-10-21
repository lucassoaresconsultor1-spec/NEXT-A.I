import "server-only";
import { randomUUID } from "node:crypto";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq } from "drizzle-orm";
import { customers, saleItems, sales, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, isStoreInScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { loadActiveCustomer } from "@/server/customers/service";
import { invalid, isDomainError, notFound } from "@/server/errors";
import { isWholeQuantity, toDbQuantity } from "@/server/inventory/quantity";
import { releaseReservation, reserveStock } from "@/server/inventory/reservations";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { assertSalesperson, assertStoreActive, byVariant, loadVariants, parse } from "./checks";
import { lineTotals } from "./pricing";
import { discardSchema, suspendSaleSchema } from "./schemas";

// Suspended sales: the cart is kept on the server with its items reserved in
// stock (ADR-015), so another operator of the store can resume it (completion
// consumes the reservations) or discard it (releasing them).

const SALE_NOT_FOUND = () => notFound("Venda não encontrada.");
const operator = alias(users, "suspended_operator");

export async function suspendSale(context: TenantContext, rawInput: unknown): Promise<{ saleId: string }> {
  assertCan(context, "sales.create");
  const input = parse(suspendSaleSchema, rawInput);
  assertStoreInScope(context, input.storeId);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    await assertStoreActive(tx, orgId, input.storeId);
    if (input.customerId && !(await loadActiveCustomer(tx, orgId, input.customerId))) {
      throw invalid("Revise os campos destacados.", { customerId: ["Selecione um cliente ativo."] });
    }
    if (input.salespersonUserId) await assertSalesperson(tx, orgId, input.salespersonUserId, input.storeId);
    const variants = await loadVariants(tx, orgId, input.items.map((item) => item.variantId));
    const errors: Record<string, string[]> = {};
    input.items.forEach((item, index) => {
      const variant = variants.get(item.variantId);
      if (!variant?.sellable) errors[`items.${index}.variantId`] = ["Produto indisponível para venda."];
      else if (variant.priceCents === null) errors[`items.${index}.variantId`] = ["Produto sem preço de venda."];
      else if (variant.unit === "un" && !isWholeQuantity(item.quantity)) errors[`items.${index}.quantity`] = ["Somente números inteiros."];
    });
    if (Object.keys(errors).length > 0) throw invalid("Revise os itens destacados.", errors);

    const saleId = randomUUID();
    const now = new Date();
    await tx.insert(sales).values({
      id: saleId,
      organizationId: orgId,
      storeId: input.storeId,
      status: "suspended",
      operatorUserId: context.user.id,
      salespersonUserId: input.salespersonUserId ?? null,
      customerId: input.customerId ?? null,
      note: input.note ?? null,
      suspendedAt: now,
    });
    const indexOf = new Map(input.items.map((item, index) => [item.variantId, index]));
    for (const item of byVariant(input.items)) {
      const index = indexOf.get(item.variantId)!;
      const variant = variants.get(item.variantId)!;
      let reservationId: string;
      try {
        reservationId = (
          await reserveStock(tx, orgId, { storeId: input.storeId, variantId: item.variantId, quantityMilli: item.quantity, source: "sale", sourceId: saleId, actorUserId: context.user.id })
        ).id;
      } catch (error) {
        if (isDomainError(error) && error.fieldErrors?.quantity) throw invalid("Estoque insuficiente.", { [`items.${index}.quantity`]: error.fieldErrors.quantity });
        throw error;
      }
      const { grossCents } = lineTotals({ quantityMilli: item.quantity, unitPriceCents: variant.priceCents!, discountCents: 0 });
      await tx.insert(saleItems).values({
        organizationId: orgId,
        saleId,
        line: index + 1,
        variantId: item.variantId,
        productName: variant.productName,
        variantName: variant.variantName,
        sku: variant.sku,
        unit: variant.unit,
        quantity: toDbQuantity(item.quantity),
        unitPriceCents: variant.priceCents!,
        discountCents: 0,
        totalCents: grossCents,
        reservationId,
      });
    }
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "sale.suspended",
      entityType: "sale",
      entityId: saleId,
      storeId: input.storeId,
      changes: { itemCount: input.items.length, ...(input.customerId ? { customerId: input.customerId } : {}) },
    });
    return { saleId };
  });
}

/** Suspended sales of a store, for any operator of the store (shift hand-over). */
export async function listSuspendedSales(context: TenantContext, storeId: string) {
  assertCan(context, "sales.create");
  if (!isUuid(storeId) || !isStoreInScope(context.storeScope, storeId)) return [];
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const rows = await tx
      .select({ id: sales.id, createdAt: sales.suspendedAt, operatorName: operator.name, customerName: customers.name, note: sales.note })
      .from(sales)
      .innerJoin(operator, eq(operator.id, sales.operatorUserId))
      .leftJoin(customers, and(eq(customers.organizationId, sales.organizationId), eq(customers.id, sales.customerId)))
      .where(and(eq(sales.organizationId, orgId), eq(sales.storeId, storeId), eq(sales.status, "suspended")))
      .orderBy(desc(sales.suspendedAt))
      .limit(100);
    const result = [];
    for (const row of rows) {
      const items = await tx
        .select({ total: saleItems.totalCents })
        .from(saleItems)
        .where(and(eq(saleItems.organizationId, orgId), eq(saleItems.saleId, row.id)));
      result.push({ ...row, itemCount: items.length, estimatedTotalCents: items.reduce((sum, item) => sum + item.total, 0) });
    }
    return result;
  });
}

async function lockSuspendedSale(tx: Tx, context: TenantContext, saleId: string) {
  if (!isUuid(saleId)) throw SALE_NOT_FOUND();
  const [sale] = await tx
    .select({ id: sales.id, storeId: sales.storeId, status: sales.status, customerId: sales.customerId, salespersonUserId: sales.salespersonUserId, note: sales.note })
    .from(sales)
    .where(and(eq(sales.organizationId, context.organization.id), eq(sales.id, saleId)))
    .for("update");
  if (!sale || !isStoreInScope(context.storeScope, sale.storeId)) throw SALE_NOT_FOUND();
  if (sale.status !== "suspended") throw invalid("Esta venda já não está suspensa.");
  return sale;
}

/** Content of a suspended sale to load back into the POS cart, with the current prices. */
export async function getSuspendedSale(context: TenantContext, saleId: string) {
  assertCan(context, "sales.create");
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const sale = await lockSuspendedSale(tx, context, saleId).catch(() => null);
    if (!sale) return null;
    const items = await tx
      .select({ variantId: saleItems.variantId, quantity: saleItems.quantity, productName: saleItems.productName, variantName: saleItems.variantName, sku: saleItems.sku, unit: saleItems.unit })
      .from(saleItems)
      .where(and(eq(saleItems.organizationId, orgId), eq(saleItems.saleId, saleId)))
      .orderBy(asc(saleItems.line));
    const variants = await loadVariants(tx, orgId, items.map((item) => item.variantId));
    return {
      id: sale.id,
      storeId: sale.storeId,
      customerId: sale.customerId,
      salespersonUserId: sale.salespersonUserId,
      note: sale.note,
      items: items.map((item) => ({ ...item, currentUnitPriceCents: variants.get(item.variantId)?.sellable ? (variants.get(item.variantId)?.priceCents ?? null) : null })),
    };
  });
}

export async function discardSuspendedSale(context: TenantContext, saleId: string, rawInput: unknown) {
  assertCan(context, "sales.create");
  const { reason } = parse(discardSchema, rawInput);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const sale = await lockSuspendedSale(tx, context, saleId);
    const items = await tx
      .select({ reservationId: saleItems.reservationId })
      .from(saleItems)
      .where(and(eq(saleItems.organizationId, orgId), eq(saleItems.saleId, saleId)));
    for (const item of items) if (item.reservationId) await releaseReservation(tx, orgId, item.reservationId);
    const now = new Date();
    await tx
      .update(sales)
      .set({ status: "discarded", discardedAt: now, discardReason: reason, updatedAt: now })
      .where(and(eq(sales.organizationId, orgId), eq(sales.id, saleId)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "sale.discarded",
      entityType: "sale",
      entityId: saleId,
      storeId: sale.storeId,
      changes: { reason },
    });
  });
}
