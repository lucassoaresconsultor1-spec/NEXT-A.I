import "server-only";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { goodsReceiptItems, goodsReceipts, products, productVariants, purchaseOrderItems, purchaseOrders, stores, suppliers, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { canReadCosts } from "@/server/catalog/queries";
import { nextDocumentNumber } from "@/server/counters";
import { invalid } from "@/server/errors";
import { fromDbQuantity, toDbQuantity } from "@/server/inventory/quantity";
import { pageResult, pageWindow } from "@/server/pagination";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { assertOrderReferences, lineTotalCents, lockOrder, ORDER_NOT_FOUND, parse } from "./queries";
import { purchaseOrderInputSchema, reasonSchema, type ParsedPurchaseOrderInput, type PurchaseOrderFilters } from "./schemas";

// Purchase orders: drafts are edited freely, approval freezes them, receipts
// (receiving.ts) bring the goods into stock. Costs only reach members with
// catalog.costs.read and never the audit trail.

export type { PurchaseOrderFilters } from "./schemas";

function assertCanManage(context: TenantContext) {
  assertCan(context, "purchases.manage");
  // Orders carry unit costs, so writing them requires seeing costs.
  assertCan(context, "catalog.costs.read");
}

function orderItemsAudit(input: ParsedPurchaseOrderInput) {
  return input.items.map((item) => ({ variantId: item.variantId, quantity: toDbQuantity(item.quantity) }));
}

export async function listPurchaseOrders(context: TenantContext, filters: PurchaseOrderFilters) {
  assertCan(context, "purchases.read");
  const orgId = context.organization.id;
  const conditions: (SQL | undefined)[] = [
    eq(purchaseOrders.organizationId, orgId),
    storeScopeCondition(context.storeScope, purchaseOrders.storeId),
  ];
  if (filters.status) conditions.push(eq(purchaseOrders.status, filters.status));
  if (filters.storeId) conditions.push(eq(purchaseOrders.storeId, filters.storeId));
  if (filters.supplierId) conditions.push(eq(purchaseOrders.supplierId, filters.supplierId));
  if (filters.number) conditions.push(eq(purchaseOrders.number, filters.number));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  const withCosts = canReadCosts(context);
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const [total] = await tx.select({ value: count() }).from(purchaseOrders).where(where);
    const rows = await tx
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        storeId: purchaseOrders.storeId,
        storeName: stores.name,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        expectedDate: purchaseOrders.expectedDate,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .innerJoin(stores, and(eq(stores.organizationId, purchaseOrders.organizationId), eq(stores.id, purchaseOrders.storeId)))
      .innerJoin(suppliers, and(eq(suppliers.organizationId, purchaseOrders.organizationId), eq(suppliers.id, purchaseOrders.supplierId)))
      .where(where)
      .orderBy(desc(purchaseOrders.number))
      .limit(limit)
      .offset(offset);
    const ids = rows.map((row) => row.id);
    const items = ids.length
      ? await tx
          .select({ orderId: purchaseOrderItems.orderId, quantity: purchaseOrderItems.quantityOrdered, cost: purchaseOrderItems.unitCostCents })
          .from(purchaseOrderItems)
          .where(and(eq(purchaseOrderItems.organizationId, orgId), inArray(purchaseOrderItems.orderId, ids)))
      : [];
    const summary = new Map<string, { itemCount: number; totalCents: number }>();
    for (const item of items) {
      const entry = summary.get(item.orderId) ?? { itemCount: 0, totalCents: 0 };
      entry.itemCount += 1;
      entry.totalCents += lineTotalCents(item.cost, fromDbQuantity(item.quantity));
      summary.set(item.orderId, entry);
    }
    return pageResult(
      rows.map((row) => {
        const entry = summary.get(row.id) ?? { itemCount: 0, totalCents: 0 };
        return { ...row, itemCount: entry.itemCount, ...(withCosts ? { totalCents: entry.totalCents } : {}) };
      }),
      total.value,
      filters.page,
    );
  });
}

