import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, pgEnum, pgTable, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Cash registers, cash sessions and the cash ledger of each session. Expected
// cash and the closing difference are computed from the ledger on the server;
// movements and session events are append-only.

const cents = (name: string) => bigint(name, { mode: "number" });

export const cashSessionStatus = pgEnum("cash_session_status", ["open", "closed"]);
export const cashMovementType = pgEnum("cash_movement_type", ["opening", "supply", "withdrawal", "sale", "refund"]);
export const cashSessionEventType = pgEnum("cash_session_event_type", ["opened", "closed", "reopened"]);

export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    name: varchar("name", { length: 60 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("cash_registers_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("cash_registers_store_name_idx").on(t.organizationId, t.storeId, sql`lower(${t.name})`),
    foreignKey({ name: "cash_registers_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    tenantIsolationPolicy(),
  ],
);

export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    registerId: uuid("register_id").notNull(),
    storeId: uuid("store_id").notNull(),
    status: cashSessionStatus("status").notNull().default("open"),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    openingAmountCents: cents("opening_amount_cents").notNull(),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    countedAmountCents: cents("counted_amount_cents"),
    expectedAmountCents: cents("expected_amount_cents"),
    differenceCents: cents("difference_cents"),
    closingNote: varchar("closing_note", { length: 500 }),
    openIdempotencyKey: uuid("open_idempotency_key").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("cash_sessions_org_id_key").on(t.organizationId, t.id),
    unique("cash_sessions_org_open_key_key").on(t.organizationId, t.openIdempotencyKey),
    uniqueIndex("cash_sessions_open_register_idx").on(t.organizationId, t.registerId).where(sql`${t.status} = 'open'`),
    uniqueIndex("cash_sessions_open_operator_idx").on(t.organizationId, t.openedBy).where(sql`${t.status} = 'open'`),
    index("cash_sessions_store_opened_idx").on(t.organizationId, t.storeId, t.openedAt),
    foreignKey({
      name: "cash_sessions_register_fk",
      columns: [t.organizationId, t.registerId],
      foreignColumns: [cashRegisters.organizationId, cashRegisters.id],
    }),
    foreignKey({ name: "cash_sessions_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    check("cash_sessions_opening_non_negative", sql`${t.openingAmountCents} >= 0`),
    check(
      "cash_sessions_status_fields",
      sql`(${t.status} = 'open' and ${t.closedAt} is null and ${t.countedAmountCents} is null and ${t.expectedAmountCents} is null and ${t.differenceCents} is null)
        or (${t.status} = 'closed' and ${t.closedAt} is not null and ${t.countedAmountCents} is not null and ${t.expectedAmountCents} is not null and ${t.differenceCents} is not null)`,
    ),
    check("cash_sessions_counted_non_negative", sql`${t.countedAmountCents} is null or ${t.countedAmountCents} >= 0`),
    tenantIsolationPolicy(),
  ],
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    storeId: uuid("store_id").notNull(),
    type: cashMovementType("type").notNull(),
    amountCents: cents("amount_cents").notNull(),
    reason: varchar("reason", { length: 240 }),
    referenceKind: varchar("reference_kind", { length: 16 }),
    referenceId: uuid("reference_id"),
    idempotencyKey: uuid("idempotency_key"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("cash_movements_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("cash_movements_org_key_idx").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("cash_movements_session_idx").on(t.organizationId, t.sessionId, t.createdAt),
    foreignKey({
      name: "cash_movements_session_fk",
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [cashSessions.organizationId, cashSessions.id],
    }),
    check("cash_movements_amount", sql`(${t.type} = 'opening' and ${t.amountCents} >= 0) or ${t.amountCents} > 0`),
    check("cash_movements_reason", sql`${t.type} not in ('supply', 'withdrawal') or ${t.reason} is not null`),
    check("cash_movements_reference", sql`${t.type} not in ('sale', 'refund') or (${t.referenceKind} is not null and ${t.referenceId} is not null)`),
    ...appendOnlyTenantPolicies(),
  ],
);

export const cashSessionEvents = pgTable(
  "cash_session_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    type: cashSessionEventType("type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: varchar("reason", { length: 500 }),
    countedCents: cents("counted_cents"),
    expectedCents: cents("expected_cents"),
    differenceCents: cents("difference_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("cash_session_events_org_id_key").on(t.organizationId, t.id),
    index("cash_session_events_session_idx").on(t.organizationId, t.sessionId, t.createdAt),
    foreignKey({
      name: "cash_session_events_session_fk",
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [cashSessions.organizationId, cashSessions.id],
    }),
    ...appendOnlyTenantPolicies(),
  ],
);
