import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { membershipRegions, regions, rolePermissions, roles } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { getOverview } from "@/server/dashboard/overview";
import { addMember } from "@/server/members/service";
import { addMemberFixture, createOrganizationFixture, createRegionFixture, createStoreFixture, uniqueEmail, uniqueSuffix } from "./fixtures";

async function customRole(organizationId: string, rank: number, permissions: string[]) {
  return withScope({ organizationId }, async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({ organizationId, key: `custom_${uniqueSuffix()}`, name: `Perfil ${uniqueSuffix()}`, rank })
      .returning({ id: roles.id, key: roles.key });
    for (const permission of permissions) await tx.insert(rolePermissions).values({ organizationId, roleId: role.id, permission });
    return role;
  });
}

describe("dashboard overview", () => {
  it("counts only regions in a scoped member's reach", async () => {
    const org = await createOrganizationFixture();
    const north = await createRegionFixture(org.organizationId, `Norte ${uniqueSuffix()}`);
    await createRegionFixture(org.organizationId, `Sul ${uniqueSuffix()}`);
    await createStoreFixture(org.organizationId, { regionId: north });
    const manager = await addMemberFixture(org.organizationId, { roleKey: "regional_manager", regionIds: [north] });
    expect((await getOverview(manager.context)).regions).toBe(1);
    expect((await getOverview(org.owner)).regions).toBe(2);
  });

  it("offers onboarding steps only for actions the member may perform", async () => {
    const org = await createOrganizationFixture();
    const role = await customRole(org.organizationId, 60, ["stores.read", "stores.manage"]);
    const member = await addMemberFixture(org.organizationId, { roleKey: role.key, storeAccess: "all" });
    const steps = (await getOverview(member.context)).onboarding?.map((step) => step.href);
    expect(steps).toEqual(["/lojas/nova"]);
  });

  it("hides store figures from members without stores.read", async () => {
    const org = await createOrganizationFixture();
    const role = await customRole(org.organizationId, 30, ["departments.read"]);
    const member = await addMemberFixture(org.organizationId, { roleKey: role.key, storeAccess: "all" });
    expect((await getOverview(member.context)).stores).toBeNull();
  });
});

describe("review regressions", () => {
  it("refuses assigning a lower role that carries permissions the manager lacks", async () => {
    const org = await createOrganizationFixture();
    const store = await createStoreFixture(org.organizationId);
    const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [store] });
    const auditor = await customRole(org.organizationId, 10, ["stores.read", "audit.read"]);
    const [auditorRole] = await withScope({ organizationId: org.organizationId }, (tx) =>
      tx.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, org.organizationId), eq(roles.key, auditor.key))),
    );
    await expect(
      addMember(manager.context, {
        name: "Auditor",
        email: uniqueEmail("auditor"),
        roleId: auditorRole.id,
        storeAccess: "stores",
        regionIds: [],
        storeIds: [store],
        initialPassword: "provisoria-segura-42",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps a region referenced by a member scope from being deleted, even without the service check", async () => {
    const org = await createOrganizationFixture();
    const region = await createRegionFixture(org.organizationId);
    const member = await addMemberFixture(org.organizationId, { roleKey: "regional_manager", regionIds: [region] });
    await expect(
      withScope({ organizationId: org.organizationId }, (tx) => tx.delete(regions).where(eq(regions.id, region))),
    ).rejects.toThrow();
    const links = await withScope({ organizationId: org.organizationId }, (tx) =>
      tx.select().from(membershipRegions).where(eq(membershipRegions.membershipId, member.membershipId)),
    );
    expect(links).toHaveLength(1);
  });
});
