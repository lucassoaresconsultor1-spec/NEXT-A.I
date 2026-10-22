import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgEnum, pgTable, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { organizationMemberships } from "./access";
import { aiConversations } from "./ai";
import { alerts } from "./alerts";
import { users } from "./auth";
import { organizations, stores } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn, tenantIsolationPolicy, timestamps } from "./tenant";

// Management tasks (m38a) with an append-only timeline, created only by people
// (from scratch, from an alert or from an assistant conversation), and the
// organization's written procedures.

export const taskStatus = pgEnum("task_status", ["open", "in_progress", "done", "cancelled"]);
export const taskPriority = pgEnum("task_priority", ["low", "normal", "high"]);
export const taskSource = pgEnum("task_source", ["manual", "alert", "assistant"]);
export const taskEventKind = pgEnum("task_event_kind", ["created", "status_changed", "assigned", "comment"]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id"),
    title: varchar("title", { length: 160 }).notNull(),
    description: varchar("description", { length: 2000 }),
    priority: taskPriority("priority").notNull().default("normal"),
    dueDate: date("due_date", { mode: "string" }),
    assigneeMembershipId: uuid("assignee_membership_id"),
    source: taskSource("source").notNull(),
    alertId: uuid("alert_id"),
    conversationId: uuid("conversation_id"),
    status: taskStatus("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("tasks_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "tasks_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({ name: "tasks_assignee_fk", columns: [t.organizationId, t.assigneeMembershipId], foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id] }).onDelete("set null"),
    foreignKey({ name: "tasks_alert_fk", columns: [t.organizationId, t.alertId], foreignColumns: [alerts.organizationId, alerts.id] }),
    foreignKey({ name: "tasks_conversation_fk", columns: [t.organizationId, t.conversationId], foreignColumns: [aiConversations.organizationId, aiConversations.id] }),
    index("tasks_status_idx").on(t.organizationId, t.status, t.storeId),
    index("tasks_assignee_idx").on(t.organizationId, t.assigneeMembershipId),
    check("tasks_source", sql`(${t.source} = 'alert') = (${t.alertId} is not null) and (${t.source} = 'assistant') = (${t.conversationId} is not null)`),
    check("tasks_closed", sql`(${t.status} in ('done', 'cancelled')) = (${t.closedAt} is not null)`),
    tenantIsolationPolicy(),
  ],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    kind: taskEventKind("kind").notNull(),
    text: varchar("text", { length: 1000 }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("task_events_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "task_events_task_fk", columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }),
    index("task_events_task_idx").on(t.organizationId, t.taskId, t.createdAt),
    ...appendOnlyTenantPolicies(),
  ],
);

export const procedures = pgTable(
  "procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    body: varchar("body", { length: 20_000 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique("procedures_org_id_key").on(t.organizationId, t.id), uniqueIndex("procedures_org_title_idx").on(t.organizationId, sql`lower(${t.title})`), tenantIsolationPolicy()],
);