async function loadOrderDetail(tx: Tx, context: TenantContext, orderId: string) {
  const orgId = context.organization.id;
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      storeId: stores.id,
      storeCode: stores.code,
      storeName: stores.name,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      expectedDate: purchaseOrders.expectedDate,
      notes: purchaseOrders.notes,
      createdBy: purchaseOrders.createdBy,
      approvedBy: purchaseOrders.approvedBy,
      approvedAt: purchaseOrders.approvedAt,
      cancelledAt: purchaseOrders.cancelledAt,
      cancelReason: purchaseOrders.cancelReason,
      closedAt: purchaseOrders.closedAt,
      closeReason: purchaseOrders.closeReason,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(stores, and(eq(stores.organizationId, purchaseOrders.organizationId), eq(stores.id, purchaseOrders.storeId)))
    .innerJoin(suppliers, and(eq(suppliers.organizationId, purchaseOrders.organizationId), eq(suppliers.id, purchaseOrders.supplierId)))
    .where(and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.id, orderId), storeScopeCondition(context.storeScope, purchaseOrders.storeId)));
  if (!order) return null;
  const withCosts = canReadCosts(context);
  const itemRows = await tx
    .select({
      id: purchaseOrderItems.id,
      variantId: purchaseOrderItems.variantId,
      productName: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      unit: products.unit,
      quantityOrdered: purchaseOrderItems.quantityOrdered,
      quantityReceived: purchaseOrderItems.quantityReceived,
      unitCostCents: purchaseOrderItems.unitCostCents,
    })
    .from(purchaseOrderItems)
    .innerJoin(productVariants, and(eq(productVariants.organizationId, purchaseOrderItems.organizationId), eq(productVariants.id, purchaseOrderItems.variantId)))
    .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
    .where(and(eq(purchaseOrderItems.organizationId, orgId), eq(purchaseOrderItems.orderId, orderId)))
    .orderBy(asc(sql`lower(${products.name})`), asc(sql`lower(${productVariants.name})`), asc(purchaseOrderItems.id));
  let totalCents = 0;
  const items = itemRows.map(({ unitCostCents, ...item }) => {
    const ordered = fromDbQuantity(item.quantityOrdered);
    const pending = ordered - fromDbQuantity(item.quantityReceived);
    totalCents += lineTotalCents(unitCostCents, ordered);
    return { ...item, quantityPending: toDbQuantity(pending), ...(withCosts ? { unitCostCents } : {}) };
  });
  const receiptRows = await tx
    .select({ id: goodsReceipts.id, receivedAt: goodsReceipts.receivedAt, receivedByName: users.name, notes: goodsReceipts.notes })
    .from(goodsReceipts)
    .leftJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .where(and(eq(goodsReceipts.organizationId, orgId), eq(goodsReceipts.orderId, orderId)))
    .orderBy(asc(goodsReceipts.receivedAt), asc(goodsReceipts.id));
  const receiptItems = receiptRows.length
    ? await tx
        .select({ receiptId: goodsReceiptItems.receiptId, orderItemId: goodsReceiptItems.orderItemId, quantity: goodsReceiptItems.quantity })
        .from(goodsReceiptItems)
        .where(and(eq(goodsReceiptItems.organizationId, orgId), inArray(goodsReceiptItems.receiptId, receiptRows.map((row) => row.id))))
    : [];
  const receipts = receiptRows.map((receipt) => ({
    ...receipt,
    items: receiptItems.filter((item) => item.receiptId === receipt.id).map(({ orderItemId, quantity }) => ({ orderItemId, quantity })),
  }));
  const { storeId, storeCode, storeName, supplierId, supplierName, ...rest } = order;
  return {
    ...rest,
    store: { id: storeId, code: storeCode, name: storeName },
    supplier: { id: supplierId, name: supplierName },
    items,
    receipts,
    ...(withCosts ? { totalCents } : {}),
  };
}

/** Null when missing, of another organization or outside the member's store scope. */
export async function getPurchaseOrder(context: TenantContext, orderId: string) {
  assertCan(context, "purchases.read");
  if (!isUuid(orderId)) return null;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, context.organization.id, "inventory");
    return loadOrderDetail(tx, context, orderId);
  });
}

async function writeItems(tx: Tx, organizationId: string, orderId: string, input: ParsedPurchaseOrderInput) {
  await tx
    .insert(purchaseOrderItems)
    .values(
      input.items.map((item) => ({
        organizationId,
        orderId,
        variantId: item.variantId,
        quantityOrdered: toDbQuantity(item.quantity),
        unitCostCents: item.unitCostCents,
      })),
    );
}

