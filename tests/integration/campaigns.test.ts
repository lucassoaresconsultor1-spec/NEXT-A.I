import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories, commissionRules, products } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { estimateCommission } from "@/server/commissions/calculate";
import { createCampaign, endCampaign, getCampaign, listCampaigns } from "@/server/commissions/campaigns";
import { recordMovement } from "@/server/inventory/service";
import { completeSale } from "@/server/sales/complete";
import { refundSale } from "@/server/sales/refund";
import { saveSalesperson } from "@/server/salespeople/service";
import { todayIn } from "@/server/targets/schemas";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

const today = todayIn("America/Sao_Paulo");
const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe("commission campaigns", () => {
  it("adds the highest bonus of the campaigns in force to eligible items and reverses with the sale's bonus", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeA] });
    const managerB = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeB] });
    const regionalB = await addMemberFixture(organizationId, { roleKey: "regional_manager", storeAccess: "stores", storeIds: [storeB] });
    const { id: salespersonId } = await saveSalesperson(owner, { membershipId: seller.membershipId, code: "V01", nickname: "Ana", storeIds: [storeA] });
    const focus = await createVariantFixture(organizationId);
    const sameCategory = await createVariantFixture(organizationId);
    const plain = await createVariantFixture(organizationId);
    const [category] = await withScope({ organizationId }, async (tx) => {
      await tx.insert(commissionRules).values({ organizationId, version: 1, effectiveFrom: "2000-01-01", defaultRateBps: 300 });
      const created = await tx.insert(categories).values({ organizationId, name: "Verão" }).returning({ id: categories.id });
      await tx.update(products).set({ categoryId: created[0].id }).where(inArray(products.id, [focus.productId, sameCategory.productId]));
      return created;
    });

    const base = { startsOn: today, endsOn: shift(30), productIds: [], categoryIds: [] };
    await expect(createCampaign(owner, { ...base, name: "Atrasada", startsOn: shift(-1), bonusRateBps: 100, categoryIds: [category.id] })).rejects.toMatchObject({ fieldErrors: { startsOn: expect.any(Array) } });
    await expect(createCampaign(owner, { ...base, name: "Vazia", bonusRateBps: 100 })).rejects.toMatchObject({ fieldErrors: { productIds: expect.any(Array) } });
    await expect(createCampaign(regionalB.context, { ...base, name: "Rede", bonusRateBps: 100, categoryIds: [category.id] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createCampaign(regionalB.context, { ...base, name: "Outra loja", storeId: storeA, bonusRateBps: 100, categoryIds: [category.id] })).rejects.toMatchObject({ code: "not_found" });
    const network = await createCampaign(owner, { ...base, name: "Verão na rede", bonusRateBps: 200, categoryIds: [category.id] });
    const storeOnly = await createCampaign(owner, { ...base, name: "Foco loja A", storeId: storeA, bonusRateBps: 500, productIds: [focus.productId] });
    const otherStore = await createCampaign(regionalB.context, { ...base, name: "Loja B", storeId: storeB, bonusRateBps: 1000, productIds: [plain.productId] });
    const later = await createCampaign(owner, { ...base, name: "Depois", startsOn: shift(1), bonusRateBps: 900, productIds: [plain.productId] });

    for (const variant of [focus, sameCategory, plain]) {
      await setPriceFixture(organizationId, variant.variantId, 1000);
      await recordMovement(owner, { storeId: storeA, variantId: variant.variantId, type: "entry", quantity: "10", reason: "Estoque" });
    }
    await openCashSessionFixture(organizationId, storeA, owner.user.id, 0);
    const sell = (variantId: string) =>
      completeSale(owner, {
        completionKey: randomUUID(),
        storeId: storeA,
        salespersonUserId: seller.userId,
        items: [{ variantId, quantity: "1", expectedUnitPriceCents: 1000 }],
        payments: [{ method: "cash", amountCents: 1000, tenderedCents: 1000 }],
      });
    const focusSale = await sell(focus.variantId);
    await sell(sameCategory.variantId);
    await sell(plain.variantId);
    await refundSale(owner, focusSale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "card_external", nsu: "CMP1234", items: [{ line: 1, quantity: "1" }] });

    const key = { salespersonId, storeId: storeA, month: today.slice(0, 7) };
    const estimate = await estimateCommission(owner, key);
    const lines = (kind: string, campaignId: string | null) => estimate.lines.filter((line) => line.kind === kind && line.campaignId === campaignId).map((line) => [line.rateBps, line.bonusRateBps, line.commissionCents]);
    // The store campaign (500) beats the network one (200) on the focus product, also on its return.
    expect(lines("sale", storeOnly.id)).toEqual([[300, 500, 80]]);
    expect(lines("refund", storeOnly.id)).toEqual([[300, 500, -80]]);
    expect(lines("sale", network.id)).toEqual([[300, 200, 50]]);
    // Store B's campaign and the one that has not started do not apply.
    expect(lines("sale", null)).toEqual([[300, 0, 30]]);
    expect(estimate.commissionCents).toBe(80);

    // Ending: before the start cancels; after it the period ends today and today's sales keep the bonus.
    await expect(endCampaign(owner, later.id, { reason: "Mudou o plano" })).resolves.toEqual({ status: "cancelled" });
    await expect(endCampaign(owner, network.id, { reason: "Estoque acabou" })).resolves.toEqual({ status: "ended" });
    await expect(endCampaign(owner, network.id, { reason: "De novo" })).rejects.toMatchObject({ code: "invalid" });
    expect((await getCampaign(owner, network.id)).endsOn).toBe(today);
    expect((await estimateCommission(owner, key)).commissionCents).toBe(80);
    await expect(endCampaign(managerB.context, otherStore.id, { reason: "Sem permissão" })).rejects.toMatchObject({ code: "forbidden" });

    // Scope: store B's manager sees the network campaign and their store's, not store A's.
    const visible = (await listCampaigns(managerB.context, {})).rows.map((row) => row.id).sort();
    expect(visible).toEqual([network.id, otherStore.id, later.id].sort());
    await expect(getCampaign(managerB.context, storeOnly.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(endCampaign(regionalB.context, storeOnly.id, { reason: "Fora do escopo" })).rejects.toMatchObject({ code: "not_found" });
    expect((await listCampaigns(owner, { status: "active" })).rows.map((row) => row.id).sort()).toEqual([network.id, storeOnly.id, otherStore.id].sort());
    const other = await createOrganizationFixture();
    await expect(getCampaign(other.owner, network.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
