import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authRateLimits } from "@/db/schema";

// Fixed-window counters in PostgreSQL, so limits hold across app instances.

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

// Failures per account from one IP lock that pair quickly; the per-account limit is
// higher so a stranger knowing an e-mail cannot keep its owner locked out from
// another network, while distributed guessing is still capped.
export const LOGIN_PER_ACCOUNT_AND_IP: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };
export const LOGIN_PER_ACCOUNT: RateLimitRule = { limit: 30, windowSeconds: 15 * 60 };
export const LOGIN_PER_IP: RateLimitRule = { limit: 50, windowSeconds: 15 * 60 };
export const PASSWORD_CHANGE_PER_USER: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };
export const SIGNUP_PER_IP: RateLimitRule = { limit: 10, windowSeconds: 60 * 60 };

/** Counts one attempt atomically and reports whether it is still within the rule. */
export async function hitRateLimit(key: string, rule: RateLimitRule) {
  const db = getDb();
  const expired = sql`${authRateLimits.windowStartedAt} < now() - make_interval(secs => ${rule.windowSeconds})`;
  const [row] = await db
    .insert(authRateLimits)
    .values({ key, attempts: 1, windowStartedAt: sql`now()` })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        attempts: sql`case when ${expired} then 1 else ${authRateLimits.attempts} + 1 end`,
        windowStartedAt: sql`case when ${expired} then now() else ${authRateLimits.windowStartedAt} end`,
      },
    })
    .returning({ attempts: authRateLimits.attempts });
  return { allowed: (row?.attempts ?? 1) <= rule.limit };
}

export async function clearRateLimit(key: string) {
  const db = getDb();
  await db.delete(authRateLimits).where(eq(authRateLimits.key, key));
}

/** Gives back one counted attempt (used when an attempt succeeds, so limits count failures). */
export async function releaseRateLimit(key: string) {
  const db = getDb();
  await db
    .update(authRateLimits)
    .set({ attempts: sql`greatest(${authRateLimits.attempts} - 1, 0)` })
    .where(eq(authRateLimits.key, key));
}
