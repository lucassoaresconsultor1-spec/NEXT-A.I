import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sales, stores } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordMovement } from "@/server/inventory/service";
import { salesDrillDown, salesSeries, salesSummary } from "@/server/metrics/sales";
import { cancelSale } from "@/server/sales/cancel";
import { completeSale } from "@/server/sales/complete";
import { refundSale } from "@/server/sales/refund";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const D1 = shift(today, -5);

async function setup() {
  const org = await createOrganizationFixture();
  const storeA = await createStoreFixture(org.organizationId);
  const storeB = await createStoreFixture(org.organizationId);
  const storeC = await createStoreFixture(org.organizationId);
  await withScope({ organizationId: org.organizationId }, async (tx) => {
    await tx.update(stores).set({ timezone: "America/Sao_Paulo" }).where(eq(stores.id, storeA));
    await tx.update(stores).set({ timezone: "America/Manaus" }).where(eq(stores.id, storeB));
  });
  const { variantId } = await createVariantFixture(org.organizationId);
  await setPriceFixture(org.organizationId, variantId, 1000);
  const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeA, storeB, storeC] });
  const seller = await addMemberFixture(org.organizationId, { roleKey: "salesperson", storeIds: [storeA] });
  // One open cash session per operator: a manager per store sells there.
  const operators = new Map<string, typeof manager>();
  for (const storeId of [storeA, storeB, storeC]) {
    await recordMovement(org.owner, { storeId, variantId, type: "entry", quantity: "20", reason: "Estoque" });
    const operator = storeId === storeA ? manager : await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeId] });
    await openCashSessionFixture(org.organizationId, storeId, operator.userId, 0);
    operators.set(storeId, operator);
  }
  return { ...org, storeA, storeB, storeC, variantId, manager, seller, operators };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function sell(s: Setup, storeId: string, quantity: number, extra: { saleDiscountCents?: number; surchargeCents?: number; salespersonUserId?: string; completedAt?: string } = {}) {
  const total = quantity * 1000 - (extra.saleDiscountCents ?? 0) + (extra.surchargeCents ?? 0);
  const { saleId } = await completeSale(s.operators.get(storeId)!.context, {
    completionKey: randomUUID(),
    storeId,
    salespersonUserId: extra.salespersonUserId,
    items: [{ variantId: s.variantId, quantity: String(quantity), expectedUnitPriceCents: 1000 }],
    saleDiscountCents: extra.saleDiscountCents ?? 0,
    surchargeCents: extra.surchargeCents ?? 0,
    payments: [{ method: "cash", amountCents: total, tenderedCents: total }],
  });
  if (extra.completedAt) {
    await withScope({ organizationId: s.organizationId }, (tx) => tx.update(sales).set({ completedAt: new Date(extra.completedAt!) }).where(eq(sales.id, saleId)));
  }
  return saleId;
}

