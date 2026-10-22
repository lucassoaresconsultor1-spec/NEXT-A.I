import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
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
