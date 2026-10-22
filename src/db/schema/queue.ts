import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgEnum, pgTable, primaryKey, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { sales } from "./sales";
import { salespeople, salespersonStores } from "./salespeople";
import { departments, organizations, stores } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Store service queue (m13a): salesperson presence for the rotation and the
// customers' attendances, from arrival to finish (with or without a linked sale)
// or abandonment. No customer personal data: only a short optional note.

export const queuePresenceStatus = pgEnum("queue_presence_status", ["available", "busy", "away"]);
export const queueEntryStatus = pgEnum("queue_entry_status", ["waiting", "in_service", "finished", "abandoned"]);
export const queueAssignment = pgEnum("queue_assignment", ["rotation", "manual"]);
export const queueOutcome = pgEnum("queue_outcome", ["sale", "no_sale"]);

export const queuePresence = pgTable(
  "queue_presence",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    salespersonId: uuid("salesperson_id").notNull(),
    status: queuePresenceStatus("status").notNull(),
    // Rotation order: the available salesperson waiting the longest goes next.
    since: timestamp("since", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.storeId, t.salespersonId] }),
    foreignKey({
      name: "queue_presence_link_fk",
      columns: [t.organizationId, t.salespersonId, t.storeId],
      foreignColumns: [salespersonStores.organizationId, salespersonStores.salespersonId, salespersonStores.storeId],
    }).onDelete("cascade"),
    tenantIsolationPolicy(),
  ],
);

export const queueEntries = pgTable(
  "queue_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    ticket: integer("ticket").notNull(),
    // Local day of the store, "YYYY-MM-DD" (tickets restart every day).
    day: varchar("day", { length: 10 }).notNull(),
    status: queueEntryStatus("status").notNull().default("waiting"),
    note: varchar("note", { length: 80 }),
    // Requested sector/specialty: the rotation then only calls salespeople of that department.
    departmentId: uuid("department_id"),
    requestKey: uuid("request_key").notNull(),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    salespersonId: uuid("salesperson_id"),
    assignment: queueAssignment("assignment"),
    assignmentReason: varchar("assignment_reason", { length: 240 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: queueOutcome("outcome"),
    saleId: uuid("sale_id"),
    closingReason: varchar("closing_reason", { length: 240 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("queue_entries_org_id_key").on(t.organizationId, t.id),
    unique("queue_entries_org_request_key").on(t.organizationId, t.requestKey),
    unique("queue_entries_ticket_key").on(t.organizationId, t.storeId, t.day, t.ticket),
    uniqueIndex("queue_entries_sale_key").on(t.organizationId, t.saleId).where(sql`${t.saleId} is not null`),
    foreignKey({ name: "queue_entries_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({ name: "queue_entries_salesperson_fk", columns: [t.organizationId, t.salespersonId], foreignColumns: [salespeople.organizationId, salespeople.id] }),
    foreignKey({ name: "queue_entries_sale_fk", columns: [t.organizationId, t.saleId], foreignColumns: [sales.organizationId, sales.id] }),
    foreignKey({ name: "queue_entries_department_fk", columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }),
    index("queue_entries_store_status_idx").on(t.organizationId, t.storeId, t.status, t.arrivedAt),
    index("queue_entries_store_day_idx").on(t.organizationId, t.storeId, t.day),
    check(
      "queue_entries_status_fields",
      sql`(${t.status} = 'waiting' and ${t.salespersonId} is null and ${t.startedAt} is null and ${t.finishedAt} is null)
        or (${t.status} = 'in_service' and ${t.salespersonId} is not null and ${t.startedAt} is not null and ${t.finishedAt} is null)
        or (${t.status} = 'finished' and ${t.salespersonId} is not null and ${t.finishedAt} is not null and ${t.outcome} is not null)
        or (${t.status} = 'abandoned' and ${t.salespersonId} is null and ${t.finishedAt} is not null and ${t.closingReason} is not null)`,
    ),
    check("queue_entries_assignment", sql`(${t.salespersonId} is null) = (${t.assignment} is null) and (${t.assignment} <> 'manual' or ${t.assignmentReason} is not null)`),
    check("queue_entries_outcome", sql`(${t.outcome} = 'sale') = (${t.saleId} is not null) and (${t.outcome} <> 'no_sale' or ${t.closingReason} is not null)`),
    tenantIsolationPolicy(),
  ],
);

/** Sectors/specialties of a salesperson (departments of the organization) for the queue rotation. */
export const salespersonDepartments = pgTable(
  "salesperson_departments",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    salespersonId: uuid("salesperson_id").notNull(),
    departmentId: uuid("department_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.salespersonId, t.departmentId] }),
    foreignKey({ name: "salesperson_departments_salesperson_fk", columns: [t.organizationId, t.salespersonId], foreignColumns: [salespeople.organizationId, salespeople.id] }).onDelete("cascade"),
    foreignKey({ name: "salesperson_departments_department_fk", columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }).onDelete("cascade"),
    tenantIsolationPolicy(),
  ],
);
