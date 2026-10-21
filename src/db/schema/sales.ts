import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, numeric, pgEnum, pgTable, smallint, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashSessions } from "./cash";
import { productUnit, productVariants } from "./catalog";
import { customers } from "./customers";
import { inventoryMovements } from "./inventory";
import { organizations, stores } from "./structure";
import { inventoryReservations } from "./transfers";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// POS sales. A sale is written whole by one transaction (items, payments, stock
// exits, cash movement and number), or kept as a suspended sale with stock
// reservations until it is resumed or discarded (ADR-013 to ADR-016).

const cents = (name: string) => bigint(name, { mode: "number" });
const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const saleStatus = pgEnum("sale_status", ["suspended", "completed", "discarded", "cancelled"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "card_external", "pix", "card_provider"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "confirmed", "failed", "cancelled", "refunded"]);

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    number: integer("number"),
    status: saleStatus("status").notNull(),
    completionKey: uuid("completion_key"),
    cashSessionId: uuid("cash_session_id"),
    operatorUserId: uuid("operator_user_id")
      .notNull()
      .references(() => users.id),
    salespersonUserId: uuid("salesperson_user_id").references(() => users.id, { onDelete: "set null" }),
    customerId: uuid("customer_id"),
    subtotalCents: cents("subtotal_cents").notNull().default(0),
    discountCents: cents("discount_cents").notNull().default(0),
    surchargeCents: cents("surcharge_cents").notNull().default(0),
    totalCents: cents("total_cents").notNull().default(0),
    changeCents: cents("change_cents").notNull().default(0),
    receiptHeader: varchar("receipt_header", { length: 240 }),
    receiptFooter: varchar("receipt_footer", { length: 240 }),
    note: varchar("note", { length: 500 }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardReason: varchar("discard_reason", { length: 240 }),
    ...timestamps,
  },
  (t) => [
    unique("sales_org_id_key").on(t.organizationId, t.id),
    unique("sales_org_completion_key_key").on(t.organizationId, t.completionKey),
    unique("sales_org_store_number_key").on(t.organizationId, t.storeId, t.number),
    foreignKey({ name: "sales_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({
      name: "sales_cash_session_fk",
      columns: [t.organizationId, t.cashSessionId],
      foreignColumns: [cashSessions.organizationId, cashSessions.id],
    }),
    foreignKey({ name: "sales_customer_fk", columns: [t.organizationId, t.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    index("sales_store_completed_idx").on(t.organizationId, t.storeId, t.completedAt),
    index("sales_operator_completed_idx").on(t.organizationId, t.operatorUserId, t.completedAt),
    index("sales_store_status_idx").on(t.organizationId, t.storeId, t.status),
    check(
      "sales_completed_fields",
      sql`(${t.status} in ('completed', 'cancelled')) = (${t.number} is not null and ${t.completionKey} is not null and ${t.completedAt} is not null and ${t.cashSessionId} is not null)`,
    ),
    check("sales_discarded_fields", sql`(${t.status} = 'discarded') = (${t.discardedAt} is not null)`),
    check(
      "sales_amounts",
      sql`${t.subtotalCents} >= 0 and ${t.discountCents} >= 0 and ${t.surchargeCents} >= 0 and ${t.changeCents} >= 0
        and ${t.totalCents} >= 0 and ${t.totalCents} = ${t.subtotalCents} - ${t.discountCents} + ${t.surchargeCents}`,
    ),
    tenantIsolationPolicy(),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").notNull(),
    line: smallint("line").notNull(),
    variantId: uuid("variant_id").notNull(),
    productName: varchar("product_name", { length: 120 }).notNull(),
    variantName: varchar("variant_name", { length: 80 }).notNull(),
    sku: varchar("sku", { length: 40 }).notNull(),
    unit: productUnit("unit").notNull(),
    quantity: quantity("quantity").notNull(),
    unitPriceCents: cents("unit_price_cents").notNull(),
    unitCostCents: cents("unit_cost_cents"),
    discountCents: cents("discount_cents").notNull().default(0),
    totalCents: cents("total_cents").notNull(),
    reservationId: uuid("reservation_id"),
    movementId: uuid("movement_id"),
  },
  (t) => [
    unique("sale_items_org_id_key").on(t.organizationId, t.id),
    unique("sale_items_sale_line_key").on(t.saleId, t.line),
    foreignKey({ name: "sale_items_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    foreignKey({
      name: "sale_items_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    foreignKey({
      name: "sale_items_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [inventoryReservations.organizationId, inventoryReservations.id],
    }),
    foreignKey({
      name: "sale_items_movement_fk",
      columns: [t.organizationId, t.movementId],
      foreignColumns: [inventoryMovements.organizationId, inventoryMovements.id],
    }),
    index("sale_items_sale_idx").on(t.organizationId, t.saleId),
    check("sale_items_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "sale_items_amounts",
      sql`${t.unitPriceCents} >= 0 and ${t.discountCents} >= 0 and ${t.totalCents} >= 0 and (${t.unitCostCents} is null or ${t.unitCostCents} >= 0)`,
    ),
    tenantIsolationPolicy(),
  ],
);

export const salePayments = pgTable(
  "sale_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").notNull(),
    method: paymentMethod("method").notNull(),
    status: paymentStatus("status").notNull(),
    amountCents: cents("amount_cents").notNull(),
    tenderedCents: cents("tendered_cents"),
    changeCents: cents("change_cents"),
    nsu: varchar("nsu", { length: 20 }),
    brand: varchar("brand", { length: 30 }),
    providerReference: varchar("provider_reference", { length: 120 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("sale_payments_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "sale_payments_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    index("sale_payments_sale_idx").on(t.organizationId, t.saleId),
    check("sale_payments_amount_positive", sql`${t.amountCents} > 0`),
    check(
      "sale_payments_cash",
      sql`${t.method} <> 'cash' or (${t.tenderedCents} is not null and ${t.tenderedCents} >= ${t.amountCents} and ${t.changeCents} = ${t.tenderedCents} - ${t.amountCents})`,
    ),
    check("sale_payments_card_external", sql`${t.method} <> 'card_external' or ${t.nsu} is not null`),
    ...appendOnlyTenantPolicies(),
  ],
);
