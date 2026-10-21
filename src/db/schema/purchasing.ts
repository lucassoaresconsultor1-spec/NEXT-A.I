import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, index, integer, numeric, pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { productVariants, suppliers } from "./catalog";
import { inventoryMovements } from "./inventory";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Purchase orders per destination store and supplier, and goods receipts
// against them. Each receipt item points at the ledger entry it created, so the
// stock and the replacement cost always match the receipts (ADR-016).

const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const purchaseOrderStatus = pgEnum("purchase_order_status", ["draft", "approved", "partially_received", "received", "cancelled"]);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    storeId: uuid("store_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    status: purchaseOrderStatus("status").notNull().default("draft"),
    expectedDate: date("expected_date"),
    notes: varchar("notes", { length: 500 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 240 }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: varchar("close_reason", { length: 240 }),
    ...timestamps,
  },
  (t) => [
    unique("purchase_orders_org_id_key").on(t.organizationId, t.id),
    unique("purchase_orders_org_number_key").on(t.organizationId, t.number),
    foreignKey({ name: "purchase_orders_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({
      name: "purchase_orders_supplier_fk",
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    index("purchase_orders_store_status_idx").on(t.organizationId, t.storeId, t.status),
    check("purchase_orders_cancelled", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
    check("purchase_orders_closed", sql`${t.closedAt} is null or ${t.status} = 'received'`),
    tenantIsolationPolicy(),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantityOrdered: quantity("quantity_ordered").notNull(),
    quantityReceived: quantity("quantity_received").notNull().default("0"),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("purchase_order_items_org_id_key").on(t.organizationId, t.id),
    unique("purchase_order_items_order_variant_key").on(t.orderId, t.variantId),
    foreignKey({
      name: "purchase_order_items_order_fk",
      columns: [t.organizationId, t.orderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "purchase_order_items_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    check("purchase_order_items_ordered_positive", sql`${t.quantityOrdered} > 0`),
    check("purchase_order_items_received_range", sql`${t.quantityReceived} >= 0 and ${t.quantityReceived} <= ${t.quantityOrdered}`),
    check("purchase_order_items_cost_non_negative", sql`${t.unitCostCents} >= 0`),
    tenantIsolationPolicy(),
  ],
);

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    storeId: uuid("store_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    notes: varchar("notes", { length: 500 }),
    receivedBy: uuid("received_by").references(() => users.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("goods_receipts_org_id_key").on(t.organizationId, t.id),
    unique("goods_receipts_org_key_key").on(t.organizationId, t.idempotencyKey),
    foreignKey({
      name: "goods_receipts_order_fk",
      columns: [t.organizationId, t.orderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }),
    foreignKey({ name: "goods_receipts_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    index("goods_receipts_order_idx").on(t.organizationId, t.orderId),
    ...appendOnlyTenantPolicies(),
  ],
);

export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: quantity("quantity").notNull(),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    movementId: uuid("movement_id").notNull(),
  },
  (t) => [
    unique("goods_receipt_items_org_id_key").on(t.organizationId, t.id),
    foreignKey({
      name: "goods_receipt_items_receipt_fk",
      columns: [t.organizationId, t.receiptId],
      foreignColumns: [goodsReceipts.organizationId, goodsReceipts.id],
    }),
    foreignKey({
      name: "goods_receipt_items_order_item_fk",
      columns: [t.organizationId, t.orderItemId],
      foreignColumns: [purchaseOrderItems.organizationId, purchaseOrderItems.id],
    }),
    foreignKey({
      name: "goods_receipt_items_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    foreignKey({
      name: "goods_receipt_items_movement_fk",
      columns: [t.organizationId, t.movementId],
      foreignColumns: [inventoryMovements.organizationId, inventoryMovements.id],
    }),
    index("goods_receipt_items_receipt_idx").on(t.organizationId, t.receiptId),
    check("goods_receipt_items_quantity_positive", sql`${t.quantity} > 0`),
    check("goods_receipt_items_cost_non_negative", sql`${t.unitCostCents} >= 0`),
    ...appendOnlyTenantPolicies(),
  ],
);
