import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { products, productVariants, purchaseOrders, stores, suppliers } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { invalid, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { QUANTITY_SCALE } from "@/server/inventory/quantity";

// Building blocks shared by the purchasing services: parsing, row locks and the
// checks that every referenced store, supplier and variant is usable.

export const ORDER_NOT_FOUND = () => notFound("Pedido de compra não encontrado.");

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

/** Order of the organization inside the member's store scope, locked until commit; null when out of reach. */
export async function lockOrder(tx: Tx, context: TenantContext, orderId: string) {
  const [order] = await tx
    .select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, storeId: purchaseOrders.storeId })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.organizationId, context.organization.id),
        eq(purchaseOrders.id, orderId),
        storeScopeCondition(context.storeScope, purchaseOrders.storeId),
      ),
    )
    .for("update");
  return order ?? null;
}

/** Destination store must be active and in scope; supplier active; variants of active products. */
export async function assertOrderReferences(
  tx: Tx,
  context: TenantContext,
  input: { storeId: string; supplierId: string; variantIds: string[] },
) {
  const orgId = context.organization.id;
  const [store] = await tx
    .select({ status: stores.status })
    .from(stores)
    .where(and(eq(stores.organizationId, orgId), eq(stores.id, input.storeId), storeScopeCondition(context.storeScope, stores.id)));
  if (store?.status !== "active") throw invalid("Revise os campos destacados.", { storeId: ["Selecione uma loja ativa do seu acesso."] });
  const [supplier] = await tx
    .select({ isActive: suppliers.isActive })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, orgId), eq(suppliers.id, input.supplierId)));
  if (!supplier?.isActive) throw invalid("Revise os campos destacados.", { supplierId: ["Selecione um fornecedor ativo da empresa."] });
  const found = await tx
    .select({ id: productVariants.id, variantActive: productVariants.isActive, productActive: products.isActive })
    .from(productVariants)
    .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
    .where(and(eq(productVariants.organizationId, orgId), inArray(productVariants.id, input.variantIds)));
  const usable = new Set(found.filter((row) => row.variantActive && row.productActive).map((row) => row.id));
  const errors: Record<string, string[]> = {};
  input.variantIds.forEach((id, index) => {
    if (!usable.has(id)) errors[`items.${index}.variantId`] = ["Selecione um produto ativo da empresa."];
  });
  if (Object.keys(errors).length > 0) throw invalid("Revise os campos destacados.", errors);
}

/** Line total in cents: unit cost × quantity (thousandths), rounded half up. */
export function lineTotalCents(unitCostCents: number, quantityMilli: bigint) {
  const scaled = BigInt(unitCostCents) * quantityMilli;
  return Number((scaled + QUANTITY_SCALE / BigInt(2)) / QUANTITY_SCALE);
}
