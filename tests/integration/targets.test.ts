import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { regions } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { countBusinessDays } from "@/lib/business-days";
import { recordMovement } from "@/server/inventory/service";
import { salesSummary } from "@/server/metrics/sales";
import { completeSale } from "@/server/sales/complete";
import { refundSale } from "@/server/sales/refund";
import { saveSalesperson } from "@/server/salespeople/service";
import { targetProgress } from "@/server/targets/progress";
import { monthRange, todayIn } from "@/server/targets/schemas";
import { listTargets, setTarget, targetHistory } from "@/server/targets/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

const month = todayIn("America/Sao_Paulo").slice(0, 7);
const [year] = month.split("-").map(Number);
const nextJanuary = `${year + 1}-01`;
const previousMonth = (() => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
})();

async function setup() {
  const org = await createOrganizationFixture();
  const [region] = await withScope({ organizationId: org.organizationId }, (tx) => tx.insert(regions).values({ organizationId: org.organizationId, name: `Região ${randomUUID().slice(0, 6)}` }).returning({ id: regions.id }));
  const storeA = await createStoreFixture(org.organizationId, { regionId: region.id });
  const storeB = await createStoreFixture(org.organizationId, { regionId: region.id });
  const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeA] });
  const seller = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeA] });
  return { ...org, regionId: region.id, storeA, storeB, manager, seller };
}

describe("sales targets", () => {
  it("keeps every version with its reason, refuses past months and serializes concurrent changes", async () => {
    const s = await setup();
    const store = { scope: "store", storeId: s.storeA, month };
    const first = await setTarget(s.manager.context, { ...store, amountCents: 500_000 });
    expect(first.version).toBe(1);
    await expect(setTarget(s.manager.context, { ...store, amountCents: 600_000 })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(Array) } });
    await setTarget(s.manager.context, { ...store, amountCents: 600_000, reason: "Reforma da loja" });
    const results = await Promise.allSettled([700_000, 800_000].map((amountCents) => setTarget(s.manager.context, { ...store, amountCents, reason: "Ajuste" })));
    expect(results.filter((result) => result.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const history = await targetHistory(s.manager.context, first.id);
    expect(history.map((row) => row.version)).toEqual(history.map((_, index) => index + 1));
    expect(history.slice(0, 2).map((row) => [row.amountCents, row.reason])).toEqual([
      [500_000, null],
      [600_000, "Reforma da loja"],
    ]);
    const current = await listTargets(s.manager.context, { month });
    expect(current).toHaveLength(1);
    expect(current[0].version).toBe(history.length);
    await expect(setTarget(s.manager.context, { ...store, month: previousMonth, amountCents: 1 })).rejects.toMatchObject({ code: "invalid" });
  });

  it("measures progress with the sales metrics and projects by working days", async () => {
    const s = await setup();
    const { variantId } = await createVariantFixture(s.organizationId);
    await setPriceFixture(s.organizationId, variantId, 1000);
    await recordMovement(s.owner, { storeId: s.storeA, variantId, type: "entry", quantity: "10", reason: "Estoque" });
    await openCashSessionFixture(s.organizationId, s.storeA, s.manager.userId, 0);
    const { id: salespersonId } = await saveSalesperson(s.owner, { membershipId: s.seller.membershipId, code: "V01", nickname: "Ana", storeIds: [s.storeA] });
    const sale = await completeSale(s.manager.context, {
      completionKey: randomUUID(),
      storeId: s.storeA,
      salespersonUserId: s.seller.userId,
      items: [{ variantId, quantity: "2", expectedUnitPriceCents: 1000 }],
      payments: [{ method: "cash", amountCents: 2000, tenderedCents: 2000 }],
    });
    await completeSale(s.manager.context, {
      completionKey: randomUUID(),
      storeId: s.storeA,
      items: [{ variantId, quantity: "1", expectedUnitPriceCents: 1000 }],
      payments: [{ method: "cash", amountCents: 1000, tenderedCents: 1000 }],
    });
    await refundSale(s.manager.context, sale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "card_external", nsu: "EST1234", items: [{ line: 1, quantity: "1" }] });

    await setTarget(s.manager.context, { scope: "store", storeId: s.storeA, month, amountCents: 10_000 });
    await setTarget(s.manager.context, { scope: "salesperson", storeId: s.storeA, salespersonId, month, amountCents: 4000 });
    await setTarget(s.owner, { scope: "region", regionId: s.regionId, month, amountCents: 20_000 });
    await setTarget(s.owner, { scope: "store", storeId: s.storeA, month: nextJanuary, amountCents: 10_000 });

    const progress = await targetProgress(s.owner, { month });
    const byScope = new Map(progress.map((row) => [row.scope, row]));
    const range = monthRange(month);
    const storeNet = (await salesSummary(s.owner, { ...range, storeIds: [s.storeA] })).netRevenueCents;
    expect(storeNet).toBe(2000);
    expect(byScope.get("store")).toMatchObject({ achievedCents: storeNet, percent: "20.0" });
    expect(byScope.get("salesperson")).toMatchObject({ achievedCents: 1000, percent: "25.0" });
    expect(byScope.get("region")).toMatchObject({ achievedCents: 2000, percent: "10.0" });
    const store = byScope.get("store")!;
    expect(store.workingDaysTotal).toBe(countBusinessDays(range.from, range.to));
    expect(store.projectionCents).toBe(store.workingDaysElapsed === 0 ? 0 : Math.floor((2000 * store.workingDaysTotal) / store.workingDaysElapsed));

    const future = (await targetProgress(s.owner, { month: nextJanuary }))[0];
    const january = monthRange(nextJanuary);
    expect(future).toMatchObject({ achievedCents: 0, workingDaysElapsed: 0, projectionCents: 0, workingDaysTotal: countBusinessDays(january.from, january.to) });

    // The salesperson (no sales.read) sees only their own goal.
    expect((await targetProgress(s.seller.context, { month })).map((row) => row.scope)).toEqual(["salesperson"]);
  });

  it("limits goals to the actor's reach and isolates organizations", async () => {
    const s = await setup();
    await expect(setTarget(s.manager.context, { scope: "organization", month, amountCents: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setTarget(s.manager.context, { scope: "region", regionId: s.regionId, month, amountCents: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setTarget(s.manager.context, { scope: "store", storeId: s.storeB, month, amountCents: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(setTarget(s.seller.context, { scope: "store", storeId: s.storeA, month, amountCents: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setTarget(s.owner, { scope: "salesperson", storeId: s.storeA, salespersonId: randomUUID(), month, amountCents: 1 })).rejects.toMatchObject({ code: "not_found" });
    const b = await setTarget(s.owner, { scope: "store", storeId: s.storeB, month, amountCents: 1000 });
    expect(await listTargets(s.manager.context, { month })).toEqual([]);
    await expect(targetHistory(s.manager.context, b.id)).rejects.toMatchObject({ code: "not_found" });
    const other = await createOrganizationFixture();
    expect(await listTargets(other.owner, { month })).toEqual([]);
    await expect(targetHistory(other.owner, b.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
