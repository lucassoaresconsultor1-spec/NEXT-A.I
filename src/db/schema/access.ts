import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations, regions, stores } from "./structure";
import { currentOrganizationId, currentUserId, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    // System roles use the keys from src/server/authz/system-roles.ts; their
    // permissions come from code. Custom roles store permissions in role_permissions.
    key: varchar("key", { length: 48 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    description: varchar("description", { length: 240 }),
    isSystem: boolean("is_system").notNull().default(false),
    // Hierarchy used to block privilege escalation: a member only manages lower ranks.
    rank: integer("rank").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("roles_org_id_key").on(t.organizationId, t.id),
    unique("roles_org_key_key").on(t.organizationId, t.key),
    tenantIsolationPolicy(),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    organizationId: organizationIdColumn(),
    roleId: uuid("role_id").notNull(),
    permission: varchar("permission", { length: 64 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    foreignKey({
      name: "role_permissions_role_fk",
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy(),
  ],
);

export const membershipStatus = pgEnum("membership_status", ["active", "suspended"]);
export const storeAccess = pgEnum("store_access", ["all", "regions", "stores"]);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull(),
    storeAccess: storeAccess("store_access").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("memberships_org_id_key").on(t.organizationId, t.id),
    unique("memberships_org_user_key").on(t.organizationId, t.userId),
    foreignKey({
      name: "memberships_role_fk",
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
    index("memberships_user_idx").on(t.userId),
    // A user may read their own memberships across organizations (organization picker);
    // every other access is limited to the active organization.
    pgPolicy("membership_read", {
      for: "select",
      using: sql`organization_id = ${currentOrganizationId} or user_id = ${currentUserId}`,
    }),
    pgPolicy("membership_insert", { for: "insert", withCheck: sql`organization_id = ${currentOrganizationId}` }),
    pgPolicy("membership_update", {
      for: "update",
      using: sql`organization_id = ${currentOrganizationId}`,
      withCheck: sql`organization_id = ${currentOrganizationId}`,
    }),
    pgPolicy("membership_delete", { for: "delete", using: sql`organization_id = ${currentOrganizationId}` }),
  ],
);

export const membershipRegions = pgTable(
  "membership_regions",
  {
    organizationId: organizationIdColumn(),
    membershipId: uuid("membership_id").notNull(),
    regionId: uuid("region_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.regionId] }),
    foreignKey({
      name: "membership_regions_membership_fk",
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("cascade"),
    // No cascade: deleting a region still referenced by a member scope must fail,
    // even when the link is created concurrently with the deletion.
    foreignKey({
      name: "membership_regions_region_fk",
      columns: [t.organizationId, t.regionId],
      foreignColumns: [regions.organizationId, regions.id],
    }),
    index("membership_regions_region_idx").on(t.organizationId, t.regionId),
    tenantIsolationPolicy(),
  ],
);

export const membershipStores = pgTable(
  "membership_stores",
  {
    organizationId: organizationIdColumn(),
    membershipId: uuid("membership_id").notNull(),
    storeId: uuid("store_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.storeId] }),
    foreignKey({
      name: "membership_stores_membership_fk",
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "membership_stores_store_fk",
      columns: [t.organizationId, t.storeId],
      foreignColumns: [stores.organizationId, stores.id],
    }).onDelete("cascade"),
    index("membership_stores_store_idx").on(t.organizationId, t.storeId),
    tenantIsolationPolicy(),
  ],
);

export type Role = typeof roles.$inferSelect;
export type OrganizationMembership = typeof organizationMemberships.$inferSelect;
