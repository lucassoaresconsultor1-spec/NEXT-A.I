import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { authEvents, organizationMemberships, organizations, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { isSignupAllowed } from "@/lib/env";
import { conflict, DomainError, forbidden, invalid, isUniqueViolation } from "@/server/errors";
import { provisionOrganization } from "@/server/organizations/provisioning";
import type { RequestMeta } from "@/server/http";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import {
  clearRateLimit,
  hitRateLimit,
  LOGIN_PER_ACCOUNT,
  LOGIN_PER_ACCOUNT_AND_IP,
  LOGIN_PER_IP,
  PASSWORD_CHANGE_PER_USER,
  releaseRateLimit,
  SIGNUP_PER_IP,
} from "./rate-limit";
import type { SignUpInput } from "./schemas";
import { createSession, invalidateOtherSessions } from "./session";
import { keyedDigest } from "./tokens";

type AuthEventType = (typeof authEvents.$inferInsert)["type"];

async function recordAuthEvent(type: AuthEventType, data: { userId?: string; subject?: string; ip?: string }) {
  const db = getDb();
  await db.insert(authEvents).values({
    type,
    userId: data.userId ?? null,
    subjectDigest: data.subject ? keyedDigest(data.subject) : null,
    ipDigest: data.ip ? keyedDigest(data.ip) : null,
  });
}

const GENERIC_LOGIN_ERROR = "E-mail ou senha inválidos.";
const THROTTLED = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";

export async function signUp(input: SignUpInput, meta: RequestMeta) {
  if (!isSignupAllowed()) throw forbidden("O cadastro de novas empresas está desativado.");
  const ipKey = `signup:ip:${keyedDigest(meta.ip)}`;
  if (!(await hitRateLimit(ipKey, SIGNUP_PER_IP)).allowed) throw new DomainError(THROTTLED, "limit");

  const passwordHash = await hashPassword(input.password);
  const userId = randomUUID();
  const organizationId = randomUUID();
  try {
    await withScope({ organizationId, userId }, async (tx) => {
      await tx.insert(users).values({ id: userId, email: input.email, name: input.name, passwordHash });
      await provisionOrganization(tx, {
        organizationId,
        ownerUserId: userId,
        name: input.organizationName,
        document: input.organizationDocument,
      });
      // Set after the organization row exists (foreign key).
      await tx.update(users).set({ homeOrganizationId: organizationId }).where(eq(users.id, userId));
    });
  } catch (error) {
    if (isUniqueViolation(error, "users_email_unique")) {
      throw conflict("Este e-mail já possui cadastro. Entre com sua senha.", { email: ["E-mail já cadastrado."] });
    }
    if (isUniqueViolation(error, "organizations_document_unique")) {
      throw conflict("Já existe uma empresa com este CNPJ.", { organizationDocument: ["CNPJ já cadastrado."] });
    }
    throw error;
  }
  await recordAuthEvent("signup", { userId, ip: meta.ip });
  return createSession(userId, organizationId);
}

/** Active organizations the user belongs to (RLS allows reading one's own memberships). */
export async function listUserOrganizations(userId: string) {
  return withScope({ userId }, (tx) =>
    tx
      .select({ id: organizations.id, name: organizations.name, status: organizations.status })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")))
      .orderBy(organizations.name),
  );
}

export async function signIn(input: { email: string; password: string }, meta: RequestMeta) {
  const pairKey = `login:pair:${keyedDigest(`${input.email}|${meta.ip}`)}`;
  const accountKey = `login:account:${keyedDigest(input.email)}`;
  const ipKey = `login:ip:${keyedDigest(meta.ip)}`;
  // Count the attempt atomically BEFORE checking the password, so concurrent
  // requests cannot all pass a check made before any of them was counted.
  // Attempts already blocked for this account+address are not counted for the
  // account, so one address cannot lock the owner out everywhere.
  const pair = await hitRateLimit(pairKey, LOGIN_PER_ACCOUNT_AND_IP);
  const counted = pair.allowed
    ? await Promise.all([hitRateLimit(accountKey, LOGIN_PER_ACCOUNT), hitRateLimit(ipKey, LOGIN_PER_IP)])
    : [];
  if (!pair.allowed || counted.some((result) => !result.allowed)) {
    await recordAuthEvent("login_throttled", { subject: input.email, ip: meta.ip });
    throw new DomainError(THROTTLED, "limit");
  }

  const db = getDb();
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status, mustChangePassword: users.mustChangePassword, isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.email, input.email));
  const valid = user ? await verifyPassword(input.password, user.passwordHash) : await verifyAgainstDummy(input.password);

  if (!user || !valid || user.status !== "active") {
    await recordAuthEvent("login_failed", { userId: user?.id, subject: input.email, ip: meta.ip });
    throw new DomainError(GENERIC_LOGIN_ERROR, "unauthenticated");
  }

  // Success: the limits keep counting failures only.
  await Promise.all([clearRateLimit(pairKey), releaseRateLimit(accountKey), releaseRateLimit(ipKey)]);
  const memberships = await listUserOrganizations(user.id);
  const active = memberships.filter((membership) => membership.status === "active");
  const session = await createSession(user.id, active.length === 1 ? active[0].id : null);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAuthEvent("login_succeeded", { userId: user.id, ip: meta.ip });
  return {
    ...session,
    mustChangePassword: user.mustChangePassword,
    isPlatformAdmin: user.isPlatformAdmin,
    organizationCount: active.length,
  };
}

export async function recordLogout(userId: string, meta: RequestMeta) {
  await recordAuthEvent("logout", { userId, ip: meta.ip });
}

export async function changePassword(
  session: { id: string; userId: string },
  input: { currentPassword: string; newPassword: string },
  meta: RequestMeta,
) {
  // A stolen session must not allow unlimited guessing of the current password.
  const changeKey = `password-change:user:${session.userId}`;
  if (!(await hitRateLimit(changeKey, PASSWORD_CHANGE_PER_USER)).allowed) throw new DomainError(THROTTLED, "limit");
  const db = getDb();
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, session.userId));
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw invalid("Senha atual incorreta.", { currentPassword: ["Senha atual incorreta."] });
  }
  await clearRateLimit(changeKey);
  const passwordHash = await hashPassword(input.newPassword);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, session.userId));
  await invalidateOtherSessions(session.userId, session.id);
  await recordAuthEvent("password_changed", { userId: session.userId, ip: meta.ip });
}
