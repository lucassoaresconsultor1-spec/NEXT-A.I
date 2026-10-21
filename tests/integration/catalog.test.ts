import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, productCosts, productPrices, products, rolePermissions, roles } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { listVariantHistory, setVariantCost, setVariantPrice } from "@/server/catalog/pricing";
import { createReference, createSupplier, listReferences, setReferenceActive } from "@/server/catalog/references";
import { productFiltersSchema } from "@/server/catalog/schemas";
import { createProduct, getProduct, listProducts, setProductActive, updateProduct } from "@/server/catalog/service";
import { addVariant, updateVariant } from "@/server/catalog/variants";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, uniqueSuffix } from "./fixtures";

const filters = (values: Record<string, unknown> = {}) => productFiltersSchema.parse(values);
const sku = () => `S-${uniqueSuffix().toUpperCase()}`;

async function auditTrail(organizationId: string, entityId: string) {
  return withScope({ organizationId }, (tx) =>
    tx
      .select({ action: auditLogs.action, changes: auditLogs.changes, actorUserId: auditLogs.actorUserId })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, entityId)))
      .orderBy(asc(auditLogs.createdAt)),
  );
}

describe("catalog service: lifecycle", () => {
  it("creates a product with variants, prices and costs, and versions price changes", async () => {
    const { organizationId, owner, ownerId } = await createOrganizationFixture();
    const category = await createReference(owner, "category", { name: "Calçados" });
    const brand = await createReference(owner, "brand", { name: "Passo Firme" });
    const supplier = await createSupplier(owner, { name: "Fábrica Sul", document: "11.222.333/0001-81" });
    const created = await createProduct(owner, {
      name: "Tênis Corrida Leve",
      categoryId: category.id,
      brandId: brand.id,
      supplierId: supplier.id,
      variants: [
        { name: "Nº 39", sku: "tcl-39", barcode: "7891000315507", priceCents: 38990, costCents: 19500 },
        { name: "Nº 41", sku: "TCL-41" },
      ],
    });

    const product = await getProduct(owner, created.id);
    expect(product).toMatchObject({ name: "Tênis Corrida Leve", unit: "un", categoryName: "Calçados", brandName: "Passo Firme", supplierName: "Fábrica Sul" });
    expect(product?.variants).toEqual([
      expect.objectContaining({ name: "Nº 39", sku: "TCL-39", barcode: "7891000315507", priceCents: 38990, costCents: 19500 }),
      expect.objectContaining({ name: "Nº 41", sku: "TCL-41", barcode: null, priceCents: null, costCents: null }),
    ]);

    for (const q of ["corrida", "tcl-41", "78910003"]) {
      expect((await listProducts(owner, filters({ q }))).rows.map((row) => row.id)).toEqual([created.id]);
    }
    expect((await listProducts(owner, filters({ q: "%" }))).total).toBe(0);
    expect((await listProducts(owner, filters({ categoryId: category.id }))).rows[0]).toMatchObject({ variantCount: 2, brandName: "Passo Firme" });

    const variantId = created.variantIds[0];
    expect(await setVariantPrice(owner, variantId, 34990)).toEqual({ changed: true });
    expect(await setVariantPrice(owner, variantId, 34990)).toEqual({ changed: false });
    expect(await setVariantCost(owner, variantId, 18000)).toEqual({ changed: true });
    const prices = await listVariantHistory(owner, variantId, "price");
    expect(prices?.rows.map((row) => row.cents)).toEqual([34990, 38990]);
    expect((await listVariantHistory(owner, variantId, "cost"))?.rows.map((row) => row.cents)).toEqual([18000, 19500]);
    expect((await getProduct(owner, created.id))?.variants[0]).toMatchObject({ priceCents: 34990, costCents: 18000 });

    const trail = await auditTrail(organizationId, variantId);
    expect(trail.map((entry) => entry.action)).toEqual([
      "product_variant.created",
      "product_variant.price_changed",
      "product_variant.cost_changed",
    ]);
    expect(trail.every((entry) => entry.actorUserId === ownerId)).toBe(true);
    expect(trail[1].changes).toEqual({ priceCents: { from: 38990, to: 34990 } });
    // Cost amounts never reach the audit trail.
    expect(JSON.stringify(trail)).not.toMatch(/19500|18000/);
    expect((await auditTrail(organizationId, created.id)).map((entry) => entry.action)).toEqual(["product.created"]);
  });

  it("updates products and variants, writing audit entries only for real changes", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const created = await createProduct(owner, { name: "Sandália", unit: "un", variants: [{ name: "Nº 36", sku: sku() }] });
    await updateProduct(owner, created.id, { name: "Sandália" });
    await updateProduct(owner, created.id, { name: "Sandália Rasteira", description: "Couro" });
    await expect(updateProduct(owner, created.id, { name: "Sandália", unit: "kg" })).rejects.toMatchObject({ code: "invalid" });
    await setProductActive(owner, created.id, false);
    const trail = await auditTrail(organizationId, created.id);
    expect(trail.map((entry) => entry.action)).toEqual(["product.created", "product.updated", "product.updated"]);
    expect(trail[1].changes).toEqual({ name: { from: "Sandália", to: "Sandália Rasteira" }, description: { from: null, to: "Couro" } });

    const added = await addVariant(owner, created.id, { name: "Nº 37", sku: "SAN-37-X", priceCents: 12990 });
    await updateVariant(owner, added.id, { name: "Nº 37", sku: "san-37-x" });
    expect((await auditTrail(organizationId, added.id)).map((entry) => entry.action)).toEqual(["product_variant.created"]);
  });

  it("keeps SKU and barcode unique per organization only", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const code = sku();
    await createProduct(a.owner, { name: "Bota", variants: [{ name: "Nº 37", sku: code, barcode: "96385074" }] });
    await expect(createProduct(a.owner, { name: "Outra", variants: [{ name: "U", sku: code.toLowerCase() }] })).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { sku: ["SKU já utilizado nesta empresa."] },
    });
    await expect(createProduct(a.owner, { name: "Outra", variants: [{ name: "U", sku: sku(), barcode: "96385074" }] })).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { barcode: expect.any(Array) },
    });
    // A failed creation leaves no product behind.
    const names = await withScope({ organizationId: a.organizationId }, (tx) =>
      tx.select({ name: products.name }).from(products).where(eq(products.organizationId, a.organizationId)),
    );
    expect(names.map((row) => row.name)).toEqual(["Bota"]);
    await expect(createProduct(b.owner, { name: "Bota", variants: [{ name: "Nº 37", sku: code, barcode: "96385074" }] })).resolves.toHaveProperty("id");
  });

  it("refuses inactive categories for new products and duplicate names", async () => {
    const { owner } = await createOrganizationFixture();
    const category = await createReference(owner, "category", { name: "Acessórios" });
    await expect(createReference(owner, "category", { name: "acessórios" })).rejects.toMatchObject({ code: "conflict" });
    await setReferenceActive(owner, "category", category.id, false);
    expect((await listReferences(owner, "category", { status: "inactive" })).map((row) => row.id)).toEqual([category.id]);
    await expect(createProduct(owner, { name: "Cinto", categoryId: category.id, variants: [{ name: "U", sku: sku() }] })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { categoryId: expect.any(Array) },
    });
  });
});

