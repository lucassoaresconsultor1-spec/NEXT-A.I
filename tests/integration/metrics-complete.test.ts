import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setVariantCost } from "@/server/catalog/pricing";
import { createExpense, saveCategory } from "@/server/expenses/service";
import { recordMovement } from "@/server/inventory/service";
import { fullSalesSummary } from "@/server/metrics/complete";
import { salesSummary } from "@/server/metrics/sales";
import { callNext, finishAttendance, queueStats, registerArrival, setPresence } from "@/server/queue/service";
import { cancelSale } from "@/server/sales/cancel";
import { completeSale } from "@/server/sales/complete";
import { refundSale } from "@/server/sales/refund";
import { saveSalesperson } from "@/server/salespeople/service";
import { targetProgress } from "@/server/targets/progress";
import { monthRange, todayIn } from "@/server/targets/schemas";
import { setTarget } from "@/server/targets/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

describe("complete metrics", () => {
  it("computes margin from the cost snapshot, profit only with expenses, and keeps the same numbers across channels", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const costed = await createVariantFixture(organizationId);
    const uncosted = await createVariantFixture(organizationId);
    for (const variant of [costed, uncosted]) {
      await setPriceFixture(organizationId, variant.variantId, 1000);
      await recordMovement(owner, { storeId, variantId: variant.variantId, type: "entry", quantity: "10", reason: "Estoque" });
    }
    await setVariantCost(owner, costed.variantId, 600);
    const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeId] });
    await openCashSessionFixture(organizationId, storeId, cashier.userId, 0);
    const sell = async (variantId: string, quantity: number) =>
      (
        await completeSale(cashier.context, {
          completionKey: randomUUID(),
          storeId,
          items: [{ variantId, quantity: String(quantity), expectedUnitPriceCents: 1000 }],
          payments: [{ method: "cash", amountCents: quantity * 1000, tenderedCents: quantity * 1000 }],
        })
      ).saleId;
    const s1 = await sell(costed.variantId, 2);
    await sell(uncosted.variantId, 1);
    const s3 = await sell(costed.variantId, 1);
    await cancelSale(cashier.context, s3, { idempotencyKey: randomUUID(), reason: "Erro" });
    await refundSale(owner, s1, { idempotencyKey: randomUUID(), reason: "Defeito", method: "card_external", nsu: "EST1234", items: [{ line: 1, quantity: "1" }] });

    const day = todayIn("America/Sao_Paulo");
    const period = { from: day, to: day };
    const full = await fullSalesSummary(owner, period);
    expect(full).toMatchObject({ netRevenueCents: 2000, margin: { costedRevenueCents: 1000, cogsCents: 600, grossMarginCents: 400, marginPercent: "40.0", uncostedItems: 1 }, profit: null });

    const category = await saveCategory(owner, { name: "Aluguel" });
    await createExpense(owner, { storeId, categoryId: category.id, competenceDate: day, description: "Aluguel", amountCents: 300 });
    expect((await fullSalesSummary(owner, period)).profit).toEqual({ expensesCents: 300, netProfitCents: 100, complete: false });

    // Same net revenue in the sales summary, the complete summary and the goal progress.
    const month = monthRange(day.slice(0, 7));
    await setTarget(owner, { scope: "store", storeId, month: day.slice(0, 7), amountCents: 10_000 });
    const monthNet = (await salesSummary(owner, month)).netRevenueCents;
    expect((await fullSalesSummary(owner, month)).netRevenueCents).toBe(monthNet);
    expect((await targetProgress(owner, { month: day.slice(0, 7) }))[0].achievedCents).toBe(monthNet);

    // Same conversion as the queue statistics.
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] });
    const { id: salespersonId } = await saveSalesperson(owner, { membershipId: seller.membershipId, code: "V01", nickname: "Ana", storeIds: [storeId] });
    await setPresence(owner, { storeId, salespersonId, status: "available" });
    await registerArrival(owner, { storeId, requestKey: randomUUID() });
    const call = await callNext(owner, { storeId });
    await finishAttendance(owner, call!.entryId, { outcome: "no_sale", reason: "Só olhando" });
    const conversion = (await fullSalesSummary(owner, period)).conversion;
    expect(conversion).toEqual(await queueStats(owner, { storeId, ...period }));
    expect(conversion).toMatchObject({ finished: 1, conversion: "0.0" });

    // Blocks follow permissions: a cashier sees neither costs, expenses nor commissions.
    expect(await fullSalesSummary(cashier.context, period)).toMatchObject({ margin: null, profit: null, commissions: null });
  });
});
