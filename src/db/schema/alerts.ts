import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, pgEnum, pgTable, primaryKey, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { organizationMemberships } from "./access";
import { users } from "./auth";
import { organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Proactive alerts (m23a): rules fixed in code with thresholds set by the
// organization (a rule without its threshold never runs), and alerts deduplicated
// by key while open.

export const alertKind = pgEnum("alert_kind", ["low_stock", "cash_difference", "reconciliation_divergent", "queue_abandonment", "target_at_risk"]);
export const alertSeverity = pgEnum("alert_severity", ["info", "warning", "critical"]);
export const alertStatus = pgEnum("alert_status", ["open", "acknowledged", "resolved"]);

export const alertRules = pgTable(
  "alert_rules",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    kind: alertKind("kind").notNull(),
    isEnabled: boolean("is_enabled").notNull(),
    severity: alertSeverity("severity").notNull(),
    // Unit depends on the kind: thousandths of quantity, cents, count or percent.
    threshold: bigint("threshold", { mode: "number" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.kind] }), check("alert_rules_threshold", sql`${t.threshold} is null or ${t.threshold} >= 0`), tenantIsolationPolicy()],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    kind: alertKind("kind").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    storeId: uuid("store_id"),
    severity: alertSeverity("severity").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    detail: varchar("detail", { length: 500 }).notNull(),
    status: alertStatus("status").notNull().default("open"),
    assignedMembershipId: uuid("assigned_membership_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolutionNote: varchar("resolution_note", { length: 240 }),
    ...timestamps,
  },
  (t) => [
    unique("alerts_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("alerts_open_dedupe_key").on(t.organizationId, t.dedupeKey).where(sql`${t.status} <> 'resolved'`),
    foreignKey({ name: "alerts_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }).onDelete("cascade"),
    foreignKey({ name: "alerts_assignee_fk", columns: [t.organizationId, t.assignedMembershipId], foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id] }).onDelete("set null"),
    index("alerts_status_idx").on(t.organizationId, t.status, t.storeId),
    check("alerts_resolution", sql`(${t.status} = 'resolved') = (${t.resolvedAt} is not null and ${t.resolutionNote} is not null)`),
    tenantIsolationPolicy(),
  ],
);
