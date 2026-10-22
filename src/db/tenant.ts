import "server-only";
import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { getDb } from "./index";
import { recordOpsEvent } from "./ops";

const SLOW_TRANSACTION_MS = 1_000;

export type Database = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DbScope {
  /** Active organization; RLS hides every tenant row of other organizations. */
  organizationId?: string | null;
  /** Authenticated user; lets the user read their own memberships across organizations. */
  userId?: string | null;
  /** Platform administration (organizations and plans only, never tenant rows). */
  platform?: boolean;
}

/**
 * Runs `work` in one transaction whose RLS settings are transaction-local
 * (`set_config(..., true)`), so pooled connections never leak a tenant.
 * Every query that touches tenant tables must go through here.
 */
export async function withScope<T>(scope: DbScope, work: (tx: Tx) => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await getDb().transaction(async (tx) => {
      await tx.execute(sql`select
      set_config('app.organization_id', ${scope.organizationId ?? ""}, true),
      set_config('app.user_id', ${scope.userId ?? ""}, true),
      set_config('app.platform', ${scope.platform ? "on" : ""}, true)`);
      return work(tx);
    });
  } finally {
    // Observability (m25): slow transactions are logged and counted by organization.
    const durationMs = Date.now() - started;
    if (durationMs >= SLOW_TRANSACTION_MS) {
      logger.warn({ organizationId: scope.organizationId ?? null, durationMs }, "Slow database transaction");
      void recordOpsEvent({ kind: "slow_transaction", organizationId: scope.organizationId ?? null, name: "transaction", durationMs });
    }
  }
}
