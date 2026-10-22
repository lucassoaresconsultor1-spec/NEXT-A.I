import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, index, integer, pgEnum, pgTable, primaryKey, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { commissionCampaigns } from "./campaigns";
import { categories } from "./catalog";
import { saleRefunds } from "./refunds";
import { saleItems, sales } from "./sales";
import { salespeople } from "./salespeople";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Commissions (m12a): versioned rules (append-only) and monthly statements per
// salesperson and store, with immutable lines (sales and their reversals by
// cancellations and returns). Money in integer cents; rates in basis points.

const cents = (name: string) => bigint(name, { mode: "number" });
const NONE = sql.raw("'00000000-0000-0000-0000-000000000000'::uuid");

export const commissionRules = pgTable(
  "commission_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    // NULL = every store of the organization.
    storeId: uuid("store_id"),
    version: integer("version").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    defaultRateBps: integer("default_rate_bps").notNull(),
    reason: varchar("reason", { length: 240 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("commission_rules_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("commission_rules_version_key").on(t.organizationId, sql`coalesce(${t.storeId}, ${NONE})`, t.version),
    foreignKey({ name: "commission_rules_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    check("commission_rules_rate", sql`${t.defaultRateBps} between 0 and 10000`),
    check("commission_rules_version", sql`${t.version} >= 1 and (${t.version} = 1 or ${t.reason} is not null)`),
    ...appendOnlyTenantPolicies(),
  ],
);

export const commissionRuleRates = pgTable(
  "commission_rule_rates",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    rateBps: integer("rate_bps").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.ruleId, t.categoryId] }),
    foreignKey({ name: "commission_rule_rates_rule_fk", columns: [t.organizationId, t.ruleId], foreignColumns: [commissionRules.organizationId, commissionRules.id] }),
    foreignKey({ name: "commission_rule_rates_category_fk", columns: [t.organizationId, t.categoryId], foreignColumns: [categories.organizationId, categories.id] }),
    check("commission_rule_rates_rate", sql`${t.rateBps} between 0 and 10000`),
    ...appendOnlyTenantPolicies(),
  ],
);

export const commissionStatementStatus = pgEnum("commission_statement_status", ["calculated", "approved", "paid", "cancelled"]);
export const commissionLineKind = pgEnum("commission_line_kind", ["sale", "refund"]);

export const commissionStatements = pgTable(
  "commission_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    salespersonId: uuid("salesperson_id").notNull(),
    storeId: uuid("store_id").notNull(),
    month: varchar("month", { length: 7 }).notNull(),
    status: commissionStatementStatus("status").notNull().default("calculated"),
    baseCents: cents("base_cents").notNull(),
    commissionCents: cents("commission_cents").notNull(),
    calculatedBy: uuid("calculated_by").references(() => users.id, { onDelete: "set null" }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidBy: uuid("paid_by").references(() => users.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentReference: varchar("payment_reference", { length: 60 }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 240 }),
    ...timestamps,
  },
  (t) => [
    unique("commission_statements_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("commission_statements_active_key").on(t.organizationId, t.salespersonId, t.storeId, t.month).where(sql`${t.status} <> 'cancelled'`),
    foreignKey({ name: "commission_statements_salesperson_fk", columns: [t.organizationId, t.salespersonId], foreignColumns: [salespeople.organizationId, salespeople.id] }),
    foreignKey({ name: "commission_statements_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    index("commission_statements_month_idx").on(t.organizationId, t.month, t.storeId),
    check("commission_statements_month_format", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      "commission_statements_status_fields",
      sql`(${t.status} = 'calculated' and ${t.approvedAt} is null and ${t.paidAt} is null)
        or (${t.status} = 'approved' and ${t.approvedAt} is not null and ${t.paidAt} is null)
        or (${t.status} = 'paid' and ${t.approvedAt} is not null and ${t.paidAt} is not null and ${t.paymentReference} is not null)
        or (${t.status} = 'cancelled' and ${t.cancelledAt} is not null and ${t.cancelReason} is not null and ${t.paidAt} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

export const commissionStatementLines = pgTable(
  "commission_statement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id").notNull(),
    kind: commissionLineKind("kind").notNull(),
    saleId: uuid("sale_id").notNull(),
    saleItemId: uuid("sale_item_id").notNull(),
    refundId: uuid("refund_id"),
    baseCents: cents("base_cents").notNull(),
    rateBps: integer("rate_bps").notNull(),
    commissionCents: cents("commission_cents").notNull(),
    ruleId: uuid("rule_id"),
    // Campaign bonus (m35a) added to the rule rate; 0 without a campaign.
    campaignId: uuid("campaign_id"),
    bonusRateBps: integer("bonus_rate_bps").notNull().default(0),
  },
  (t) => [
    unique("commission_statement_lines_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "commission_lines_statement_fk", columns: [t.organizationId, t.statementId], foreignColumns: [commissionStatements.organizationId, commissionStatements.id] }),
    foreignKey({ name: "commission_lines_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    foreignKey({ name: "commission_lines_item_fk", columns: [t.organizationId, t.saleItemId], foreignColumns: [saleItems.organizationId, saleItems.id] }),
    foreignKey({ name: "commission_lines_refund_fk", columns: [t.organizationId, t.refundId], foreignColumns: [saleRefunds.organizationId, saleRefunds.id] }),
    foreignKey({ name: "commission_lines_rule_fk", columns: [t.organizationId, t.ruleId], foreignColumns: [commissionRules.organizationId, commissionRules.id] }),
    foreignKey({ name: "commission_lines_campaign_fk", columns: [t.organizationId, t.campaignId], foreignColumns: [commissionCampaigns.organizationId, commissionCampaigns.id] }),
    index("commission_lines_statement_idx").on(t.organizationId, t.statementId),
    check("commission_lines_kind", sql`(${t.kind} = 'refund') = (${t.refundId} is not null) and (${t.kind} = 'sale') = (${t.baseCents} >= 0)`),
    check("commission_lines_rate", sql`${t.rateBps} between 0 and 10000`),
    check("commission_lines_bonus", sql`${t.bonusRateBps} between 0 and 10000 and (${t.campaignId} is null) = (${t.bonusRateBps} = 0)`),
    ...appendOnlyTenantPolicies(),
  ],
);
