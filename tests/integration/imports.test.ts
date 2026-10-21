import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories, customers, importRows, inventoryBalances, productVariants, products, rolePermissions, roles } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { createCustomer } from "@/server/customers/service";
import { getImport, listImports } from "@/server/imports/queries";
import { confirmImport, createImport, discardImport } from "@/server/imports/service";
import { recordMovement } from "@/server/inventory/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, uniqueSuffix } from "./fixtures";

const csv = (text: string) => new TextEncoder().encode(text);
const page = { page: 1 };

async function productCount(organizationId: string) {
  return withScope({ organizationId }, async (tx) => (await tx.select({ id: products.id }).from(products).where(eq(products.organizationId, organizationId))).length);
}

describe("product imports", () => {
  it("previews without writing, then applies only the valid rows once, grouping variants by product", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const suffix = uniqueSuffix().toUpperCase();
    await withScope({ organizationId }, (tx) => tx.insert(categories).values({ organizationId, name: "Camisetas" }));
    await createVariantFixture(organizationId, { sku: `OLD-${suffix}` });
    const before = await productCount(organizationId);
    const file = [
      "Produto;Variação;SKU;Preço;Categoria",
      `Camiseta Lisa;P;CL-P-${suffix};39,90;camisetas`,
      `camiseta lisa;M;CL-M-${suffix};39,90;Camisetas`,
      `Boné;;BN-${suffix};R$ 25;`,
      `Repetido;;BN-${suffix};10;`,
      `Antigo;;OLD-${suffix};10;`,
      `Sem categoria;;SC-${suffix};10;Inexistente`,
      `Preço ruim;;PR-${suffix};abc;`,
    ].join("\n");
    const mapping = { productName: "Produto", variantName: "Variação", sku: "SKU", price: "Preço", category: "Categoria" };
    const created = await createImport(owner, { kind: "products", fileName: "produtos.csv", mapping }, csv(file));
    expect(await productCount(organizationId)).toBe(before);
    const preview = await getImport(owner, created.id, page);
    expect(preview?.counts).toEqual({ ok: 3, error: 3, skipped: 1, applied: 0, failed: 0 });
    expect(preview?.rows.rows.find((row) => row.line === 6)?.messages).toEqual(["SKU já cadastrado."]);

    const [first, second] = await Promise.all([confirmImport(owner, created.id), confirmImport(owner, created.id)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ applied: 3, ok: 0 });
    expect(await confirmImport(owner, created.id)).toEqual(first);
    expect(await productCount(organizationId)).toBe(before + 2);
    const variants = await withScope({ organizationId }, (tx) =>
      tx.select({ sku: productVariants.sku, productId: productVariants.productId }).from(productVariants).where(eq(productVariants.sku, `CL-M-${suffix}`)),
    );
    const siblings = await withScope({ organizationId }, (tx) => tx.select({ sku: productVariants.sku }).from(productVariants).where(eq(productVariants.productId, variants[0].productId)));
    expect(siblings.map((row) => row.sku).sort()).toEqual([`CL-M-${suffix}`, `CL-P-${suffix}`]);
    await expect(discardImport(owner, created.id)).rejects.toMatchObject({ code: "invalid" });
  });

  it("marks a unit as failed when its data changed after the preview and keeps the others", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const suffix = uniqueSuffix().toUpperCase();
    const created = await createImport(owner, { kind: "products", fileName: "p.csv", mapping: { productName: "nome", sku: "sku" } }, csv(`nome,sku\nProduto A,A-${suffix}\nProduto B,B-${suffix}`));
    await createVariantFixture(organizationId, { sku: `A-${suffix}` });
    expect(await confirmImport(owner, created.id)).toMatchObject({ applied: 1, failed: 1 });
    const failed = await withScope({ organizationId }, (tx) => tx.select({ messages: importRows.messages }).from(importRows).where(and(eq(importRows.importId, created.id), eq(importRows.status, "failed"))));
    expect(failed[0].messages[0]).toContain("SKU");
  });

  it("refuses files over the limits, binary files and unknown columns", async () => {
    const { owner } = await createOrganizationFixture();
    const mapping = { productName: "nome", sku: "sku" };
    const input = { kind: "products", fileName: "p.csv", mapping };
    await expect(createImport(owner, input, new Uint8Array(2 * 1024 * 1024 + 1).fill(65))).rejects.toMatchObject({ fieldErrors: { file: [expect.stringContaining("2 MB")] } });
    await expect(createImport(owner, input, csv(`nome;sku\n${"a;b\n".repeat(5001)}`))).rejects.toMatchObject({ fieldErrors: { file: [expect.stringContaining("5000")] } });
    await expect(createImport(owner, input, new Uint8Array([110, 0, 115]))).rejects.toMatchObject({ code: "invalid" });
    await expect(createImport(owner, { ...input, mapping: { productName: "produto", sku: "sku" } }, csv("nome;sku\na;b"))).rejects.toMatchObject({
      fieldErrors: { "mapping.productName": expect.any(Array) },
    });
  });
});

