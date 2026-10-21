import { sql } from "drizzle-orm";
import { bigint, check, pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./structure";
import { organizationIdColumn, tenantIsolationPolicy } from "./tenant";

// Gapless document numbers per organization and scope ("purchase_order",
// "sale:{storeId}"…). The row is locked FOR UPDATE inside the transaction that
// creates the document, so a rollback gives the number back (ADR-014).

export const documentCounters = pgTable(
  "document_counters",
  {
    organizationId: organizationIdColumn().references(() => organizations.id, { onDelete: "cascade" }),
    scope: varchar("scope", { length: 64 }).notNull(),
    lastValue: bigint("last_value", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.scope] }),
    check("document_counters_non_negative", sql`${t.lastValue} >= 0`),
    tenantIsolationPolicy(),
  ],
);
