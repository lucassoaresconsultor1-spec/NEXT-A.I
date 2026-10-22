import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLogs, membershipStores, organizationMemberships, roles, sessions, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { verifyPassword } from "@/server/auth/password";
import { loadTenantContext } from "@/server/authz/context";
import type { StoreAccess } from "@/server/authz/system-roles";
import { SELF_CHANGE_MESSAGE } from "@/server/members/rules";
import { memberFiltersSchema } from "@/server/members/schemas";
import {
  addMember,
  getMember,
  getMemberFormOptions,
  listMembers,
  removeMember,
  resetMemberPassword,
  setMemberStatus,
  updateMemberAccess,
} from "@/server/members/service";
import {
  addMemberFixture,
  contextFor,
  createOrganizationFixture,
  createRegionFixture,
  createStoreFixture,
  uniqueEmail,
} from "./fixtures";

const TEMP_PASSWORD = "provisoria-segura-42";

async function roleIdOf(organizationId: string, key: string) {
  const [role] = await withScope({ organizationId }, (tx) =>
    tx.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, organizationId), eq(roles.key, key))),
  );
  return role.id;
}

const access = (roleId: string, storeAccess: StoreAccess, ids: { regionIds?: string[]; storeIds?: string[] } = {}) => ({
  roleId,
  storeAccess,
  regionIds: ids.regionIds ?? [],
  storeIds: ids.storeIds ?? [],
});

const newPerson = (roleId: string, storeAccess: StoreAccess, ids: { regionIds?: string[]; storeIds?: string[] } = {}) => ({
  name: "Pessoa Nova",
  email: uniqueEmail("novo"),
  initialPassword: TEMP_PASSWORD,
  ...access(roleId, storeAccess, ids),
});

const filters = (values: Record<string, string> = {}) => memberFiltersSchema.parse(values);

async function visibleIds(context: Awaited<ReturnType<typeof contextFor>>, values: Record<string, string> = {}) {
  return (await listMembers(context, filters(values))).rows.map((row) => row.membershipId);
}

async function auditTrail(organizationId: string, entityId: string) {
  return withScope({ organizationId }, (tx) =>
    tx
      .select({ action: auditLogs.action, changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, entityId)))
      .orderBy(asc(auditLogs.createdAt)),
  );
}

async function readUser(userId: string) {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  return user;
}

