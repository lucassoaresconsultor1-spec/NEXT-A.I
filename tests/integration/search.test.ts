import { describe, expect, it } from "vitest";
import { departments, roles } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { searchEverything } from "@/server/search/service";
import { addMemberFixture, createOrganizationFixture, createRegionFixture, createStoreFixture, uniqueSuffix } from "./fixtures";

async function insertDepartment(organizationId: string, name: string) {
  await withScope({ organizationId }, (tx) => tx.insert(departments).values({ organizationId, name }));
}

async function seedOrganization(tag: string) {
  const org = await createOrganizationFixture();
  const center = await createRegionFixture(org.organizationId, `Centro ${tag} 50%`);
  const north = await createRegionFixture(org.organizationId, `Norte ${tag} 500`);
  const storeCenter = await createStoreFixture(org.organizationId, { name: `Loja ${tag} 50% Centro`, regionId: center });
  const storeNorth = await createStoreFixture(org.organizationId, { name: `Loja ${tag} 500 Norte`, regionId: north });
  await insertDepartment(org.organizationId, `Moda ${tag} 50%`);
  await insertDepartment(org.organizationId, `Casa ${tag} 500`);
  const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeCenter], name: `Gerente ${tag}` });
  const sellerCenter = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeCenter], name: `Vendedor ${tag} Centro` });
  const sellerNorth = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeNorth], name: `Vendedor ${tag} Norte` });
  return { ...org, center, north, storeCenter, storeNorth, manager, sellerCenter, sellerNorth };
}

async function okSearch(context: Parameters<typeof searchEverything>[0], query: string) {
  const result = await searchEverything(context, query);
  if (result.status !== "ok") throw new Error(`unexpected status ${result.status}`);
  return result;
}

const ids = (rows: { id: string }[] | null) => rows?.map((row) => row.id) ?? null;

describe("global search", () => {
  it("matches LIKE wildcards literally", async () => {
    const tag = uniqueSuffix();
    const org = await seedOrganization(tag);
    const percent = await okSearch(org.owner, `${tag} 50%`);
    expect(ids(percent.stores)).toEqual([org.storeCenter]);
    expect(ids(percent.regions)).toEqual([org.center]);
    expect(percent.departments?.map((row) => row.name)).toEqual([`Moda ${tag} 50%`]);
    const underscore = await okSearch(org.owner, `${tag} 5_0`);
    expect(underscore.stores).toEqual([]);
    expect(underscore.regions).toEqual([]);
    expect(underscore.departments).toEqual([]);
    expect((await okSearch(org.owner, `${tag} 50`)).stores).toHaveLength(2);
  });

  it("limits every group to the viewer's scope and permissions", async () => {
    const tag = uniqueSuffix();
    const org = await seedOrganization(tag);
    const asOwner = await okSearch(org.owner, tag);
    expect(asOwner.stores).toHaveLength(2);
    expect(asOwner.regions).toHaveLength(2);
    expect(asOwner.departments).toHaveLength(2);
    expect(asOwner.members?.map((row) => row.membershipId).sort()).toEqual(
      [org.manager.membershipId, org.sellerCenter.membershipId, org.sellerNorth.membershipId].sort(),
    );

    const asManager = await okSearch(org.manager.context, tag);
    expect(ids(asManager.stores)).toEqual([org.storeCenter]);
    // store_manager has no regions.read: the group is withheld, not empty.
    expect(asManager.regions).toBeNull();
    expect(asManager.departments).toHaveLength(2);
    expect(asManager.members?.map((row) => row.membershipId).sort()).toEqual(
      [org.manager.membershipId, org.sellerCenter.membershipId].sort(),
    );

    const regional = await addMemberFixture(org.organizationId, { roleKey: "regional_manager", regionIds: [org.north] });
    const asRegional = await okSearch(regional.context, tag);
    expect(ids(asRegional.regions)).toEqual([org.north]);
    expect(ids(asRegional.stores)).toEqual([org.storeNorth]);

    const asSeller = await okSearch(org.sellerNorth.context, tag);
    expect(ids(asSeller.stores)).toEqual([org.storeNorth]);
    expect([asSeller.regions, asSeller.departments, asSeller.members]).toEqual([null, null, null]);
  });

  it("never returns rows of another organization", async () => {
    const tag = uniqueSuffix();
    const a = await seedOrganization(tag);
    const b = await seedOrganization(tag);
    const result = await okSearch(a.owner, tag);
    const everyId = [
      ...(ids(result.stores) ?? []),
      ...(ids(result.regions) ?? []),
      ...(ids(result.departments) ?? []),
      ...(result.members?.map((row) => row.membershipId) ?? []),
    ];
    for (const foreign of [b.storeCenter, b.storeNorth, b.center, b.north, b.manager.membershipId, b.sellerCenter.membershipId]) {
      expect(everyId).not.toContain(foreign);
    }
    expect(result.stores).toHaveLength(2);
  });

  it("validates the query length and refuses viewers without searchable areas", async () => {
    const org = await createOrganizationFixture();
    expect(await searchEverything(org.owner, "  a  ")).toEqual({ status: "too_short", query: "a" });
    expect((await searchEverything(org.owner, "x".repeat(81))).status).toBe("too_long");
    expect((await searchEverything(org.owner, "x".repeat(80))).status).toBe("ok");

    const key = `custom_${uniqueSuffix()}`;
    await withScope({ organizationId: org.organizationId }, (tx) =>
      tx.insert(roles).values({ organizationId: org.organizationId, key, name: "Sem acesso", rank: 10, isSystem: false }),
    );
    const store = await createStoreFixture(org.organizationId);
    const nobody = await addMemberFixture(org.organizationId, { roleKey: key, storeIds: [store] });
    await expect(searchEverything(nobody.context, "loja")).rejects.toMatchObject({ code: "forbidden" });
  });
});
