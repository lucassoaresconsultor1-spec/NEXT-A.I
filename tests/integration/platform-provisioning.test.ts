import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLogs, organizationMemberships, organizations, roles, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { verifyPassword } from "@/server/auth/password";
import { OWNER_ROLE_KEY, SYSTEM_ROLES } from "@/server/authz/system-roles";
import { createOrganization, type NewOrganizationInput } from "@/server/platform/service";
import { contextFor, createOrganizationFixture, randomCnpj, uniqueEmail, uniqueSuffix } from "./fixtures";

async function createPlatformAdmin() {
  const id = randomUUID();
  await getDb()
    .insert(users)
    .values({ id, email: uniqueEmail("platform"), name: "Admin da Plataforma", passwordHash: "unused", isPlatformAdmin: true });
  return id;
}

const input = (values: Partial<NewOrganizationInput> = {}): NewOrganizationInput => ({
  organizationName: `Cliente ${uniqueSuffix()}`,
  planKey: "profissional",
  ownerName: "Dona Cliente",
  ownerEmail: uniqueEmail("dono"),
  ownerPassword: "senha-provisoria-1",
  ...values,
});

async function userByEmail(email: string) {
  const [row] = await getDb()
    .select({ id: users.id, passwordHash: users.passwordHash, mustChangePassword: users.mustChangePassword, homeOrganizationId: users.homeOrganizationId })
    .from(users)
    .where(eq(users.email, email));
  return row;
}

describe("platform company registration", () => {
  it("creates the company, its system roles and the owner with a temporary password", async () => {
    const adminId = await createPlatformAdmin();
    const values = input({ organizationDocument: randomCnpj() });
    const { organizationId } = await createOrganization(adminId, values);

    const owner = await userByEmail(values.ownerEmail);
    expect(owner).toMatchObject({ mustChangePassword: true, homeOrganizationId: organizationId });
    expect(await verifyPassword(values.ownerPassword, owner.passwordHash ?? "")).toBe(true);

    const { organization, membership, tenantRoles, trail } = await withScope({ organizationId }, async (tx) => ({
      organization: (await tx.select().from(organizations).where(eq(organizations.id, organizationId)))[0],
      membership: (
        await tx
          .select({ roleKey: roles.key, storeAccess: organizationMemberships.storeAccess, createdBy: organizationMemberships.createdBy })
          .from(organizationMemberships)
          .innerJoin(roles, eq(roles.id, organizationMemberships.roleId))
          .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, owner.id)))
      )[0],
      tenantRoles: await tx.select({ key: roles.key }).from(roles).where(eq(roles.organizationId, organizationId)).orderBy(asc(roles.key)),
      trail: await tx
        .select({ actorUserId: auditLogs.actorUserId, changes: auditLogs.changes })
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.action, "organization.created"))),
    }));
    expect(organization).toMatchObject({ name: values.organizationName, document: values.organizationDocument, planKey: "profissional", status: "active" });
    expect(membership).toEqual({ roleKey: OWNER_ROLE_KEY, storeAccess: "all", createdBy: adminId });
    expect(tenantRoles.map((role) => role.key)).toEqual(SYSTEM_ROLES.map((role) => role.key).sort());
    expect(trail).toEqual([{ actorUserId: adminId, changes: { name: values.organizationName, plan: "profissional" } }]);
    await expect(contextFor(owner.id, organizationId)).resolves.toMatchObject({ organization: { id: organizationId } });
  });

  it("is refused to anyone but an active platform administrator, creating nothing", async () => {
    const { ownerId } = await createOrganizationFixture();
    for (const actorId of [ownerId, randomUUID(), "not-a-uuid"]) {
      const values = input();
      await expect(createOrganization(actorId, values)).rejects.toMatchObject({ code: "forbidden" });
      // Invalid input does not reveal anything before the actor is checked.
      await expect(createOrganization(actorId, input({ ownerEmail: "x" }))).rejects.toMatchObject({ code: "forbidden" });
      expect(await userByEmail(values.ownerEmail)).toBeUndefined();
    }
  });

  it("rejects an existing e-mail, a repeated CNPJ, an unknown plan and invalid fields without partial rows", async () => {
    const adminId = await createPlatformAdmin();
    const { ownerEmail } = await createOrganizationFixture();
    await expect(createOrganization(adminId, input({ ownerEmail }))).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { ownerEmail: expect.any(Array) },
    });

    const cnpj = randomCnpj();
    await createOrganization(adminId, input({ organizationDocument: cnpj }));
    const repeated = input({ organizationDocument: cnpj });
    await expect(createOrganization(adminId, repeated)).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { organizationDocument: expect.any(Array) },
    });
    // The owner insert ran before the CNPJ conflict and was rolled back with it.
    expect(await userByEmail(repeated.ownerEmail)).toBeUndefined();

    await expect(createOrganization(adminId, input({ planKey: "inexistente" }))).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { planKey: expect.any(Array) },
    });
    await expect(createOrganization(adminId, input({ ownerPassword: "curta", organizationName: "" }))).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { ownerPassword: expect.any(Array), organizationName: expect.any(Array) },
    });
  });
});