describe("members visibility", () => {
  it("shows a store manager their own store's staff and themself only", async () => {
    const org = await createOrganizationFixture();
    const north = await createRegionFixture(org.organizationId);
    const storeA = await createStoreFixture(org.organizationId, { regionId: north });
    const storeB = await createStoreFixture(org.organizationId);
    const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeA] });
    const staffA = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeA], name: "Ana Loja A" });
    const staffB = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeB] });
    const regional = await addMemberFixture(org.organizationId, { roleKey: "regional_manager", regionIds: [north] });
    const admin = await addMemberFixture(org.organizationId, { roleKey: "admin", storeAccess: "all" });
    const ownerMembership = org.owner.membershipId;

    const seen = await visibleIds(manager.context);
    expect(seen.sort()).toEqual([manager.membershipId, staffA.membershipId, regional.membershipId].sort());
    expect(await getMember(manager.context, staffB.membershipId)).toBeNull();
    expect(await getMember(manager.context, admin.membershipId)).toBeNull();
    expect(await getMember(manager.context, ownerMembership)).toBeNull();
    expect(await getMember(manager.context, staffA.membershipId)).toMatchObject({ name: "Ana Loja A", manageBlock: null });
    expect(await getMember(manager.context, manager.membershipId)).toMatchObject({ isSelf: true, manageBlock: "self" });

    expect((await visibleIds(org.owner)).length).toBe(6);
    expect((await visibleIds(manager.context, { storeId: storeB })).length).toBe(0);
    expect((await visibleIds(org.owner, { storeId: storeB })).sort()).toEqual(
      [staffB.membershipId, admin.membershipId, ownerMembership].sort(),
    );
    expect(await visibleIds(org.owner, { q: "ana loja" })).toEqual([staffA.membershipId]);

    const lonely = await addMemberFixture(org.organizationId, { roleKey: "supervisor", storeAccess: "stores" });
    expect(await visibleIds(lonely.context)).toEqual([lonely.membershipId]);
  });

  it("requires members.read in the service", async () => {
    const { organizationId } = await createOrganizationFixture();
    const store = await createStoreFixture(organizationId);
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [store] });
    await expect(listMembers(seller.context, filters())).rejects.toMatchObject({ code: "forbidden" });
    await expect(getMember(seller.context, seller.membershipId)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("members cross-organization isolation", () => {
  it("treats memberships and ids of another organization as unknown", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const storeOfA = await createStoreFixture(a.organizationId);
    const storeOfB = await createStoreFixture(b.organizationId);
    const regionOfB = await createRegionFixture(b.organizationId);
    const memberOfB = await addMemberFixture(b.organizationId, { roleKey: "salesperson", storeIds: [storeOfB] });
    const sellerA = await roleIdOf(a.organizationId, "salesperson");

    expect(await getMember(a.owner, memberOfB.membershipId)).toBeNull();
    expect(await visibleIds(a.owner)).not.toContain(memberOfB.membershipId);
    const sellerRoleA = access(sellerA, "stores", { storeIds: [storeOfA] });
    await expect(updateMemberAccess(a.owner, memberOfB.membershipId, sellerRoleA)).rejects.toMatchObject({ code: "not_found" });
    await expect(setMemberStatus(a.owner, memberOfB.membershipId, "suspended")).rejects.toMatchObject({ code: "not_found" });
    await expect(removeMember(a.owner, memberOfB.membershipId)).rejects.toMatchObject({ code: "not_found" });
    await expect(resetMemberPassword(a.owner, memberOfB.membershipId, TEMP_PASSWORD)).rejects.toMatchObject({ code: "not_found" });

    const roleOfB = await roleIdOf(b.organizationId, "salesperson");
    await expect(addMember(a.owner, newPerson(roleOfB, "stores", { storeIds: [storeOfA] }))).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { roleId: expect.any(Array) },
    });
    await expect(addMember(a.owner, newPerson(sellerA, "stores", { storeIds: [storeOfB] }))).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { storeIds: expect.any(Array) },
    });
    await expect(addMember(a.owner, newPerson(sellerA, "regions", { regionIds: [regionOfB] }))).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { regionIds: expect.any(Array) },
    });
    expect(await contextFor(memberOfB.userId, b.organizationId)).toMatchObject({ membershipId: memberOfB.membershipId });
  });
});

