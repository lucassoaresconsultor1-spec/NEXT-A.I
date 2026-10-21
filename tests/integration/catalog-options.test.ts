import { describe, expect, it } from "vitest";
import { brands, categories, rolePermissions, roles, suppliers } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { listCatalogOptions } from "@/server/catalog/options";
import { addMemberFixture, createOrganizationFixture, uniqueSuffix } from "./fixtures";

// Direct inserts, bypassing the catalog services (same principle as fixtures.ts).
async function seed(organizationId: string, tag: string) {
  return withScope({ organizationId }, async (tx) => {
    const insertCategory = async (name: string, isActive = true) =>
      (await tx.insert(categories).values({ organizationId, name, isActive }).returning({ id: categories.id }))[0].id;
    const zebra = await insertCategory(`zebra ${tag}`);
    const alfa = await insertCategory(`Alfa ${tag}`);
    const retired = await insertCategory(`Antiga ${tag}`, false);
    const [brand] = await tx.insert(brands).values({ organizationId, name: `Marca ${tag}` }).returning({ id: brands.id });
    const [oldBrand] = await tx.insert(brands).values({ organizationId, name: `Marca velha ${tag}`, isActive: false }).returning({ id: brands.id });
    const [supplier] = await tx.insert(suppliers).values({ organizationId, name: `Fornecedor ${tag}` }).returning({ id: suppliers.id });
    return { zebra, alfa, retired, brand: brand.id, oldBrand: oldBrand.id, supplier: supplier.id };
  });
}

describe("catalog options for product forms", () => {
  it("lists only active entries of the organization, ordered by name", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const tag = uniqueSuffix();
    const ids = await seed(organizationId, tag);
    const options = await listCatalogOptions(owner);
    expect(options.categories.map((option) => option.id)).toEqual([ids.alfa, ids.zebra]);
    expect(options.brands).toEqual([{ id: ids.brand, name: `Marca ${tag}`, isActive: true }]);
    expect(options.suppliers).toEqual([{ id: ids.supplier, name: `Fornecedor ${tag}`, isActive: true }]);
  });

  it("keeps the product's current inactive values when asked", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const ids = await seed(organizationId, uniqueSuffix());
    const options = await listCatalogOptions(owner, { categoryId: ids.retired, brandId: ids.oldBrand });
    expect(options.categories.find((option) => option.id === ids.retired)).toMatchObject({ isActive: false });
    expect(options.brands.find((option) => option.id === ids.oldBrand)).toMatchObject({ isActive: false });
    expect(options.categories).toHaveLength(3);
  });

  it("ignores kept ids from another organization and malformed ids", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const idsA = await seed(a.organizationId, uniqueSuffix());
    await seed(b.organizationId, uniqueSuffix());
    const options = await listCatalogOptions(b.owner, { categoryId: idsA.retired, brandId: "nao-e-uuid", supplierId: idsA.supplier });
    const all = [...options.categories, ...options.brands, ...options.suppliers].map((option) => option.id);
    expect(all).not.toContain(idsA.retired);
    expect(all).not.toContain(idsA.supplier);
    expect(all).not.toContain(idsA.alfa);
    expect(options.categories).toHaveLength(2);
  });

  it("requires catalog.read", async () => {
    const { organizationId } = await createOrganizationFixture();
    const key = `sem_catalogo_${uniqueSuffix()}`;
    await withScope({ organizationId }, async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ organizationId, key, name: `Sem catálogo ${key}`, isSystem: false, rank: 10 })
        .returning({ id: roles.id });
      await tx.insert(rolePermissions).values({ organizationId, roleId: role.id, permission: "stores.read" });
    });
    const member = await addMemberFixture(organizationId, { roleKey: key });
    await expect(listCatalogOptions(member.context)).rejects.toMatchObject({ code: "forbidden" });
  });
});
