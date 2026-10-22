import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, index, integer, pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { paymentIntents } from "./payments";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn } from "./tenant";

// Daily store closing (m37a): an append-only snapshot of a local day (closing again
// adds a version) with the reconciliation of provider payments.

const cents = (name: string) => bigint(name, { mode: "number" });

export const reconciliationStatus = pgEnum("reconciliation_status", ["not_configured", "no_payments", "reconciled", "divergent"]);
export const divergenceKind = pgEnum("divergence_kind", ["status_mismatch", "amount_mismatch", "unreachable"]);

export const dailyClosings = pgTable(
  "daily_closings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    version: integer("version").notNull(),
    saleCount: integer("sale_count").notNull(),
    salesCents: cents("sales_cents").notNull(),
    cancelledCents: cents("cancelled_cents").notNull(),
    returnedCents: cents("returned_cents").notNull(),
    cashCents: cents("cash_cents").notNull(),
    cardExternalCents: cents("card_external_cents").notNull(),
    pixCents: cents("pix_cents").notNull(),
    cardProviderCents: cents("card_provider_cents").notNull(),
    cashDifferenceCents: cents("cash_difference_cents").notNull(),
    reconciliation: reconciliationStatus("reconciliation").notNull(),
    reconciledCount: integer("reconciled_count").notNull(),
    divergentCount: integer("divergent_count").notNull(),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("daily_closings_org_id_key").on(t.organizationId, t.id),
    unique("daily_closings_version_key").on(t.organizationId, t.storeId, t.day, t.version),
    foreignKey({ name: "daily_closings_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    index("daily_closings_day_idx").on(t.organizationId, t.day),
    check("daily_closings_counts", sql`${t.version} >= 1 and ${t.saleCount} >= 0 and ${t.reconciledCount} >= 0 and ${t.divergentCount} >= 0`),
    ...appendOnlyTenantPolicies(),
  ],
);

export const reconciliationDivergences = pgTable(
  "reconciliation_divergences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    closingId: uuid("closing_id").notNull(),
    intentId: uuid("intent_id").notNull(),
    providerReference: varchar("provider_reference", { length: 120 }).notNull(),
    kind: divergenceKind("kind").notNull(),
    ourStatus: varchar("our_status", { length: 16 }).notNull(),
    providerStatus: varchar("provider_status", { length: 16 }),
    ourCents: cents("our_cents").notNull(),
    providerCents: cents("provider_cents"),
  },
  (t) => [
    unique("reconciliation_divergences_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "reconciliation_divergences_closing_fk", columns: [t.organizationId, t.closingId], foreignColumns: [dailyClosings.organizationId, dailyClosings.id] }),
    foreignKey({ name: "reconciliation_divergences_intent_fk", columns: [t.organizationId, t.intentId], foreignColumns: [paymentIntents.organizationId, paymentIntents.id] }),
    ...appendOnlyTenantPolicies(),
  ],
);