describe("members privilege escalation", () => {
  it("keeps a store manager to lower roles, their own stores and other people", async () => {
    const org = await createOrganizationFixture();
    const storeA = await createStoreFixture(org.organizationId);
    const storeB = await createStoreFixture(org.organizationId);
    const region = await createRegionFixture(org.organizationId);
    const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeA] });
    const shared = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeA, storeB] });
    const roleId = (key: string) => roleIdOf(org.organizationId, key);

    for (const key of ["owner", "admin", "regional_manager", "store_manager"]) {
      await expect(addMember(manager.context, newPerson(await roleId(key), "stores", { storeIds: [storeA] }))).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    const seller = await roleId("salesperson");
    await expect(addMember(manager.context, newPerson(seller, "stores", { storeIds: [storeA, storeB] }))).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(addMember(manager.context, newPerson(seller, "regions", { regionIds: [region] }))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(addMember(manager.context, newPerson(seller, "all"))).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateMemberAccess(manager.context, manager.membershipId, access(await roleId("store_manager"), "stores", { storeIds: [storeA, storeB] })),
    ).rejects.toThrow(SELF_CHANGE_MESSAGE);
    await expect(setMemberStatus(manager.context, manager.membershipId, "suspended")).rejects.toThrow(SELF_CHANGE_MESSAGE);
    await expect(removeMember(manager.context, manager.membershipId)).rejects.toThrow(SELF_CHANGE_MESSAGE);
    // Visible through store A, but also works at store B: outside the manager's control.
    await expect(setMemberStatus(manager.context, shared.membershipId, "suspended")).rejects.toMatchObject({ code: "forbidden" });
    // Store B is never named to the manager, only flagged as "outside your scope".
    expect(await getMember(manager.context, shared.membershipId)).toMatchObject({
      manageBlock: "scope",
      hasAccessOutsideViewerScope: true,
      stores: [{ id: storeA }],
    });
    const sharedRow = (await listMembers(manager.context, filters())).rows.find((row) => row.membershipId === shared.membershipId);
    expect(sharedRow).toMatchObject({ scopeCount: 1 });

    const options = await getMemberFormOptions(manager.context);
    expect(options.roles.map((role) => role.key).sort()).toEqual(["cashier", "reception", "salesperson", "supervisor"]);
    expect(options.stores.map((store) => store.id)).toEqual([storeA]);
    expect(options.regions).toEqual([]);

    const added = await addMember(manager.context, newPerson(seller, "stores", { storeIds: [storeA] }));
    await updateMemberAccess(manager.context, added.membershipId, access(await roleId("supervisor"), "stores", { storeIds: [storeA] }));
    expect(await getMember(manager.context, added.membershipId)).toMatchObject({ role: { key: "supervisor" } });
    expect((await auditTrail(org.organizationId, added.membershipId)).map((entry) => entry.action)).toEqual(["member.added", "member.updated"]);
  });

  it("does not let an admin assign or manage owners, nor supervisors manage anyone", async () => {
    const org = await createOrganizationFixture();
    const store = await createStoreFixture(org.organizationId);
    const admin = await addMemberFixture(org.organizationId, { roleKey: "admin", storeAccess: "all" });
    const supervisor = await addMemberFixture(org.organizationId, { roleKey: "supervisor", storeIds: [store] });
    const seller = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [store] });
    const ownerRole = await roleIdOf(org.organizationId, "owner");
    await expect(addMember(admin.context, newPerson(ownerRole, "all"))).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateMemberAccess(admin.context, seller.membershipId, access(ownerRole, "all"))).rejects.toMatchObject({ code: "forbidden" });
    const ownerMembership = org.owner.membershipId;
    await expect(setMemberStatus(admin.context, ownerMembership, "suspended")).rejects.toMatchObject({ code: "forbidden" });
    const sellerRole = await roleIdOf(org.organizationId, "salesperson");
    await expect(addMember(supervisor.context, newPerson(sellerRole, "stores", { storeIds: [store] }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(removeMember(supervisor.context, seller.membershipId)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("owner invariant", () => {
  it("demotes one of two owners but never the last active one", async () => {
    const org = await createOrganizationFixture();
    const second = await addMemberFixture(org.organizationId, { roleKey: "owner", storeAccess: "all" });
    const firstMembership = org.owner.membershipId;
    const adminRole = await roleIdOf(org.organizationId, "admin");
    await expect(updateMemberAccess(org.owner, firstMembership, access(adminRole, "all"))).rejects.toThrow(SELF_CHANGE_MESSAGE);

    await updateMemberAccess(org.owner, second.membershipId, access(adminRole, "all"));
    // A context loaded before the demotion still claims "owner": the invariant holds anyway.
    const stale = second.context;
    await expect(updateMemberAccess(stale, firstMembership, access(adminRole, "all"))).rejects.toMatchObject({ code: "conflict" });
    await expect(setMemberStatus(stale, firstMembership, "suspended")).rejects.toMatchObject({ code: "conflict" });
    await expect(removeMember(stale, firstMembership)).rejects.toMatchObject({ code: "conflict" });
    expect(await contextFor(org.ownerId, org.organizationId)).toMatchObject({ role: { key: "owner" } });
  });
});

describe("members lifecycle", () => {
  it("enforces the Essencial plan limit of 10 active members, also on reactivation", async () => {
    const org = await createOrganizationFixture();
    const store = await createStoreFixture(org.organizationId);
    const team = [];
    for (let index = 0; index < 9; index += 1) {
      team.push(await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [store] }));
    }
    const cashier = await roleIdOf(org.organizationId, "cashier");
    await expect(addMember(org.owner, newPerson(cashier, "stores", { storeIds: [store] }))).rejects.toMatchObject({ code: "limit" });
    await setMemberStatus(org.owner, team[0].membershipId, "suspended");
    await addMember(org.owner, newPerson(cashier, "stores", { storeIds: [store] }));
    await expect(setMemberStatus(org.owner, team[0].membershipId, "active")).rejects.toMatchObject({ code: "limit" });
  });

  it("creates new accounts with a temporary password owned by the organization", async () => {
    const a = await createOrganizationFixture();
    const store = await createStoreFixture(a.organizationId);
    const seller = await roleIdOf(a.organizationId, "salesperson");
    const fresh = { ...newPerson(seller, "stores", { storeIds: [store] }), initialPassword: undefined };
    await expect(addMember(a.owner, fresh)).rejects.toMatchObject({ code: "invalid", fieldErrors: { initialPassword: expect.any(Array) } });

    const created = await addMember(a.owner, { ...fresh, initialPassword: TEMP_PASSWORD });
    expect(created.linkedExistingUser).toBe(false);
    const [createdUser] = await getDb().select().from(users).where(eq(users.email, fresh.email));
    expect(createdUser.mustChangePassword).toBe(true);
    expect(createdUser.homeOrganizationId).toBe(a.organizationId);
    expect(await verifyPassword(TEMP_PASSWORD, createdUser.passwordHash)).toBe(true);
    const [entry] = await auditTrail(a.organizationId, created.membershipId);
    expect(entry).toEqual({ action: "member.added", changes: { name: "Pessoa Nova", role: "Vendedor", storeAccess: "stores", regions: 0, stores: 1 } });
    expect(await getMember(a.owner, created.membershipId)).toMatchObject({ passwordResetBlock: null });
  });

  it("refuses accounts created by another organization (account pre-hijacking)", async () => {
    const attacker = await createOrganizationFixture();
    const victimCompany = await createOrganizationFixture();
    const attackerStore = await createStoreFixture(attacker.organizationId);
    const victimStore = await createStoreFixture(victimCompany.organizationId);
    // The attacker creates an account for the victim's e-mail with a password it knows.
    const victimEmail = `vitima-${randomBytes(4).toString("hex")}@example.test`;
    await addMember(attacker.owner, {
      ...newPerson(await roleIdOf(attacker.organizationId, "salesperson"), "stores", { storeIds: [attackerStore] }),
      email: victimEmail,
      initialPassword: TEMP_PASSWORD,
    });
    // The victim's real employer adds the same e-mail: it must not be linked.
    await expect(
      addMember(victimCompany.owner, {
        ...newPerson(await roleIdOf(victimCompany.organizationId, "admin"), "all"),
        email: victimEmail.toUpperCase(),
        initialPassword: "outra-senha-forte-1",
      }),
    ).rejects.toMatchObject({ code: "conflict", fieldErrors: { email: expect.any(Array) } });
    // Owners of other organizations (self sign-up accounts) cannot be linked either.
    const before = await readUser(victimCompany.ownerId);
    await expect(
      addMember(attacker.owner, {
        ...newPerson(await roleIdOf(attacker.organizationId, "salesperson"), "stores", { storeIds: [attackerStore] }),
        email: victimCompany.ownerEmail,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await readUser(victimCompany.ownerId)).passwordHash).toBe(before.passwordHash);
    expect(victimStore).toBeTruthy();
  });

  it("adds back a former member of the same organization without touching the account", async () => {
    const org = await createOrganizationFixture();
    const store = await createStoreFixture(org.organizationId);
    const seller = await roleIdOf(org.organizationId, "salesperson");
    const person = { ...newPerson(seller, "stores", { storeIds: [store] }), initialPassword: TEMP_PASSWORD };
    const first = await addMember(org.owner, person);
    await removeMember(org.owner, first.membershipId);
    const [account] = await getDb().select().from(users).where(eq(users.email, person.email));
    const again = await addMember(org.owner, { ...person, name: "Outro Nome", initialPassword: undefined });
    expect(again.linkedExistingUser).toBe(true);
    const after = await readUser(account.id);
    expect({ name: after.name, hash: after.passwordHash }).toEqual({ name: account.name, hash: account.passwordHash });
    await expect(addMember(org.owner, person)).rejects.toMatchObject({ code: "conflict", fieldErrors: { email: expect.any(Array) } });
  });

  it("refuses resetting the password of an account owned by another organization", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const storeOfA = await createStoreFixture(a.organizationId);
    // Legacy/manual link: B's owner account also holds a membership in A.
    const [sellerRole] = await withScope({ organizationId: a.organizationId }, (tx) =>
      tx.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, a.organizationId), eq(roles.key, "salesperson"))),
    );
    const [membership] = await withScope({ organizationId: a.organizationId }, (tx) =>
      tx
        .insert(organizationMemberships)
        .values({ organizationId: a.organizationId, userId: b.ownerId, roleId: sellerRole.id, storeAccess: "stores" })
        .returning({ id: organizationMemberships.id }),
    );
    await withScope({ organizationId: a.organizationId }, (tx) =>
      tx.insert(membershipStores).values({ organizationId: a.organizationId, membershipId: membership.id, storeId: storeOfA }),
    );
    const before = await readUser(b.ownerId);
    expect(await getMember(a.owner, membership.id)).toMatchObject({ passwordResetBlock: expect.any(String) });
    await expect(resetMemberPassword(a.owner, membership.id, TEMP_PASSWORD)).rejects.toMatchObject({ code: "forbidden" });
    expect((await readUser(b.ownerId)).passwordHash).toBe(before.passwordHash);
  });

  it("resets the password of a single-organization member and ends their sessions", async () => {
    const org = await createOrganizationFixture();
    const store = await createStoreFixture(org.organizationId);
    const seller = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [store] });
    await getDb().insert(sessions).values({
      id: randomBytes(32).toString("hex"),
      userId: seller.userId,
      activeOrganizationId: org.organizationId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await expect(resetMemberPassword(org.owner, seller.membershipId, "curta")).rejects.toMatchObject({ code: "invalid" });
    await resetMemberPassword(org.owner, seller.membershipId, TEMP_PASSWORD);
    const user = await readUser(seller.userId);
    expect(user.mustChangePassword).toBe(true);
    expect(await verifyPassword(TEMP_PASSWORD, user.passwordHash)).toBe(true);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, seller.userId))).toHaveLength(0);
    const trail = await auditTrail(org.organizationId, seller.membershipId);
    expect(trail.map((entry) => entry.action)).toEqual(["member.password_reset"]);
    expect(JSON.stringify(trail)).not.toContain(TEMP_PASSWORD);

    await getDb().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, seller.userId));
    await expect(resetMemberPassword(org.owner, seller.membershipId, TEMP_PASSWORD)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("suspends with immediate effect, reactivates, replaces scope and removes", async () => {
    const org = await createOrganizationFixture();
    const region = await createRegionFixture(org.organizationId, `Região ${randomUUID().slice(0, 6)}`);
    const store = await createStoreFixture(org.organizationId, { regionId: region });
    const other = await createStoreFixture(org.organizationId);
    const seller = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [store] });
    const session = { id: "s", activeOrganizationId: org.organizationId, activeStoreId: null, expiresAt: new Date(Date.now() + 60_000), user: seller.context.user };

    await setMemberStatus(org.owner, seller.membershipId, "suspended");
    expect(await loadTenantContext(session, org.organizationId)).toBeNull();
    await setMemberStatus(org.owner, seller.membershipId, "active");
    expect(await loadTenantContext(session, org.organizationId)).not.toBeNull();

    const supervisor = await roleIdOf(org.organizationId, "supervisor");
    await updateMemberAccess(org.owner, seller.membershipId, access(supervisor, "regions", { regionIds: [region], storeIds: [other] }));
    const context = await contextFor(seller.userId, org.organizationId);
    expect(context.storeScope).toEqual({ all: false, storeIds: [store] });
    const links = await withScope({ organizationId: org.organizationId }, (tx) =>
      tx.select().from(membershipStores).where(eq(membershipStores.membershipId, seller.membershipId)),
    );
    expect(links).toHaveLength(0);

    await removeMember(org.owner, seller.membershipId);
    expect(await getMember(org.owner, seller.membershipId)).toBeNull();
    expect(await readUser(seller.userId)).toBeDefined();
    const trail = await auditTrail(org.organizationId, seller.membershipId);
    expect(trail.map((entry) => entry.action)).toEqual([
      "member.status_changed",
      "member.status_changed",
      "member.updated",
      "member.removed",
    ]);
    expect(trail[2].changes).toMatchObject({ role: { from: "Vendedor", to: "Supervisor" }, storeAccess: { from: "stores", to: "regions" } });
  });
});
