import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { roles, sessions, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { changePassword, signIn, signUp } from "@/server/auth/service";
import { hashSessionToken } from "@/server/auth/tokens";
import { validateSessionToken } from "@/server/auth/session";
import { SYSTEM_ROLES } from "@/server/authz/system-roles";
import { contextFor, uniqueEmail, uniqueSuffix } from "./fixtures";

const meta = () => ({ ip: `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

async function signUpFixture() {
  const email = uniqueEmail("signup");
  const password = "senha-forte-do-teste";
  const session = await signUp(
    { name: "Pessoa Teste", email, password, organizationName: `Empresa ${uniqueSuffix()}` },
    meta(),
  );
  return { email, password, session };
}

describe("sign-up", () => {
  it("creates the organization, its system roles and an owner session", async () => {
    const { email, session } = await signUpFixture();
    const current = await validateSessionToken(session.token);
    expect(current?.user.email).toBe(email);
    const organizationId = current!.activeOrganizationId!;
    const created = await withScope({ organizationId }, (tx) => tx.select({ key: roles.key }).from(roles));
    expect(created.map((role) => role.key).sort()).toEqual(SYSTEM_ROLES.map((role) => role.key).sort());
    const context = await contextFor(current!.user.id, organizationId);
    expect(context.role.key).toBe("owner");
    expect(context.storeScope.all).toBe(true);
  });

  it("stores only a digest of the session token and a salted password hash", async () => {
    const { email, password, session } = await signUpFixture();
    const db = getDb();
    const [stored] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, hashSessionToken(session.token)));
    expect(stored).toBeDefined();
    expect(stored.id).not.toBe(session.token);
    const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.email, email));
    expect(user.hash.startsWith("scrypt$")).toBe(true);
    expect(user.hash).not.toContain(password);
  });

  it("refuses a second account with the same e-mail", async () => {
    const { email } = await signUpFixture();
    await expect(
      signUp({ name: "Outra", email, password: "outra-senha-forte", organizationName: "Outra" }, meta()),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("sign-in", () => {
  it("accepts valid credentials and auto-selects the only organization", async () => {
    const { email, password } = await signUpFixture();
    const result = await signIn({ email, password }, meta());
    expect(result.organizationCount).toBe(1);
    const current = await validateSessionToken(result.token);
    expect(current?.activeOrganizationId).toBeTruthy();
  });

  it("answers the same generic error for unknown e-mail and wrong password", async () => {
    const { email } = await signUpFixture();
    const wrong = await signIn({ email, password: "senha-errada-123" }, meta()).catch((error) => error);
    const unknown = await signIn({ email: uniqueEmail("ghost"), password: "qualquer-senha-1" }, meta()).catch((error) => error);
    expect(wrong.message).toBe(unknown.message);
    expect(wrong.code).toBe("unauthenticated");
  });

  it("throttles repeated failures for the same account from the same address", async () => {
    const { email, password } = await signUpFixture();
    const attacker = meta();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn({ email, password: `errada-${attempt}-xyz` }, attacker).catch(() => undefined);
    }
    // Even the right password is refused from that address while the window is closed…
    await expect(signIn({ email, password }, attacker)).rejects.toMatchObject({ code: "limit" });
    // …but the owner signing in from another network is not locked out by a stranger.
    await expect(signIn({ email, password }, meta())).resolves.toBeDefined();
  });

  it("does not let one address exhaust the account-wide limit", async () => {
    const { email, password } = await signUpFixture();
    const attacker = meta();
    // More than the account-wide limit, all from one address: blocked attempts must not count for the account.
    for (let attempt = 0; attempt < 35; attempt += 1) {
      await signIn({ email, password: `errada-${attempt}-xyz` }, attacker).catch(() => undefined);
    }
    await expect(signIn({ email, password }, meta())).resolves.toBeDefined();
  });

  it("caps attempts against one account across many addresses", async () => {
    const { email, password } = await signUpFixture();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await signIn({ email, password: `errada-${attempt}-xyz` }, meta()).catch(() => undefined);
    }
    await expect(signIn({ email, password }, meta())).rejects.toMatchObject({ code: "limit" });
  });

  it("counts concurrent attempts atomically", async () => {
    const { email } = await signUpFixture();
    const attacker = meta();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, attempt) => signIn({ email, password: `errada-${attempt}-xyz` }, attacker)),
    );
    const throttled = results.filter((result) => result.status === "rejected" && (result.reason as { code?: string }).code === "limit");
    expect(throttled.length).toBeGreaterThanOrEqual(7);
  });

  it("rejects expired sessions and disabled users", async () => {
    const { email, session } = await signUpFixture();
    const db = getDb();
    await db.update(users).set({ status: "disabled" }).where(eq(users.email, email));
    expect(await validateSessionToken(session.token)).toBeNull();
    await db.update(users).set({ status: "active" }).where(eq(users.email, email));
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, hashSessionToken(session.token)));
    expect(await validateSessionToken(session.token)).toBeNull();
  });
});

describe("password change", () => {
  it("requires the current password and ends the other sessions", async () => {
    const { email, password, session } = await signUpFixture();
    const other = await signIn({ email, password }, meta());
    const current = (await validateSessionToken(session.token))!;
    await expect(
      changePassword({ id: current.id, userId: current.user.id }, { currentPassword: "errada-123456", newPassword: "nova-senha-forte-1" }, meta()),
    ).rejects.toMatchObject({ code: "invalid" });
    await changePassword({ id: current.id, userId: current.user.id }, { currentPassword: password, newPassword: "nova-senha-forte-1" }, meta());
    expect(await validateSessionToken(session.token)).not.toBeNull();
    expect(await validateSessionToken(other.token)).toBeNull();
    await expect(signIn({ email, password: "nova-senha-forte-1" }, meta())).resolves.toBeDefined();
  });
});
