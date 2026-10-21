import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgTable, primaryKey, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { organizationMemberships } from "./access";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Salespeople (m10a): a member of the organization linked to stores (the person is
// the member's user: no personal data is duplicated), with a short code for the POS
// and a monthly schedule of days off per store.

export const salespeople = pgTable(
  "salespeople",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    code: varchar("code", { length: 10 }).notNull(),
    nickname: varchar("nickname", { length: 40 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("salespeople_org_id_key").on(t.organizationId, t.id),
    unique("salespeople_org_membership_key").on(t.organizationId, t.membershipId),
    unique("salespeople_org_code_key").on(t.organizationId, t.code),
    foreignKey({
      name: "salespeople_membership_fk",
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("cascade"),
    check("salespeople_code_format", sql`${t.code} ~ '^[A-Z0-9]{1,10}$'`),
    tenantIsolationPolicy(),
  ],
);

export const salespersonStores = pgTable(
  "salesperson_stores",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    salespersonId: uuid("salesperson_id").notNull(),
    storeId: uuid("store_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.salespersonId, t.storeId] }),
    foreignKey({ name: "salesperson_stores_salesperson_fk", columns: [t.organizationId, t.salespersonId], foreignColumns: [salespeople.organizationId, salespeople.id] }).onDelete("cascade"),
    foreignKey({ name: "salesperson_stores_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }).onDelete("cascade"),
    index("salesperson_stores_store_idx").on(t.organizationId, t.storeId),
    tenantIsolationPolicy(),
  ],
);

export const workSchedules = pgTable(
  "work_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    salespersonId: uuid("salesperson_id").notNull(),
    storeId: uuid("store_id").notNull(),
    // "YYYY-MM".
    month: varchar("month", { length: 7 }).notNull(),
    // Empty = follows the store's work week and calendar.
    daysOff: date("days_off", { mode: "string" }).array().notNull().default(sql`'{}'::date[]`),
    ...timestamps,
  },
  (t) => [
    unique("work_schedules_org_id_key").on(t.organizationId, t.id),
    unique("work_schedules_month_key").on(t.organizationId, t.salespersonId, t.storeId, t.month),
    // The salesperson must be linked to the store.
    foreignKey({
      name: "work_schedules_link_fk",
      columns: [t.organizationId, t.salespersonId, t.storeId],
      foreignColumns: [salespersonStores.organizationId, salespersonStores.salespersonId, salespersonStores.storeId],
    }).onDelete("cascade"),
    check("work_schedules_month_format", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("work_schedules_days_off", sql`cardinality(${t.daysOff}) <= 31`),
    tenantIsolationPolicy(),
  ],
);
