import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories, commissionRuleRates, commissionRules, products, sales } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { estimateCommission } from "@/server/commissions/calculate";
import { createRule } from "@/server/commissions/rules";
import { approveStatement, calculateStatement, cancelStatement, getStatement, payStatement } from "@/server/commissions/statements";
import { recordMovement } from "@/server/inventory/service";
import { cancelSale } from "@/server/sales/cancel";
import { completeSale } from "@/server/sales/complete";
import { refundSale } from "@/server/sales/refund";
import { saveSalesperson } from "@/server/salespeople/service";
import { todayIn } from "@/server/targets/schemas";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

const current = todayIn("America/Sao_Paulo").slice(0, 7);
const last = (() => {
  const [y, m] = current.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
})();

describe("commissions", () => {
  it("applies the rate in force per item, reverses cancellations and returns at the original rate and runs the statement states", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeA] });
    const otherSeller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeA] });
    const finance = await addMemberFixture(organizationId, { roleKey: "finance", storeAccess: "all" });
    const managerB = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeB] });
    const { id: salespersonId } = await saveSalesperson(owner, { membershipId: seller.membershipId, code: "V01", nickname: "Ana", storeIds: [storeA] });
    await saveSalesperson(owner, { membershipId: otherSeller.membershipId, code: "V02", nickname: "Beto", storeIds: [storeA] });

    const withCategory = await createVariantFixture(organizationId);
    const plain = await createVariantFixture(organizationId);
    const [category] = await withScope({ organizationId }, (tx) => tx.insert(categories).values({ organizationId, name: "Premium" }).returning({ id: categories.id }));
    // A rule in force since long ago (created directly: the service refuses retroactive rules).
    await withScope({ organizationId }, async (tx) => {
      await tx.update(products).set({ categoryId: category.id }).where(eq(products.id, withCategory.productId));
      const [rule] = await tx.insert(commissionRules).values({ organizationId, version: 1, effectiveFrom: "2000-01-01", defaultRateBps: 300 }).returning({ id: commissionRules.id });
      await tx.insert(commissionRuleRates).values({ organizationId, ruleId: rule.id, categoryId: category.id, rateBps: 1000 });
    });
    await expect(createRule(owner, { effectiveFrom: `${last}-01`, defaultRateBps: 1 })).rejects.toMatchObject({ fieldErrors: { effectiveFrom: expect.any(Array) } });
    await createRule(owner, { storeId: storeA, effectiveFrom: `${current}-01`, defaultRateBps: 500 });

    for (const variant of [withCategory, plain]) {
      await setPriceFixture(organizationId, variant.variantId, 1000);
      await recordMovement(owner, { storeId: storeA, variantId: variant.variantId, type: "entry", quantity: "10", reason: "Estoque" });
    }
    await openCashSessionFixture(organizationId, storeA, owner.user.id, 0);
    const sell = async (variantId: string, quantity: number, completedIn?: string) => {
      const { saleId } = await completeSale(owner, {
        completionKey: randomUUID(),
        storeId: storeA,
        salespersonUserId: seller.userId,
        items: [{ variantId, quantity: String(quantity), expectedUnitPriceCents: 1000 }],
        payments: [{ method: "cash", amountCents: quantity * 1000, tenderedCents: quantity * 1000 }],
      });
      if (completedIn) await withScope({ organizationId }, (tx) => tx.update(sales).set({ completedAt: new Date(`${completedIn}-15T15:00:00Z`) }).where(eq(sales.id, saleId)));
      return saleId;
    };
    const s1 = await sell(withCategory.variantId, 2, last); // 2000 × 10% = 200
    await sell(plain.variantId, 1, last); // 1000 × 3% = 30
    const s3 = await sell(plain.variantId, 1, last); // 30, cancelled this month
    const s4 = await sell(plain.variantId, 1); // this month: 1000 × 5% = 50, cancelled this month
    await cancelSale(owner, s3, { idempotencyKey: randomUUID(), reason: "Erro" });
    await cancelSale(owner, s4, { idempotencyKey: randomUUID(), reason: "Erro" });
    await refundSale(owner, s1, { idempotencyKey: randomUUID(), reason: "Defeito", method: "card_external", nsu: "EST1234", items: [{ line: 1, quantity: "1" }] });

    const key = { salespersonId, storeId: storeA, month: last };
    expect(await estimateCommission(owner, key)).toMatchObject({ baseCents: 4000, commissionCents: 260 });
    // This month: s4 +50 −50, s3 reversal −30 (last month's rate), s1 return −100 (10% of its category).
    expect(await estimateCommission(seller.context, { ...key, month: current })).toMatchObject({ baseCents: -2000, commissionCents: -130 });
    await expect(estimateCommission(otherSeller.context, key)).rejects.toMatchObject({ code: "not_found" });
    await expect(estimateCommission(managerB.context, key)).rejects.toMatchObject({ code: "not_found" });

    await expect(calculateStatement(finance.context, { ...key, month: current })).rejects.toMatchObject({ code: "invalid" });
    const first = await calculateStatement(finance.context, key);
    const statement = await calculateStatement(finance.context, key);
    expect((await getStatement(owner, first.id))?.status).toBe("cancelled");
    expect(await getStatement(owner, statement.id)).toMatchObject({ status: "calculated", baseCents: 4000, commissionCents: 260, lines: expect.arrayContaining([expect.objectContaining({ rateBps: 1000, commissionCents: 200 })]) });
    await expect(approveStatement(finance.context, statement.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(payStatement(finance.context, statement.id, { paymentReference: "PIX-123" })).rejects.toMatchObject({ code: "invalid" });
    await approveStatement(owner, statement.id);
    await expect(calculateStatement(finance.context, key)).rejects.toMatchObject({ code: "invalid" });
    await payStatement(finance.context, statement.id, { paymentReference: "PIX-123" });
    await expect(cancelStatement(finance.context, statement.id, { reason: "Tarde" })).rejects.toMatchObject({ code: "invalid" });
    await expect(approveStatement(managerB.context, statement.id)).rejects.toMatchObject({ code: "forbidden" });

    const other = await createOrganizationFixture();
    expect(await getStatement(other.owner, statement.id)).toBeNull();
  });
});
