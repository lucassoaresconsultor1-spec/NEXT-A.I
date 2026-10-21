import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { productVariants } from "./catalog";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, currentOrganizationId, organizationIdColumn } from "./tenant";

// Stock ledger: every change of a store balance is one immutable movement.
// The balance is derived from the ledger by the inventory service inside the
// same transaction; nothing else writes inventory_balances.

export const inventoryMovementType = pgEnum("inventory_movement_type", ["entry", "exit", "adjustment", "loss", "count"]);

// Quantities: numeric(14,3) (fractions for kg/l/m); "un" products are checked as integers by the service.
const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    type: inventoryMovementType("type").notNull(),
    // Signed change applied to the balance (count: counted minus previous balance).
    quantity: quantity("quantity").notNull(),
    balanceAfter: quantity("balance_after").notNull(),
    // Quantity found by a physical count; only for type "count".
    countedQuantity: quantity("counted_quantity"),
    reason: varchar("reason", { length: 240 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    // clock_timestamp(): written under the balance lock, so ledger order follows commit order.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("inventory_movements_org_id_key").on(t.organizationId, t.id),
    foreignKey({
      name: "inventory_movements_store_fk",
      columns: [t.organizationId, t.storeId],
      foreignColumns: [stores.organizationId, stores.id],
    }),
    foreignKey({
      name: "inventory_movements_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    index("inventory_movements_store_variant_idx").on(t.organizationId, t.storeId, t.variantId, t.createdAt),
    index("inventory_movements_org_created_idx").on(t.organizationId, t.createdAt),
    check(
      "inventory_movements_quantity_sign",
      sql`(${t.type} = 'entry' and ${t.quantity} > 0)
        or (${t.type} in ('exit', 'loss') and ${t.quantity} < 0)
        or (${t.type} = 'adjustment' and ${t.quantity} <> 0)
        or ${t.type} = 'count'`,
    ),
    check(
      "inventory_movements_counted",
      sql`(${t.type} = 'count') = (${t.countedQuantity} is not null)
        and (${t.countedQuantity} is null or ${t.countedQuantity} = ${t.balanceAfter})`,
    ),
    check("inventory_movements_balance_non_negative", sql`${t.balanceAfter} >= 0`),
    ...appendOnlyTenantPolicies(),
  ],
);

/** Current quantity per store and variant. Never deleted; written only together with a movement. */
export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: quantity("quantity").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.storeId, t.variantId] }),
    foreignKey({
      name: "inventory_balances_store_fk",
      columns: [t.organizationId, t.storeId],
      foreignColumns: [stores.organizationId, stores.id],
    }),
    foreignKey({
      name: "inventory_balances_variant_fk",
      columns: [t.organizationId, t.variantId],
      foreignColumns: [productVariants.organizationId, productVariants.id],
    }),
    index("inventory_balances_variant_idx").on(t.organizationId, t.variantId),
    // Negative stock is not allowed (product decision of Phase 2, increment 1).
    check("inventory_balances_non_negative", sql`${t.quantity} >= 0`),
    pgPolicy("tenant_read", { for: "select", using: sql`organization_id = ${currentOrganizationId}` }),
    pgPolicy("tenant_insert", { for: "insert", withCheck: sql`organization_id = ${currentOrganizationId}` }),
    pgPolicy("tenant_update", {
      for: "update",
      using: sql`organization_id = ${currentOrganizationId}`,
      withCheck: sql`organization_id = ${currentOrganizationId}`,
    }),
  ],
);

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type InventoryBalance = typeof inventoryBalances.$inferSelect;
