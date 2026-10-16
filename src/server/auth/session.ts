import "server-only";
import { and, eq, gt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { SESSION_TTL_SECONDS, sessionCookieName, sessionCookieOptions } from "./cookie";
import { generateSessionToken, hashSessionToken } from "./tokens";

const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
// Sliding expiry: a session used in its second half gets a fresh 30-day window.
const RENEW_BEFORE_MS = SESSION_TTL_MS / 2;

export interface CurrentSession {
  id: string;
  activeOrganizationId: string | null;
  activeStoreId: string | null;
  expiresAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    isPlatformAdmin: boolean;
    mustChangePassword: boolean;
  };
}

export async function createSession(userId: string, activeOrganizationId: string | null) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const db = getDb();
  await db.insert(sessions).values({ id: hashSessionToken(token), userId, activeOrganizationId, expiresAt });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string): Promise<CurrentSession | null> {
  const db = getDb();
  const id = hashSessionToken(token);
  const [row] = await db
    .select({
      id: sessions.id,
      activeOrganizationId: sessions.activeOrganizationId,
      activeStoreId: sessions.activeStoreId,
      expiresAt: sessions.expiresAt,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        isPlatformAdmin: users.isPlatformAdmin,
        mustChangePassword: users.mustChangePassword,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(users.status, "active")));
  if (!row) return null;

  if (row.expiresAt.getTime() - Date.now() < RENEW_BEFORE_MS) {
    row.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt: row.expiresAt }).where(eq(sessions.id, id));
  }
  return row;
}

/** Request-scoped: one lookup per render pass, shared by layouts, pages and actions. */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token || token.length > 100) return null;
  return validateSessionToken(token);
});

export async function setSessionCookie(token: string) {
  (await cookies()).set(sessionCookieName(), token, sessionCookieOptions());
}

export async function deleteSessionCookie() {
  (await cookies()).set(sessionCookieName(), "", sessionCookieOptions(0));
}

export async function invalidateSession(sessionId: string) {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Ends every other session of the user (after a password change, for example). */
export async function invalidateOtherSessions(userId: string, keepSessionId?: string) {
  const db = getDb();
  await db
    .delete(sessions)
    .where(keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, userId));
}

/** Callers must validate membership/scope before switching (see tenant context). */
export async function updateSessionContext(
  sessionId: string,
  values: { activeOrganizationId?: string | null; activeStoreId?: string | null },
) {
  const db = getDb();
  await db.update(sessions).set(values).where(eq(sessions.id, sessionId));
}
