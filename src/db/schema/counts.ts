import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, numeric, pgEnum, pgTable, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { brands, categories, productVariants } from "./catalog";
import { inventoryMovements } from "./inventory";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Batch stock counts of a store: open (blind counting) -> approved (one "count"
// movement per divergent item, against the balance at approval) or cancelled.
// At most one open count per store.

const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const inventoryCountStatus = pgEnum("inventory_count_status", ["open", "approved", "cancelled"]);

export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    storeId: uuid("store_id").notNull(),
    status: inventoryCountStatus("status").notNull().default("open"),
    categoryId: uuid("category_id"),
    brandId: uuid("brand_id"),
    note: varchar("note", { length: 500 }),
    openedBy: uuid("opened_by").references(() => users.id, { onDelete: "set null" }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalReason: varchar("approval_reason", { length: 240 }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 240 }),
    ...timestamps,
  },
  (t) => [
    unique("inventory_counts_org_id_key").on(t.organizationId, t.id),
    unique("inventory_counts_org_number_key").on(t.organizationId, t.number),
    uniqueIndex("inventory_counts_one_open_per_store").on(t.organizationId, t.storeId).where(sql`${t.status} = 'open'`),
    foreignKey({ name: "inventory_counts_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({ name: "inventory_counts_category_fk", columns: [t.organizationId, t.categoryId], foreignColumns: [categories.organizationId, categories.id] }),
    foreignKey({ name: "inventory_counts_brand_fk", columns: [t.organizationId, t.brandId], foreignColumns: [brands.organizationId, brands.id] }),
    index("inventory_counts_store_status_idx").on(t.organizationId, t.storeId, t.status),
    check(
      "inventory_counts_status_fields",
      sql`(${t.status} = 'open' and ${t.approvedAt} is null and ${t.cancelledAt} is null)
        or (${t.status} = 'approved' and ${t.approvedAt} is not null and ${t.approvalReason} is not null and ${t.cancelledAt} is null)
        or (${t.status} = 'cancelled' and ${t.cancelledAt} is not null and ${t.cancelReason} is not null and ${t.approvedAt} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

export const inventoryCountItems = pgTable(
  "inventory_count_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    countId: uuid("count_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    // System balance when the count was opened (hidden while counting).
    expectedQuantity: quantity("expected_quantity").notNull(),
    countedQuantity: quantity("counted_quantity"),
    countedBy: uuid("counted_by").references(() => users.id, { onDelete: "set null" }),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    movementId: uuid("movement_id"),
    ...timestamps,
  },
  (t) => [
    unique("inventory_count_items_org_id_key").on(t.organizationId, t.id),
    unique("inventory_count_items_count_variant_key").on(t.organizationId, t.countId, t.variantId),
    foreignKey({
      name: "inventory_count_items_count_fk",
      columns: [t.organizationId, t.countId],
      foreignColumns: [inventoryCounts.organizationId, inventoryCounts.id],
    }),
    foreignKey({
      name: "inventory_count_items_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    foreignKey({
      name: "inventory_count_items_movement_fk",
      columns: [t.organizationId, t.movementId],
      foreignColumns: [inventoryMovements.organizationId, inventoryMovements.id],
    }),
    check("inventory_count_items_expected_non_negative", sql`${t.expectedQuantity} >= 0`),
    check("inventory_count_items_counted", sql`(${t.countedQuantity} is null) = (${t.countedAt} is null) and (${t.countedQuantity} is null or ${t.countedQuantity} >= 0)`),
    check("inventory_count_items_movement_counted", sql`${t.movementId} is null or ${t.countedQuantity} is not null`),
    tenantIsolationPolicy(),
  ],
);
