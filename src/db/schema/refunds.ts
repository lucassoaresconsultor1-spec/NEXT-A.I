import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, numeric, pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashSessions } from "./cash";
import { inventoryMovements } from "./inventory";
import { saleItems, sales } from "./sales";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn } from "./tenant";

// Cancellations (whole sale, while its cash session is open) and returns (items
// and quantities) with the refund and the optional restock. Append-only: a
// refund is never edited; amounts are integer cents.

const cents = (name: string) => bigint(name, { mode: "number" });

export const refundKind = pgEnum("refund_kind", ["cancellation", "return"]);
export const refundMethod = pgEnum("refund_method", ["original", "cash", "card_external"]);

export const saleRefunds = pgTable(
  "sale_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").notNull(),
    storeId: uuid("store_id").notNull(),
    kind: refundKind("kind").notNull(),
    reason: varchar("reason", { length: 240 }).notNull(),
    method: refundMethod("method").notNull(),
    nsu: varchar("nsu", { length: 20 }),
    amountCents: cents("amount_cents").notNull(),
    cashAmountCents: cents("cash_amount_cents").notNull().default(0),
    idempotencyKey: uuid("idempotency_key").notNull(),
    cashSessionId: uuid("cash_session_id"),
    providerStatus: varchar("provider_status", { length: 16 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("sale_refunds_org_id_key").on(t.organizationId, t.id),
    unique("sale_refunds_org_key_key").on(t.organizationId, t.idempotencyKey),
    foreignKey({ name: "sale_refunds_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    foreignKey({ name: "sale_refunds_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({
      name: "sale_refunds_session_fk",
      columns: [t.organizationId, t.cashSessionId],
      foreignColumns: [cashSessions.organizationId, cashSessions.id],
    }),
    index("sale_refunds_sale_idx").on(t.organizationId, t.saleId),
    check("sale_refunds_amounts", sql`${t.amountCents} > 0 and ${t.cashAmountCents} >= 0 and ${t.cashAmountCents} <= ${t.amountCents}`),
    check("sale_refunds_card_nsu", sql`${t.method} <> 'card_external' or ${t.nsu} is not null`),
    check("sale_refunds_kind_method", sql`(${t.kind} = 'cancellation') = (${t.method} = 'original')`),
    ...appendOnlyTenantPolicies(),
  ],
);

export const saleRefundItems = pgTable(
  "sale_refund_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    refundId: uuid("refund_id").notNull(),
    saleItemId: uuid("sale_item_id").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    amountCents: cents("amount_cents").notNull(),
    restocked: boolean("restocked").notNull(),
    movementId: uuid("movement_id"),
  },
  (t) => [
    unique("sale_refund_items_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "sale_refund_items_refund_fk", columns: [t.organizationId, t.refundId], foreignColumns: [saleRefunds.organizationId, saleRefunds.id] }),
    foreignKey({ name: "sale_refund_items_item_fk", columns: [t.organizationId, t.saleItemId], foreignColumns: [saleItems.organizationId, saleItems.id] }),
    foreignKey({
      name: "sale_refund_items_movement_fk",
      columns: [t.organizationId, t.movementId],
      foreignColumns: [inventoryMovements.organizationId, inventoryMovements.id],
    }),
    index("sale_refund_items_item_idx").on(t.organizationId, t.saleItemId),
    check("sale_refund_items_quantity_positive", sql`${t.quantity} > 0`),
    check("sale_refund_items_amount_non_negative", sql`${t.amountCents} >= 0`),
    check("sale_refund_items_restock", sql`${t.restocked} = (${t.movementId} is not null)`),
    ...appendOnlyTenantPolicies(),
  ],
);