export async function createPurchaseOrder(context: TenantContext, rawInput: unknown) {
  assertCanManage(context);
  const input = parse(purchaseOrderInputSchema, rawInput);
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    await assertOrderReferences(tx, context, { storeId: input.storeId, supplierId: input.supplierId, variantIds: input.items.map((item) => item.variantId) });
    const number = await nextDocumentNumber(tx, orgId, "purchase_order");
    const [order] = await tx
      .insert(purchaseOrders)
      .values({
        organizationId: orgId,
        number,
        storeId: input.storeId,
        supplierId: input.supplierId,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? null,
        createdBy: context.user.id,
      })
      .returning({ id: purchaseOrders.id });
    await writeItems(tx, orgId, order.id, input);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "purchase_order.created",
      entityType: "purchase_order",
      entityId: order.id,
      storeId: input.storeId,
      changes: { number, supplierId: input.supplierId, expectedDate: input.expectedDate ?? null, items: orderItemsAudit(input) },
    });
    return { id: order.id, number };
  });
}

/** Drafts only: replaces header and items. */
export async function updatePurchaseOrder(context: TenantContext, orderId: string, rawInput: unknown) {
  assertCanManage(context);
  const input = parse(purchaseOrderInputSchema, rawInput);
  if (!isUuid(orderId)) throw ORDER_NOT_FOUND();
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const order = await lockOrder(tx, context, orderId);
    if (!order) throw ORDER_NOT_FOUND();
    if (order.status !== "draft") throw invalid("Só pedidos em rascunho podem ser alterados.");
    await assertOrderReferences(tx, context, { storeId: input.storeId, supplierId: input.supplierId, variantIds: input.items.map((item) => item.variantId) });
    await tx
      .update(purchaseOrders)
      .set({ storeId: input.storeId, supplierId: input.supplierId, expectedDate: input.expectedDate ?? null, notes: input.notes ?? null, updatedAt: new Date() })
      .where(and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.id, orderId)));
    await tx.delete(purchaseOrderItems).where(and(eq(purchaseOrderItems.organizationId, orgId), eq(purchaseOrderItems.orderId, orderId)));
    await writeItems(tx, orgId, orderId, input);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "purchase_order.updated",
      entityType: "purchase_order",
      entityId: orderId,
      storeId: input.storeId,
      changes: { number: order.number, supplierId: input.supplierId, expectedDate: input.expectedDate ?? null, items: orderItemsAudit(input) },
    });
  });
}

type Transition = { action: "approved" | "cancelled" | "closed"; from: readonly string[]; message: string };
const TRANSITIONS = {
  approve: { action: "approved", from: ["draft"], message: "Só pedidos em rascunho podem ser aprovados." },
  cancel: { action: "cancelled", from: ["draft", "approved"], message: "Pedido com recebimento não pode ser cancelado; encerre as pendências." },
  close: { action: "closed", from: ["partially_received"], message: "Só pedidos recebidos em parte podem ter as pendências encerradas." },
} as const satisfies Record<string, Transition>;

async function transition(context: TenantContext, orderId: string, kind: keyof typeof TRANSITIONS, reason?: string) {
  assertCan(context, "purchases.approve");
  if (!isUuid(orderId)) throw ORDER_NOT_FOUND();
  const orgId = context.organization.id;
  const rule = TRANSITIONS[kind];
  await withScope(dbScope(context), async (tx) => {
    await assertFeature(tx, orgId, "inventory");
    const order = await lockOrder(tx, context, orderId);
    if (!order) throw ORDER_NOT_FOUND();
    if (!(rule.from as readonly string[]).includes(order.status)) throw invalid(rule.message);
    const now = new Date();
    const actor = context.user.id;
    const set =
      kind === "approve"
        ? { status: "approved" as const, approvedBy: actor, approvedAt: now }
        : kind === "cancel"
          ? { status: "cancelled" as const, cancelledBy: actor, cancelledAt: now, cancelReason: reason }
          : { status: "received" as const, closedBy: actor, closedAt: now, closeReason: reason };
    await tx
      .update(purchaseOrders)
      .set({ ...set, updatedAt: now })
      .where(and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.id, orderId)));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: actor,
      action: `purchase_order.${rule.action}`,
      entityType: "purchase_order",
      entityId: orderId,
      storeId: order.storeId,
      changes: { number: order.number, status: { from: order.status, to: set.status }, ...(reason ? { reason } : {}) },
    });
  });
}

export async function approvePurchaseOrder(context: TenantContext, orderId: string) {
  await transition(context, orderId, "approve");
}

export async function cancelPurchaseOrder(context: TenantContext, orderId: string, reason: unknown) {
  await transition(context, orderId, "cancel", parse(reasonSchema, { reason }).reason);
}

export async function closePurchaseOrder(context: TenantContext, orderId: string, reason: unknown) {
  await transition(context, orderId, "close", parse(reasonSchema, { reason }).reason);
}
