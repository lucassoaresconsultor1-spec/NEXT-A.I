import { sql } from "drizzle-orm";
import { pgPolicy, timestamp, uuid } from "drizzle-orm/pg-core";

// Transaction-local settings written by withTenant() (src/db/tenant.ts).
// An unset value becomes NULL, so a query outside a tenant transaction sees no rows.
export const currentOrganizationId = sql.raw(
  "nullif(current_setting('app.organization_id', true), '')::uuid",
);
export const currentUserId = sql.raw("nullif(current_setting('app.user_id', true), '')::uuid");
export const isPlatformContext = sql.raw("coalesce(current_setting('app.platform', true), '') = 'on'");

export const organizationIdColumn = () => uuid("organization_id").notNull();

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Row-level isolation shared by every table that carries organization_id. */
export function tenantIsolationPolicy() {
  return pgPolicy("tenant_isolation", {
    for: "all",
    using: sql`organization_id = ${currentOrganizationId}`,
    withCheck: sql`organization_id = ${currentOrganizationId}`,
  });
}

/** Append-only tables: rows can be read and inserted inside the tenant, never changed. */
export function appendOnlyTenantPolicies() {
  return [
    pgPolicy("tenant_read", { for: "select", using: sql`organization_id = ${currentOrganizationId}` }),
    pgPolicy("tenant_insert", { for: "insert", withCheck: sql`organization_id = ${currentOrganizationId}` }),
  ];
}
