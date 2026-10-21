import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { productVariants } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { searchVariants } from "@/server/catalog/variant-search";
import { addMemberFixture, createOrganizationFixture, createVariantFixture, uniqueSuffix } from "./fixtures";
import { setVariantCost } from "@/server/catalog/pricing";

describe("variant search", () => {
  it("finds by exact barcode, exact SKU and name, active first, with costs only for allowed members", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const tag = uniqueSuffix().toUpperCase();
    const active = await createVariantFixture(organizationId, { sku: `BUSCA-${tag}` });
    const inactive = await createVariantFixture(organizationId, { sku: `BUSCA-${tag}-X`, variantActive: false });
    await withScope({ organizationId }, (tx) => tx.update(productVariants).set({ barcode: "7891000315507" }).where(eq(productVariants.id, active.variantId)));
    await setVariantCost(owner, active.variantId, 1234);

    expect((await searchVariants(owner, "7891000315507")).map((hit) => hit.variantId)).toEqual([active.variantId]);
    expect((await searchVariants(owner, `busca-${tag}`.toLowerCase())).map((hit) => hit.variantId)).toEqual([active.variantId]);

    const byName = await searchVariants(owner, "Produto");
    expect(byName.map((hit) => hit.variantId)).toEqual(expect.arrayContaining([active.variantId, inactive.variantId]));
    expect(byName.findIndex((hit) => hit.variantId === active.variantId)).toBeLessThan(byName.findIndex((hit) => hit.variantId === inactive.variantId));
    expect((await searchVariants(owner, "Produto", { activeOnly: true })).map((hit) => hit.variantId)).not.toContain(inactive.variantId);

    expect((await searchVariants(owner, "7891000315507"))[0].costCents).toBe(1234);
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson" });
    const hit = (await searchVariants(seller.context, "7891000315507"))[0];
    expect(hit).toMatchObject({ variantId: active.variantId, isActive: true });
    expect("costCents" in hit).toBe(false);

    expect(await searchVariants(owner, "P")).toEqual([]);
  });

  it("never returns variants of another organization", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const tag = uniqueSuffix().toUpperCase();
    await createVariantFixture(a.organizationId, { sku: `ISO-${tag}` });
    expect(await searchVariants(b.owner, `ISO-${tag}`)).toEqual([]);
  });
});
