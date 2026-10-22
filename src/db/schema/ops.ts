import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgPolicy, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./structure";
import { isPlatformContext } from "./tenant";

// Operational events (m25): slow database transactions and unexpected errors, by
// organization. No business data: only the kind, the operation name and the
// duration. Any connection may write; only the platform context reads.

export const opsEventKind = pgEnum("ops_event_kind", ["error", "slow_transaction"]);

export const opsEvents = pgTable(
  "ops_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: opsEventKind("kind").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    index("ops_events_created_idx").on(t.createdAt),
    pgPolicy("ops_insert", { for: "insert", withCheck: sql`true` }),
    pgPolicy("ops_platform_read", { for: "select", using: isPlatformContext }),
  ],
);
