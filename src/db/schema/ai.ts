import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./structure";
import { appendOnlyTenantPolicies, organizationIdColumn } from "./tenant";

// AI usage (m20): one append-only row per model call with tokens, estimated cost
// and outcome; never the text of the conversation.

export const aiUsageStatus = pgEnum("ai_usage_status", ["ok", "error"]);

export const aiUsageRecords = pgTable(
  "ai_usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    feature: varchar("feature", { length: 24 }).notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    model: varchar("model", { length: 80 }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // Millionths of a real, from the price the adapter declares; null when it declares none.
    costMicros: bigint("cost_micros", { mode: "number" }),
    durationMs: integer("duration_ms").notNull(),
    status: aiUsageStatus("status").notNull(),
    errorKind: varchar("error_kind", { length: 24 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("ai_usage_records_org_id_key").on(t.organizationId, t.id),
    index("ai_usage_records_org_created_idx").on(t.organizationId, t.createdAt),
    check("ai_usage_records_tokens", sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.durationMs} >= 0`),
    check("ai_usage_records_error", sql`(${t.status} = 'error') = (${t.errorKind} is not null)`),
    ...appendOnlyTenantPolicies(),
  ],
);

// Assistant conversations (m21): visible only to their user; append-only.

export const aiMessageRole = pgEnum("ai_message_role", ["user", "assistant"]);
export const aiToolRunStatus = pgEnum("ai_tool_run_status", ["ok", "error", "blocked"]);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [unique("ai_conversations_org_id_key").on(t.organizationId, t.id), index("ai_conversations_user_idx").on(t.organizationId, t.userId, t.createdAt), ...appendOnlyTenantPolicies()],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    role: aiMessageRole("role").notNull(),
    text: varchar("text", { length: 20_000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("ai_messages_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "ai_messages_conversation_fk", columns: [t.organizationId, t.conversationId], foreignColumns: [aiConversations.organizationId, aiConversations.id] }).onDelete("cascade"),
    index("ai_messages_conversation_idx").on(t.organizationId, t.conversationId, t.createdAt),
    ...appendOnlyTenantPolicies(),
  ],
);

export const aiToolRuns = pgTable(
  "ai_tool_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    tool: varchar("tool", { length: 60 }).notNull(),
    params: varchar("params", { length: 2_000 }),
    status: aiToolRunStatus("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    error: varchar("error", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("ai_tool_runs_org_id_key").on(t.organizationId, t.id),
    foreignKey({ name: "ai_tool_runs_conversation_fk", columns: [t.organizationId, t.conversationId], foreignColumns: [aiConversations.organizationId, aiConversations.id] }).onDelete("cascade"),
    index("ai_tool_runs_conversation_idx").on(t.organizationId, t.conversationId),
    ...appendOnlyTenantPolicies(),
  ],
);

// Specialist evaluations (m39): the orchestrator consults a specialist only while
// its latest evaluation in the organization measured a benefit.
export const aiSpecialistEvaluations = pgTable(
  "ai_specialist_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    specialist: varchar("specialist", { length: 24 }).notNull(),
    cases: integer("cases").notNull(),
    centralPassed: integer("central_passed").notNull(),
    specialistPassed: integer("specialist_passed").notNull(),
    centralTokens: integer("central_tokens").notNull(),
    specialistTokens: integer("specialist_tokens").notNull(),
    enabled: boolean("enabled").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("ai_specialist_evaluations_org_id_key").on(t.organizationId, t.id),
    index("ai_specialist_evaluations_latest_idx").on(t.organizationId, t.specialist, t.createdAt),
    check("ai_specialist_evaluations_counts", sql`${t.cases} > 0 and ${t.centralPassed} between 0 and ${t.cases} and ${t.specialistPassed} between 0 and ${t.cases}`),
    ...appendOnlyTenantPolicies(),
  ],
);
