import "server-only";
import { and, eq } from "drizzle-orm";
import { sales, stores } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { formatCnpj } from "@/lib/documents";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { isUuid } from "@/server/stores/schemas";
import { assertFeature } from "@/server/plans/entitlements";
import { forbidden } from "@/server/errors";
import { can } from "@/server/authz/guard";
import { loadSaleDetail } from "./queries";

// Data of the non-fiscal receipt of a completed sale. Header and footer come
// from the snapshot taken at completion; dates use the store time zone (or the
// organization one when the store has none).

export const NON_FISCAL_NOTICE = "Documento sem valor fiscal";

export async function getReceipt(context: TenantContext, saleId: string) {
  if (!can(context, "sales.read") && !can(context, "sales.create")) throw forbidden();
  if (!isUuid(saleId)) return null;
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "pos");
    const detail = await loadSaleDetail(tx, context, saleId);
    if (!detail || (detail.status !== "completed" && detail.status !== "cancelled")) return null;
    const [store] = await tx
      .select({
        name: stores.name,
        document: stores.document,
        street: stores.street,
        number: stores.number,
        district: stores.district,
        city: stores.city,
        state: stores.state,
        timezone: stores.timezone,
        receiptHeader: sales.receiptHeader,
        receiptFooter: sales.receiptFooter,
      })
      .from(sales)
      .innerJoin(stores, and(eq(stores.organizationId, sales.organizationId), eq(stores.id, sales.storeId)))
      .where(and(eq(sales.organizationId, orgId), eq(sales.id, saleId)));
    const address = [
      [store.street, store.number].filter(Boolean).join(", "),
      store.district,
      [store.city, store.state].filter(Boolean).join(" - "),
    ]
      .filter((part) => part && part.length > 0)
      .join(" · ");
    return {
      store: { name: store.name, document: store.document ? formatCnpj(store.document) : null, address: address || null },
      timezone: store.timezone ?? context.organization.timezone,
      number: detail.number!,
      status: detail.status,
      completedAt: detail.completedAt!,
      operatorName: detail.operatorName,
      customerName: detail.customer?.name ?? null,
      items: detail.items.map(({ line, productName, variantName, sku, unit, quantity, unitPriceCents, discountCents, totalCents }) => ({
        line,
        productName,
        variantName,
        sku,
        unit,
        quantity,
        unitPriceCents,
        discountCents,
        totalCents,
      })),
      subtotalCents: detail.subtotalCents,
      discountCents: detail.discountCents,
      surchargeCents: detail.surchargeCents,
      totalCents: detail.totalCents,
      changeCents: detail.changeCents,
      payments: detail.payments.map(({ method, amountCents, tenderedCents, changeCents, nsu }) => ({ method, amountCents, tenderedCents, changeCents, nsu })),
      header: store.receiptHeader,
      footer: store.receiptFooter,
      notice: NON_FISCAL_NOTICE,
    };
  });
}