describe("customer imports", () => {
  it("turns existing CPFs into errors, skips repeats, never imports consent and masks CPFs without permission", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    await createCustomer(owner, { name: "Já Existe", document: "529.982.247-25" });
    const file = "Nome;CPF;E-mail\nAna;111.444.777-35;ana@example.test\nAna de novo;11144477735;\nExistente;52998224725;\nBeto;;";
    const created = await createImport(owner, { kind: "customers", fileName: "c.csv", mapping: { name: "Nome", document: "CPF", email: "E-mail" } }, csv(file));
    expect((await getImport(owner, created.id, page))?.counts).toMatchObject({ ok: 2, error: 1, skipped: 1 });
    expect(await confirmImport(owner, created.id)).toMatchObject({ applied: 2 });
    const rows = await withScope({ organizationId }, (tx) => tx.select({ name: customers.name, consent: customers.marketingConsent }).from(customers).where(eq(customers.organizationId, organizationId)));
    expect(rows.map((row) => row.name).sort()).toEqual(["Ana", "Beto", "Já Existe"]);
    expect(rows.every((row) => row.consent === false)).toBe(true);

    const key = `importa_${uniqueSuffix()}`;
    await withScope({ organizationId }, async (tx) => {
      const [role] = await tx.insert(roles).values({ organizationId, key, name: `Importa ${key}`, isSystem: false, rank: 45 }).returning({ id: roles.id });
      await tx.insert(rolePermissions).values(["imports.manage", "customers.read", "customers.manage"].map((permission) => ({ organizationId, roleId: role.id, permission })));
    });
    const limited = await addMemberFixture(organizationId, { roleKey: key, storeAccess: "all" });
    const seen = await getImport(limited.context, created.id, page);
    expect(seen?.rows.rows.find((row) => row.line === 2)?.document).toBe("***.444.777-**");
  });
});

describe("opening stock imports", () => {
  it("applies only to items without movements in the store and respects permissions, scope and isolation", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const fresh = await createVariantFixture(organizationId);
    const moved = await createVariantFixture(organizationId);
    const weighed = await createVariantFixture(organizationId, { unit: "kg" });
    await recordMovement(owner, { storeId, variantId: moved.variantId, type: "entry", quantity: "1", reason: "Já tinha" });
    const skus = await withScope({ organizationId }, (tx) => tx.select({ id: productVariants.id, sku: productVariants.sku }).from(productVariants));
    const sku = (id: string) => skus.find((row) => row.id === id)!.sku;
    const file = `SKU;Qtd\n${sku(fresh.variantId)};5\n${sku(moved.variantId)};3\n${sku(weighed.variantId)};1,5\nNAO-EXISTE;1\n${sku(fresh.variantId)};9`;
    const input = { kind: "opening_stock", storeId, fileName: "saldo.csv", mapping: { sku: "SKU", quantity: "Qtd" } };

    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeId] });
    await expect(createImport(manager.context, input, csv(file))).rejects.toMatchObject({ code: "forbidden" });
    await expect(createImport(owner, { ...input, storeId: randomUUID() }, csv(file))).rejects.toMatchObject({ code: "not_found" });

    const created = await createImport(owner, input, csv(file));
    expect((await getImport(owner, created.id, page))?.counts).toMatchObject({ ok: 2, error: 2, skipped: 1 });
    expect(await confirmImport(owner, created.id)).toMatchObject({ applied: 2 });
    const balances = await withScope({ organizationId }, (tx) => tx.select({ variantId: inventoryBalances.variantId, quantity: inventoryBalances.quantity }).from(inventoryBalances).where(eq(inventoryBalances.storeId, storeId)));
    expect(new Map(balances.map((row) => [row.variantId, row.quantity]))).toEqual(
      new Map([
        [fresh.variantId, "5.000"],
        [moved.variantId, "1.000"],
        [weighed.variantId, "1.500"],
      ]),
    );

    const other = await createOrganizationFixture();
    expect(await getImport(other.owner, created.id, page)).toBeNull();
    await expect(confirmImport(other.owner, created.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await listImports(other.owner, page)).rows).toEqual([]);
  });

  it("discards a preview and its rows", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const created = await createImport(owner, { kind: "customers", fileName: "c.csv", mapping: { name: "nome" } }, csv("nome\nAna\nBeto"));
    await discardImport(owner, created.id);
    const rows = await withScope({ organizationId }, (tx) => tx.select({ id: importRows.id }).from(importRows).where(eq(importRows.importId, created.id)));
    expect(rows).toEqual([]);
    await expect(confirmImport(owner, created.id)).rejects.toMatchObject({ code: "invalid" });
  });
});
