import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgEnum, pgTable, primaryKey, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Operational rules the cash register and the POS obey. Typed columns instead of
// generic JSON; a NULL column on the store row means "use the organization value".

export const customerRequirement = pgEnum("customer_requirement", ["none", "optional", "required"]);

export const organizationSettings = pgTable(
  "organization_settings",
  {
    organizationId: organizationIdColumn()
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerRequirement: customerRequirement("customer_requirement").notNull().default("optional"),
    // Basis points (1050 = 10,50 %) of discount allowed without extra authorization.
    maxDiscountBps: integer("max_discount_bps").notNull().default(0),
    receiptHeader: varchar("receipt_header", { length: 240 }),
    receiptFooter: varchar("receipt_footer", { length: 240 }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    check("organization_settings_discount_range", sql`${t.maxDiscountBps} between 0 and 10000`),
    tenantIsolationPolicy(),
  ],
);

export const storeSettings = pgTable(
  "store_settings",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    customerRequirement: customerRequirement("customer_requirement"),
    maxDiscountBps: integer("max_discount_bps"),
    receiptHeader: varchar("receipt_header", { length: 240 }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.storeId] }),
    foreignKey({
      name: "store_settings_store_fk",
      columns: [t.organizationId, t.storeId],
      foreignColumns: [stores.organizationId, stores.id],
    }).onDelete("cascade"),
    check("store_settings_discount_range", sql`${t.maxDiscountBps} is null or ${t.maxDiscountBps} between 0 and 10000`),
    tenantIsolationPolicy(),
  ],
);
