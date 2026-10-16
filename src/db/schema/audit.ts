import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn } from "./tenant";

// Append-only: RLS grants SELECT and INSERT only, so UPDATE/DELETE are denied
// for every role subject to row security (FORCE is applied in the migration).
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 48 }).notNull(),
    entityId: uuid("entity_id"),
    // Plain column (no FK) so the trail survives store removal.
    storeId: uuid("store_id"),
    // Changed business fields only; never passwords, tokens or full request bodies.
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    ...appendOnlyTenantPolicies(),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
