import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { products, productVariants, stockTransferItems, stockTransfers, stores, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import type { TransferFilters } from "./transfer-schemas";

// Read side of stock transfers: a member sees the transfers whose origin or
// destination is in scope. Out of reach answers as "not found" (null).

const origin = alias(stores, "origin_store");
const destination = alias(stores, "destination_store");

function visible(context: TenantContext): SQL | undefined {
  const scope = context.storeScope;
  if (scope.all) return undefined;
  return or(storeScopeCondition(scope, stockTransfers.originStoreId), storeScopeCondition(scope, stockTransfers.destinationStoreId));
}

const headerColumns = {
  id: stockTransfers.id,
  number: stockTransfers.number,
  status: stockTransfers.status,
  originStoreId: stockTransfers.originStoreId,
  originStoreName: origin.name,
  destinationStoreId: stockTransfers.destinationStoreId,
  destinationStoreName: destination.name,
  requestedAt: stockTransfers.requestedAt,
};

export async function listTransfers(context: TenantContext, filters: TransferFilters) {
  assertCan(context, "inventory.read");
  const orgId = context.organization.id;
  const conditions: (SQL | undefined)[] = [eq(stockTransfers.organizationId, orgId), visible(context)];
  if (filters.status) conditions.push(eq(stockTransfers.status, filters.status));
  if (filters.storeId) conditions.push(or(eq(stockTransfers.originStoreId, filters.storeId), eq(stockTransfers.destinationStoreId, filters.storeId)));
  if (filters.number) conditions.push(eq(stockTransfers.number, filters.number));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const [total] = await tx.select({ value: count() }).from(stockTransfers).where(where);
    const rows = await tx
      .select({
        ...headerColumns,
        itemCount: sql<number>`(select count(*) from ${stockTransferItems}
          where ${stockTransferItems.organizationId} = ${stockTransfers.organizationId} and ${stockTransferItems.transferId} = ${stockTransfers.id})`.mapWith(Number),
      })
      .from(stockTransfers)
      .innerJoin(origin, and(eq(origin.organizationId, stockTransfers.organizationId), eq(origin.id, stockTransfers.originStoreId)))
      .innerJoin(destination, and(eq(destination.organizationId, stockTransfers.organizationId), eq(destination.id, stockTransfers.destinationStoreId)))
      .where(where)
      .orderBy(desc(stockTransfers.number))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

export async function getTransfer(context: TenantContext, transferId: string) {
  assertCan(context, "inventory.read");
  if (!isUuid(transferId)) return null;
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const [transfer] = await tx
      .select({
        ...headerColumns,
        notes: stockTransfers.notes,
        approvedAt: stockTransfers.approvedAt,
        dispatchedAt: stockTransfers.dispatchedAt,
        receivedAt: stockTransfers.receivedAt,
        cancelledAt: stockTransfers.cancelledAt,
        cancelReason: stockTransfers.cancelReason,
        requestedById: stockTransfers.requestedBy,
      })
      .from(stockTransfers)
      .innerJoin(origin, and(eq(origin.organizationId, stockTransfers.organizationId), eq(origin.id, stockTransfers.originStoreId)))
      .innerJoin(destination, and(eq(destination.organizationId, stockTransfers.organizationId), eq(destination.id, stockTransfers.destinationStoreId)))
      .where(and(eq(stockTransfers.organizationId, orgId), eq(stockTransfers.id, transferId), visible(context)));
    if (!transfer) return null;
    const items = await tx
      .select({
        id: stockTransferItems.id,
        variantId: stockTransferItems.variantId,
        productName: products.name,
        variantName: productVariants.name,
        sku: productVariants.sku,
        unit: products.unit,
        quantityRequested: stockTransferItems.quantityRequested,
        quantitySent: stockTransferItems.quantitySent,
        quantityReceived: stockTransferItems.quantityReceived,
        divergenceReason: stockTransferItems.divergenceReason,
      })
      .from(stockTransferItems)
      .innerJoin(productVariants, and(eq(productVariants.organizationId, stockTransferItems.organizationId), eq(productVariants.id, stockTransferItems.variantId)))
      .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
      .where(and(eq(stockTransferItems.organizationId, orgId), eq(stockTransferItems.transferId, transferId)))
      .orderBy(asc(sql`lower(${products.name})`), asc(sql`lower(${productVariants.name})`));
    const { requestedById, ...rest } = transfer;
    const [requester] = requestedById
      ? await tx.select({ name: users.name }).from(users).where(inArray(users.id, [requestedById]))
      : [];
    return { ...rest, requestedByName: requester?.name ?? null, items };
  });
}
