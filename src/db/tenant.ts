import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "./index";

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
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.organization_id', ${scope.organizationId ?? ""}, true),
      set_config('app.user_id', ${scope.userId ?? ""}, true),
      set_config('app.platform', ${scope.platform ? "on" : ""}, true)`);
    return work(tx);
  });
}
