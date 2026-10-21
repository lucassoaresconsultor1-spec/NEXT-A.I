import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashSessions } from "./cash";
import { paymentMethod, paymentStatus, sales } from "./sales";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Provider payments (PIX, integrated card) as intents created before the sale
// and confirmed only by an authenticated webhook or a status query to the
// provider (ADR-005). A sale consumes at most one confirmed intent per payment.

const cents = (name: string) => bigint(name, { mode: "number" });

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    cashSessionId: uuid("cash_session_id").notNull(),
    operatorUserId: uuid("operator_user_id")
      .notNull()
      .references(() => users.id),
    method: paymentMethod("method").notNull(),
    amountCents: cents("amount_cents").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerReference: varchar("provider_reference", { length: 120 }),
    pixQrCode: text("pix_qr_code"),
    pixCopyPaste: text("pix_copy_paste"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    failureReason: varchar("failure_reason", { length: 40 }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    saleId: uuid("sale_id"),
    ...timestamps,
  },
  (t) => [
    unique("payment_intents_org_id_key").on(t.organizationId, t.id),
    unique("payment_intents_org_key_key").on(t.organizationId, t.idempotencyKey),
    unique("payment_intents_provider_reference_key").on(t.provider, t.providerReference),
    foreignKey({ name: "payment_intents_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({
      name: "payment_intents_session_fk",
      columns: [t.organizationId, t.cashSessionId],
      foreignColumns: [cashSessions.organizationId, cashSessions.id],
    }),
    foreignKey({ name: "payment_intents_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    index("payment_intents_store_status_idx").on(t.organizationId, t.storeId, t.status),
    check("payment_intents_amount_positive", sql`${t.amountCents} > 0`),
    check("payment_intents_provider_method", sql`${t.method} in ('pix', 'card_provider')`),
    check("payment_intents_sale_confirmed", sql`${t.saleId} is null or ${t.status} in ('confirmed', 'refunded')`),
    tenantIsolationPolicy(),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    intentId: uuid("intent_id").notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    eventId: varchar("event_id", { length: 120 }).notNull(),
    status: paymentStatus("status").notNull(),
    amountCents: cents("amount_cents").notNull(),
    source: varchar("source", { length: 16 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("payment_events_provider_event_key").on(t.provider, t.eventId),
    foreignKey({
      name: "payment_events_intent_fk",
      columns: [t.organizationId, t.intentId],
      foreignColumns: [paymentIntents.organizationId, paymentIntents.id],
    }),
    index("payment_events_intent_idx").on(t.organizationId, t.intentId),
    check("payment_events_source", sql`${t.source} in ('webhook', 'query')`),
    ...appendOnlyTenantPolicies(),
  ],
);

/**
 * Global map from a provider reference to its organization, read by the webhook,
 * which arrives without a session. Holds ids only; no amounts, statuses or
 * customer data (same treatment as auth_rate_limits: no tenant RLS).
 */
export const paymentProviderReferences = pgTable(
  "payment_provider_references",
  {
    provider: varchar("provider", { length: 40 }).notNull(),
    providerReference: varchar("provider_reference", { length: 120 }).notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    intentId: uuid("intent_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerReference] })],
);
