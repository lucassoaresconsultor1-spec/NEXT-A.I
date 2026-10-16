import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { membershipRegions, membershipStores, organizationMemberships, regions, roles, stores, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { hashPassword } from "@/server/auth/password";
import { loadTenantContext, type TenantContext } from "@/server/authz/context";
import type { StoreAccess } from "@/server/authz/system-roles";
import { provisionOrganization } from "@/server/organizations/provisioning";

// Direct-insert fixtures for integration tests. They bypass the services under
// test on purpose, so a bug in a service cannot hide behind its own setup.
// Every fixture uses unique names/e-mails: test files share one database.

export const TEST_PASSWORD = "senha-de-teste-123";
// Cheap scrypt parameters keep fixtures fast; production uses the defaults.
const FAST_HASH = { N: 2 ** 10, r: 8, p: 1 };

export const uniqueSuffix = () => randomUUID().slice(0, 8);
export const uniqueEmail = (label: string) => `${label}-${uniqueSuffix()}@example.test`;

async function insertUser(tx: Tx, userId: string, name: string, email: string, homeOrganizationId: string | null = null) {
  await tx
    .insert(users)
    .values({ id: userId, email, name, homeOrganizationId, passwordHash: await hashPassword(TEST_PASSWORD, FAST_HASH) });
}

export async function contextFor(userId: string, organizationId: string, activeStoreId: string | null = null): Promise<TenantContext> {
  const db = getDb();
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isPlatformAdmin: users.isPlatformAdmin,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error("fixture user not found");
  const session = { id: `test-${randomUUID()}`, activeOrganizationId: organizationId, activeStoreId, expiresAt: new Date(Date.now() + 3_600_000), user };
  const context = await loadTenantContext(session, organizationId);
  if (!context) throw new Error("fixture membership not active");
  return context;
}

export async function createOrganizationFixture(name = `Empresa ${uniqueSuffix()}`) {
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const ownerEmail = uniqueEmail("owner");
  await withScope({ organizationId, userId: ownerId }, async (tx) => {
    await insertUser(tx, ownerId, "Proprietária Teste", ownerEmail);
    await provisionOrganization(tx, { organizationId, ownerUserId: ownerId, name });
    await tx.update(users).set({ homeOrganizationId: organizationId }).where(eq(users.id, ownerId));
  });
  return { organizationId, ownerId, ownerEmail, owner: await contextFor(ownerId, organizationId) };
}

export async function createRegionFixture(organizationId: string, name = `Região ${uniqueSuffix()}`) {
  return withScope({ organizationId }, async (tx) => {
    const [region] = await tx.insert(regions).values({ organizationId, name }).returning({ id: regions.id });
    return region.id;
  });
}

export async function createStoreFixture(
  organizationId: string,
  values: { name?: string; code?: string; regionId?: string | null; status?: "active" | "inactive" } = {},
) {
  const suffix = uniqueSuffix().toUpperCase();
  return withScope({ organizationId }, async (tx) => {
    const [store] = await tx
      .insert(stores)
      .values({
        organizationId,
        code: values.code ?? `L${suffix.slice(0, 6)}`,
        name: values.name ?? `Loja ${suffix}`,
        regionId: values.regionId ?? null,
        status: values.status ?? "active",
      })
      .returning({ id: stores.id });
    return store.id;
  });
}

export async function addMemberFixture(
  organizationId: string,
  options: { roleKey: string; storeAccess?: StoreAccess; storeIds?: string[]; regionIds?: string[]; name?: string },
) {
  const userId = randomUUID();
  const email = uniqueEmail(options.roleKey);
  const membershipId = await withScope({ organizationId, userId }, async (tx) => {
    await insertUser(tx, userId, options.name ?? `Membro ${options.roleKey}`, email, organizationId);
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, options.roleKey)));
    if (!role) throw new Error(`role ${options.roleKey} not found`);
    const storeAccess = options.storeAccess ?? (options.regionIds?.length ? "regions" : options.storeIds?.length ? "stores" : "all");
    const [membership] = await tx
      .insert(organizationMemberships)
      .values({ organizationId, userId, roleId: role.id, storeAccess })
      .returning({ id: organizationMemberships.id });
    for (const storeId of options.storeIds ?? []) {
      await tx.insert(membershipStores).values({ organizationId, membershipId: membership.id, storeId });
    }
    for (const regionId of options.regionIds ?? []) {
      await tx.insert(membershipRegions).values({ organizationId, membershipId: membership.id, regionId });
    }
    return membership.id;
  });
  return { userId, email, membershipId, context: await contextFor(userId, organizationId) };
}
