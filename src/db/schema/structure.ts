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
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  currentOrganizationId,
  isPlatformContext,
  organizationIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from "./tenant";

// ---- Commercial plans (global catalog, values are commercial hypotheses) ----

export const plans = pgTable("plans", {
  key: varchar("key", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description").notNull(),
  // NULL means "no limit configured".
  maxStores: integer("max_stores"),
  maxMembers: integer("max_members"),
  // AI tokens (input + output) per calendar month; NULL = no limit configured (m40).
  maxAiTokensPerMonth: integer("max_ai_tokens_per_month"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const planFeatures = pgTable(
  "plan_features",
  {
    planKey: varchar("plan_key", { length: 32 }).notNull().references(() => plans.key, { onDelete: "cascade" }),
    feature: varchar("feature", { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.planKey, t.feature] })],
);

// ---- Organizations (tenants) ----

export const organizationStatus = pgEnum("organization_status", ["active", "suspended"]);

const memberOfOrganization = sql.raw(
  `id in (select m.organization_id from organization_memberships m
    where m.user_id = nullif(current_setting('app.user_id', true), '')::uuid and m.status = 'active')`,
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    legalName: varchar("legal_name", { length: 160 }),
    // CNPJ normalized to 14 uppercase characters (alphanumeric CNPJ supported).
    document: varchar("document", { length: 14 }).unique(),
    planKey: varchar("plan_key", { length: 32 }).notNull().references(() => plans.key),
    status: organizationStatus("status").notNull().default("active"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("America/Sao_Paulo"),
    ...timestamps,
  },
  () => [
    pgPolicy("organization_read", {
      for: "select",
      using: sql`id = ${currentOrganizationId} or ${isPlatformContext} or ${memberOfOrganization}`,
    }),
    pgPolicy("organization_insert", {
      for: "insert",
      withCheck: sql`id = ${currentOrganizationId} or ${isPlatformContext}`,
    }),
    pgPolicy("organization_update", {
      for: "update",
      using: sql`id = ${currentOrganizationId} or ${isPlatformContext}`,
      withCheck: sql`id = ${currentOrganizationId} or ${isPlatformContext}`,
    }),
  ],
);

// ---- Regions, stores and departments ----

export const regions = pgTable(
  "regions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    description: varchar("description", { length: 240 }),
    ...timestamps,
  },
  (t) => [
    unique("regions_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("regions_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    tenantIsolationPolicy(),
  ],
);

export const storeStatus = pgEnum("store_status", ["active", "inactive"]);

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    regionId: uuid("region_id"),
    code: varchar("code", { length: 16 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    document: varchar("document", { length: 14 }),
    phone: varchar("phone", { length: 11 }),
    email: varchar("email", { length: 254 }),
    postalCode: varchar("postal_code", { length: 8 }),
    street: varchar("street", { length: 160 }),
    number: varchar("number", { length: 16 }),
    complement: varchar("complement", { length: 80 }),
    district: varchar("district", { length: 80 }),
    city: varchar("city", { length: 80 }),
    state: varchar("state", { length: 2 }),
    // NULL inherits the organization time zone.
    timezone: varchar("timezone", { length: 64 }),
    status: storeStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    unique("stores_org_id_key").on(t.organizationId, t.id),
    unique("stores_org_code_key").on(t.organizationId, t.code),
    // Composite key: a store can only point at a region of the same organization.
    foreignKey({
      name: "stores_region_fk",
      columns: [t.organizationId, t.regionId],
      foreignColumns: [regions.organizationId, regions.id],
    }),
    index("stores_org_region_idx").on(t.organizationId, t.regionId),
    index("stores_org_status_idx").on(t.organizationId, t.status),
    tenantIsolationPolicy(),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    description: varchar("description", { length: 240 }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("departments_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("departments_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    tenantIsolationPolicy(),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type Region = typeof regions.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Plan = typeof plans.$inferSelect;
