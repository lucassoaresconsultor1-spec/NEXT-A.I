import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { organizationMemberships } from "./access";
import { users } from "./auth";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Reports (m18): append-only history of generated CSV files and schedules that
// run as their owner. E-mail delivery is pending until a provider is configured.

export const reportKind = pgEnum("report_kind", ["sales_by_period", "sales_by_store", "sales_by_salesperson", "expenses", "daily_closings"]);
export const reportRunStatus = pgEnum("report_run_status", ["done", "failed"]);
export const reportPeriod = pgEnum("report_period", ["yesterday", "last_7_days", "month_to_date", "last_month"]);
export const reportFrequency = pgEnum("report_frequency", ["daily", "weekly", "monthly"]);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    kind: reportKind("kind").notNull(),
    period: reportPeriod("period").notNull(),
    frequency: reportFrequency("frequency").notNull(),
    // Local hour in the organization time zone.
    hour: integer("hour").notNull(),
    storeId: uuid("store_id"),
    groupBy: varchar("group_by", { length: 8 }),
    ownerMembershipId: uuid("owner_membership_id").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    // No e-mail provider yet: generated files stay in the history.
    delivery: varchar("delivery", { length: 16 }).notNull().default("pending"),
    ...timestamps,
  },
  (t) => [
    unique("report_schedules_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "report_schedules_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({
      name: "report_schedules_owner_fk",
      columns: [t.organizationId, t.ownerMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("cascade"),
    index("report_schedules_due_idx").on(t.nextRunAt).where(sql`${t.isActive}`),
    check("report_schedules_hour", sql`${t.hour} between 0 and 23`),
    tenantIsolationPolicy(),
  ],
);

export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    kind: reportKind("kind").notNull(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    storeId: uuid("store_id"),
    groupBy: varchar("group_by", { length: 8 }),
    status: reportRunStatus("status").notNull(),
    rowCount: integer("row_count").notNull(),
    content: text("content"),
    failureReason: varchar("failure_reason", { length: 240 }),
    scheduleId: uuid("schedule_id"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("report_runs_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "report_runs_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({ name: "report_runs_schedule_fk", columns: [t.organizationId, t.scheduleId], foreignColumns: [reportSchedules.organizationId, reportSchedules.id] }),
    index("report_runs_org_created_idx").on(t.organizationId, t.createdAt),
    check("report_runs_status_fields", sql`(${t.status} = 'done') = (${t.content} is not null) and (${t.status} = 'failed') = (${t.failureReason} is not null)`),
    ...appendOnlyTenantPolicies(),
  ],
);
