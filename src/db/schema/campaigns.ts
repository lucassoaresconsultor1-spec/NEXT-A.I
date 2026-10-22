import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, primaryKey, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { categories, products } from "./catalog";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Commission campaigns (m35a): a bonus rate in basis points added to the rule's rate
// for the items of the chosen products or categories, sold in a period (local days
// of the store). Never retroactive; ending only shortens the period or cancels it.

export const commissionCampaigns = pgTable(
  "commission_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    // NULL = every store of the organization.
    storeId: uuid("store_id"),
    name: varchar("name", { length: 80 }).notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    bonusRateBps: integer("bonus_rate_bps").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    endedBy: uuid("ended_by").references(() => users.id, { onDelete: "set null" }),
    endReason: varchar("end_reason", { length: 240 }),
    ...timestamps,
  },
  (t) => [
    unique("commission_campaigns_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "commission_campaigns_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    index("commission_campaigns_period_idx").on(t.organizationId, t.startsOn, t.endsOn),
    check("commission_campaigns_bonus", sql`${t.bonusRateBps} between 1 and 10000`),
    check("commission_campaigns_period", sql`${t.endsOn} >= ${t.startsOn}`),
    tenantIsolationPolicy(),
  ],
);

export const commissionCampaignItems = pgTable(
  "commission_campaign_items",
  {
    id: uuid("id").notNull().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull(),
    productId: uuid("product_id"),
    categoryId: uuid("category_id"),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    foreignKey({ name: "commission_campaign_items_campaign_fk", columns: [t.organizationId, t.campaignId], foreignColumns: [commissionCampaigns.organizationId, commissionCampaigns.id] }),
    foreignKey({ name: "commission_campaign_items_product_fk", columns: [t.organizationId, t.productId], foreignColumns: [products.organizationId, products.id] }),
    foreignKey({ name: "commission_campaign_items_category_fk", columns: [t.organizationId, t.categoryId], foreignColumns: [categories.organizationId, categories.id] }),
    index("commission_campaign_items_campaign_idx").on(t.organizationId, t.campaignId),
    check("commission_campaign_items_target", sql`(${t.productId} is null) <> (${t.categoryId} is null)`),
    ...appendOnlyTenantPolicies(),
  ],
);
