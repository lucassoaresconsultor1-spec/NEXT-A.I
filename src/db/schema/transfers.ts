import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, numeric, pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { productVariants } from "./catalog";
import { inventoryMovements } from "./inventory";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Stock reservations and transfers between stores of one organization
// (ADR-015). Reservations hold stock without moving it; a transfer dispatch
// posts an exit at the origin and a receipt posts an entry at the destination.

const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const reservationSource = pgEnum("reservation_source", ["transfer", "sale"]);
export const reservationStatus = pgEnum("reservation_status", ["active", "released", "consumed"]);
export const stockTransferStatus = pgEnum("stock_transfer_status", ["requested", "approved", "in_transit", "received", "cancelled"]);

export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: quantity("quantity").notNull(),
    source: reservationSource("source").notNull(),
    sourceId: uuid("source_id").notNull(),
    status: reservationStatus("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    unique("inventory_reservations_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "inventory_reservations_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({
      name: "inventory_reservations_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    index("inventory_reservations_active_idx").on(t.organizationId, t.storeId, t.variantId).where(sql`${t.status} = 'active'`),
    index("inventory_reservations_source_idx").on(t.organizationId, t.source, t.sourceId),
    check("inventory_reservations_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "inventory_reservations_status_dates",
      sql`(${t.status} = 'active' and ${t.releasedAt} is null and ${t.consumedAt} is null)
        or (${t.status} = 'released' and ${t.releasedAt} is not null and ${t.consumedAt} is null)
        or (${t.status} = 'consumed' and ${t.consumedAt} is not null and ${t.releasedAt} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    originStoreId: uuid("origin_store_id").notNull(),
    destinationStoreId: uuid("destination_store_id").notNull(),
    status: stockTransferStatus("status").notNull().default("requested"),
    notes: varchar("notes", { length: 500 }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    dispatchedBy: uuid("dispatched_by").references(() => users.id, { onDelete: "set null" }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    receivedBy: uuid("received_by").references(() => users.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 240 }),
    ...timestamps,
  },
  (t) => [
    unique("stock_transfers_org_id_key").on(t.organizationId, t.id),
    unique("stock_transfers_org_number_key").on(t.organizationId, t.number),
    foreignKey({
      name: "stock_transfers_origin_fk",
      columns: [t.organizationId, t.originStoreId],
      foreignColumns: [stores.organizationId, stores.id],
    }),
    foreignKey({
      name: "stock_transfers_destination_fk",
      columns: [t.organizationId, t.destinationStoreId],
      foreignColumns: [stores.organizationId, stores.id],
    }),
    index("stock_transfers_origin_status_idx").on(t.organizationId, t.originStoreId, t.status),
    index("stock_transfers_destination_status_idx").on(t.organizationId, t.destinationStoreId, t.status),
    check("stock_transfers_distinct_stores", sql`${t.originStoreId} <> ${t.destinationStoreId}`),
    check("stock_transfers_cancelled", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
    tenantIsolationPolicy(),
  ],
);

export const stockTransferItems = pgTable(
  "stock_transfer_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    transferId: uuid("transfer_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantityRequested: quantity("quantity_requested").notNull(),
    quantitySent: quantity("quantity_sent"),
    quantityReceived: quantity("quantity_received"),
    divergenceReason: varchar("divergence_reason", { length: 240 }),
    reservationId: uuid("reservation_id"),
    exitMovementId: uuid("exit_movement_id"),
    entryMovementId: uuid("entry_movement_id"),
    ...timestamps,
  },
  (t) => [
    unique("stock_transfer_items_org_id_key").on(t.organizationId, t.id),
    unique("stock_transfer_items_transfer_variant_key").on(t.transferId, t.variantId),
    foreignKey({
      name: "stock_transfer_items_transfer_fk",
      columns: [t.organizationId, t.transferId],
      foreignColumns: [stockTransfers.organizationId, stockTransfers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_transfer_items_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    foreignKey({
      name: "stock_transfer_items_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [inventoryReservations.organizationId, inventoryReservations.id],
    }),
    foreignKey({
      name: "stock_transfer_items_exit_fk",
      columns: [t.organizationId, t.exitMovementId],
      foreignColumns: [inventoryMovements.organizationId, inventoryMovements.id],
    }),
    foreignKey({
      name: "stock_transfer_items_entry_fk",
      columns: [t.organizationId, t.entryMovementId],
      foreignColumns: [inventoryMovements.organizationId, inventoryMovements.id],
    }),
    check("stock_transfer_items_requested_positive", sql`${t.quantityRequested} > 0`),
    check("stock_transfer_items_sent_range", sql`${t.quantitySent} is null or (${t.quantitySent} >= 0 and ${t.quantitySent} <= ${t.quantityRequested})`),
    check(
      "stock_transfer_items_received_range",
      sql`${t.quantityReceived} is null or (${t.quantitySent} is not null and ${t.quantityReceived} >= 0 and ${t.quantityReceived} <= ${t.quantitySent})`,
    ),
    tenantIsolationPolicy(),
  ],
);
