import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, pgEnum, pgTable, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { salespeople } from "./salespeople";
import { organizations, regions, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn } from "./tenant";

// Sales goals (m11a): net revenue in cents per scope and month. Append-only:
// changing a goal inserts a new version (with a reason from version 2 on); the
// current goal is the highest version of (scope, target, month).

export const salesTargetScope = pgEnum("sales_target_scope", ["organization", "region", "store", "salesperson"]);

const NONE = sql`'00000000-0000-0000-0000-000000000000'::uuid`;

export const salesTargets = pgTable(
  "sales_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    scope: salesTargetScope("scope").notNull(),
    regionId: uuid("region_id"),
    storeId: uuid("store_id"),
    salespersonId: uuid("salesperson_id"),
    // "YYYY-MM".
    month: varchar("month", { length: 7 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    version: integer("version").notNull(),
    reason: varchar("reason", { length: 240 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("sales_targets_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("sales_targets_version_key").on(t.organizationId, t.scope, sql`coalesce(${t.regionId}, ${t.storeId}, ${NONE})`, sql`coalesce(${t.salespersonId}, ${NONE})`, t.month, t.version),
    foreignKey({ name: "sales_targets_region_fk", columns: [t.organizationId, t.regionId], foreignColumns: [regions.organizationId, regions.id] }),
    foreignKey({ name: "sales_targets_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({ name: "sales_targets_salesperson_fk", columns: [t.organizationId, t.salespersonId], foreignColumns: [salespeople.organizationId, salespeople.id] }),
    index("sales_targets_org_month_idx").on(t.organizationId, t.month),
    check(
      "sales_targets_scope_fields",
      sql`(${t.scope} = 'organization' and ${t.regionId} is null and ${t.storeId} is null and ${t.salespersonId} is null)
        or (${t.scope} = 'region' and ${t.regionId} is not null and ${t.storeId} is null and ${t.salespersonId} is null)
        or (${t.scope} = 'store' and ${t.regionId} is null and ${t.storeId} is not null and ${t.salespersonId} is null)
        or (${t.scope} = 'salesperson' and ${t.regionId} is null and ${t.storeId} is not null and ${t.salespersonId} is not null)`,
    ),
    check("sales_targets_month_format", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("sales_targets_amount_positive", sql`${t.amountCents} > 0`),
    check("sales_targets_version", sql`${t.version} >= 1 and (${t.version} = 1 or ${t.reason} is not null)`),
    ...appendOnlyTenantPolicies(),
  ],
);