describe("catalog service: authorization and isolation", () => {
  it("answers ids of another organization as not found and never links their references", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const foreign = await createVariantFixture(b.organizationId);
    const foreignCategory = await createReference(b.owner, "category", { name: "Externa" });
    expect(await getProduct(a.owner, foreign.productId)).toBeNull();
    expect(await listVariantHistory(a.owner, foreign.variantId, "price")).toBeNull();
    await expect(updateProduct(a.owner, foreign.productId, { name: "Sequestro" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setVariantPrice(a.owner, foreign.variantId, 1)).rejects.toMatchObject({ code: "not_found" });
    await expect(updateVariant(a.owner, foreign.variantId, { name: "X", sku: sku() })).rejects.toMatchObject({ code: "not_found" });
    await expect(addVariant(a.owner, foreign.productId, { name: "X", sku: sku() })).rejects.toMatchObject({ code: "not_found" });
    await expect(setReferenceActive(a.owner, "category", foreignCategory.id, false)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      createProduct(a.owner, { name: "Produto", categoryId: foreignCategory.id, variants: [{ name: "U", sku: sku() }] }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect((await listProducts(a.owner, filters())).total).toBe(0);
    const prices = await withScope({ organizationId: b.organizationId }, (tx) =>
      tx.select({ id: productPrices.id }).from(productPrices).where(eq(productPrices.variantId, foreign.variantId)),
    );
    expect(prices).toHaveLength(0);
  });

  it("lets front-line roles read prices without costs and blocks changes in the service", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const created = await createProduct(owner, { name: "Chinelo", variants: [{ name: "Nº 38", sku: sku(), priceCents: 8990, costCents: 3100 }] });
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] });
    const finance = await addMemberFixture(organizationId, { roleKey: "finance", storeIds: [storeId] });

    const seen = await getProduct(seller.context, created.id);
    expect(seen?.variants[0]).toMatchObject({ priceCents: 8990 });
    expect(seen?.variants[0]).not.toHaveProperty("costCents");
    await expect(listVariantHistory(seller.context, created.variantIds[0], "cost")).rejects.toMatchObject({ code: "forbidden" });
    expect((await getProduct(finance.context, created.id))?.variants[0]).toMatchObject({ costCents: 3100 });

    await expect(createProduct(seller.context, { name: "X", variants: [{ name: "U", sku: sku() }] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setVariantPrice(seller.context, created.variantIds[0], 1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setVariantCost(finance.context, created.variantIds[0], 1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createReference(seller.context, "brand", { name: "Nova" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("requires organization-wide access to manage the catalog and cost access to set costs", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const key = `catalogo_${uniqueSuffix()}`;
    await withScope({ organizationId }, async (tx) => {
      const [role] = await tx.insert(roles).values({ organizationId, key, name: `Catálogo ${key}`, isSystem: false, rank: 45 }).returning({ id: roles.id });
      await tx.insert(rolePermissions).values([
        { organizationId, roleId: role.id, permission: "catalog.read" },
        { organizationId, roleId: role.id, permission: "catalog.manage" },
      ]);
    });
    const scoped = await addMemberFixture(organizationId, { roleKey: key, storeAccess: "stores", storeIds: [storeId] });
    const wide = await addMemberFixture(organizationId, { roleKey: key, storeAccess: "all" });
    await expect(createProduct(scoped.context, { name: "Xis", variants: [{ name: "U", sku: sku() }] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createProduct(wide.context, { name: "Xis", variants: [{ name: "U", sku: sku(), costCents: 100 }] })).rejects.toMatchObject({
      code: "forbidden",
    });
    const created = await createProduct(wide.context, { name: "Xis", variants: [{ name: "U", sku: sku(), priceCents: 100 }] });
    await expect(setVariantCost(wide.context, created.variantIds[0], 50)).rejects.toMatchObject({ code: "forbidden" });
    expect(await getProduct(owner, created.id)).not.toBeNull();
  });

  it("keeps price and cost history append-only in the database", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const created = await createProduct(owner, { name: "Bolsa", variants: [{ name: "U", sku: sku(), priceCents: 100, costCents: 50 }] });
    await withScope({ organizationId }, async (tx) => {
      expect(await tx.update(productPrices).set({ priceCents: 1 }).where(eq(productPrices.organizationId, organizationId)).returning()).toHaveLength(0);
      expect(await tx.delete(productPrices).where(eq(productPrices.organizationId, organizationId)).returning()).toHaveLength(0);
      expect(await tx.update(productCosts).set({ costCents: 1 }).where(eq(productCosts.organizationId, organizationId)).returning()).toHaveLength(0);
      expect(await tx.delete(productCosts).where(eq(productCosts.organizationId, organizationId)).returning()).toHaveLength(0);
    });
    expect((await getProduct(owner, created.id))?.variants[0]).toMatchObject({ priceCents: 100, costCents: 50 });
  });
});
