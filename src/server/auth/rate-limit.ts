import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authRateLimits } from "@/db/schema";

// Fixed-window counters in PostgreSQL, so limits hold across app instances.

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const LOGIN_PER_ACCOUNT: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };
export const LOGIN_PER_IP: RateLimitRule = { limit: 50, windowSeconds: 15 * 60 };
export const SIGNUP_PER_IP: RateLimitRule = { limit: 10, windowSeconds: 60 * 60 };

export async function isRateLimited(key: string, rule: RateLimitRule) {
  const db = getDb();
  const [row] = await db
    .select({ attempts: authRateLimits.attempts })
    .from(authRateLimits)
    .where(
      and(
        eq(authRateLimits.key, key),
        gte(authRateLimits.windowStartedAt, sql`now() - make_interval(secs => ${rule.windowSeconds})`),
      ),
    );
  return (row?.attempts ?? 0) >= rule.limit;
}

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