describe("sales metrics", () => {
  it("matches a known data set in summary, series and drill-down, by store time zone", async () => {
    const s = await setup();
    const next = shift(D1, 1);
    const s1 = await sell(s, s.storeA, 2, { saleDiscountCents: 100, salespersonUserId: s.seller.userId, completedAt: `${D1}T15:00:00Z` });
    await sell(s, s.storeA, 1, { surchargeCents: 50, completedAt: `${next}T02:30:00Z` }); // 23:30 in São Paulo on D1
    const s3 = await sell(s, s.storeA, 1); // today, cancelled today
    const s4 = await sell(s, s.storeB, 3, { completedAt: `${next}T03:30:00Z` }); // 23:30 in Manaus on D1
    await sell(s, s.storeC, 1, { completedAt: `${D1}T15:00:00Z` });
    await cancelSale(s.manager.context, s3, { idempotencyKey: randomUUID(), reason: "Desistiu" });
    await refundSale(s.manager.context, s1, { idempotencyKey: randomUUID(), reason: "Defeito", method: "card_external", nsu: "EST1111", items: [{ line: 1, quantity: "1" }] });
    await refundSale(s.manager.context, s4, { idempotencyKey: randomUUID(), reason: "Defeito", method: "card_external", nsu: "EST2222", items: [{ line: 1, quantity: "1" }] });

    const period = { from: D1, to: today };
    expect(await salesSummary(s.owner, period)).toEqual({
      grossRevenueCents: 8050,
      discountCents: 100,
      cancelledCents: 1000,
      returnedCents: 1950,
      netRevenueCents: 5000,
      saleCount: 4,
      averageTicketCents: 1250,
      itemsPerSale: "1.75",
      period,
    });

    const byDay = await salesSeries(s.owner, { ...period, groupBy: "day" });
    expect(byDay.map((row) => [row.key, row.metrics.grossRevenueCents, row.metrics.saleCount, row.metrics.cancelledCents, row.metrics.returnedCents])).toEqual([
      [D1, 7050, 4, 0, 0],
      [today, 1000, 0, 1000, 1950],
    ]);
    const byStore = new Map((await salesSeries(s.owner, { ...period, groupBy: "store" })).map((row) => [row.key, row.metrics]));
    expect(byStore.get(s.storeA)).toMatchObject({ grossRevenueCents: 4050, discountCents: 100, cancelledCents: 1000, returnedCents: 950, saleCount: 2 });
    expect(byStore.get(s.storeB)).toMatchObject({ grossRevenueCents: 3000, returnedCents: 1000, saleCount: 1 });
    const bySeller = await salesSeries(s.owner, { ...period, groupBy: "salesperson" });
    expect(bySeller.find((row) => row.key === s.seller.userId)?.metrics).toMatchObject({ grossRevenueCents: 2000, discountCents: 100, returnedCents: 950, netRevenueCents: 950 });
    expect(bySeller.find((row) => row.key === "none")?.label).toBe("Sem vendedor");

    const net = await salesDrillDown(s.owner, { ...period, metric: "netRevenueCents" });
    expect(net.total).toBe(4);
    expect(net.rows.reduce((sum, row) => sum + row.contribution, 0)).toBe(5000);
    const count = await salesDrillDown(s.owner, { ...period, metric: "saleCount" });
    expect(count.rows.reduce((sum, row) => sum + row.contribution, 0)).toBe(4);

    // Only D1: the 23:30 sales stay on D1 in their store time zone.
    expect(await salesSummary(s.owner, { from: D1, to: D1 })).toMatchObject({ grossRevenueCents: 7050, saleCount: 4 });
    expect(await salesSummary(s.owner, { from: next, to: next })).toMatchObject({ grossRevenueCents: 0, saleCount: 0 });

    const scoped = await addMemberFixture(s.organizationId, { roleKey: "store_manager", storeIds: [s.storeA] });
    expect(await salesSummary(scoped.context, period)).toMatchObject({ grossRevenueCents: 4050, saleCount: 2 });
    const other = await createOrganizationFixture();
    expect(await salesSummary(other.owner, period)).toMatchObject({ grossRevenueCents: 0, saleCount: 0, netRevenueCents: 0 });
  });

  it("shows members without sales.read only their own sales and validates the period", async () => {
    const s = await setup();
    const cashier = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeA] });
    await openCashSessionFixture(s.organizationId, s.storeA, cashier.userId, 0);
    await completeSale(cashier.context, {
      completionKey: randomUUID(),
      storeId: s.storeA,
      items: [{ variantId: s.variantId, quantity: "1", expectedUnitPriceCents: 1000 }],
      payments: [{ method: "cash", amountCents: 1000, tenderedCents: 1000 }],
    });
    await sell(s, s.storeA, 2);
    const period = { from: today, to: today };
    expect(await salesSummary(cashier.context, period)).toMatchObject({ grossRevenueCents: 1000, saleCount: 1 });
    expect(await salesSummary(s.manager.context, period)).toMatchObject({ grossRevenueCents: 3000, saleCount: 2 });
    await expect(salesSummary(s.owner, { from: today, to: shift(today, -1) })).rejects.toMatchObject({ code: "invalid" });
    await expect(salesSummary(s.owner, { from: shift(today, -366), to: today })).rejects.toMatchObject({ code: "invalid" });
  });
});
