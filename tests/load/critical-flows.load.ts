import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inventoryBalances, sales } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordMovement } from "@/server/inventory/service";
import { salesSummary } from "@/server/metrics/sales";
import { callNext, registerArrival, setPresence } from "@/server/queue/service";
import { completeSale } from "@/server/sales/complete";
import { saveSalesperson } from "@/server/salespeople/service";
import { todayIn } from "@/server/targets/schemas";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "../integration/fixtures";

// Load of the critical flows (m42): correctness under concurrency first, then the
// measured latency (p50/p95) and throughput, printed for docs/quality.md.

function stats(label: string, durations: number[], wallMs: number) {
  const sorted = [...durations].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const line = { label, operations: durations.length, p50Ms: pick(0.5), p95Ms: pick(0.95), maxMs: sorted.at(-1), perSecond: Math.round((durations.length / wallMs) * 1000 * 10) / 10 };
  process.stdout.write(`LOAD ${JSON.stringify(line)}\n`);
  return line;
}

async function timed<T>(work: () => Promise<T>, durations: number[]) {
  const started = performance.now();
  try {
    return await work();
  } finally {
    durations.push(performance.now() - started);
  }
}

describe("critical flows under load", () => {
  it("PDV: 120 concurrent sales of 8 cashiers for 100 units sell exactly 100, numbered without gaps", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const { variantId } = await createVariantFixture(organizationId);
    await setPriceFixture(organizationId, variantId, 1000);
    await recordMovement(owner, { storeId, variantId, type: "entry", quantity: "100", reason: "Carga" });
    const cashiers: Awaited<ReturnType<typeof addMemberFixture>>["context"][] = [];
    for (let index = 0; index < 8; index += 1) {
      const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeId] });
      await openCashSessionFixture(organizationId, storeId, cashier.userId, 0);
      cashiers.push(cashier.context);
    }
    const durations: number[] = [];
    const started = performance.now();
    const results = await Promise.allSettled(
      Array.from({ length: 120 }, (_, index) =>
        timed(
          () =>
            completeSale(cashiers[index % cashiers.length], {
              completionKey: randomUUID(),
              storeId,
              items: [{ variantId, quantity: "1", expectedUnitPriceCents: 1000 }],
              payments: [{ method: "cash", amountCents: 1000, tenderedCents: 1000 }],
            }),
          durations,
        ),
      ),
    );
    const report = stats("pdv.completeSale", durations, performance.now() - started);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(100);
    const numbers = await withScope({ organizationId }, (tx) => tx.select({ number: sales.number }).from(sales).where(and(eq(sales.storeId, storeId), eq(sales.status, "completed"))));
    expect(numbers.map((row) => row.number).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    const [balance] = await withScope({ organizationId }, (tx) => tx.select({ quantity: inventoryBalances.quantity }).from(inventoryBalances).where(and(eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.variantId, variantId))));
    expect(balance.quantity).toBe("0.000");
    expect(report.p95Ms).toBeLessThan(30_000);

    // Metrics over the data just written.
    const day = todayIn("America/Sao_Paulo");
    const metricDurations: number[] = [];
    const metricsStarted = performance.now();
    for (let index = 0; index < 20; index += 1) await timed(() => salesSummary(owner, { from: day, to: day }), metricDurations);
    stats("metrics.salesSummary", metricDurations, performance.now() - metricsStarted);
    expect((await salesSummary(owner, { from: day, to: day })).netRevenueCents).toBe(100_000);
  });

  it("Queue: 60 arrivals and concurrent calls never repeat a customer or a salesperson", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const reception = (await addMemberFixture(organizationId, { roleKey: "reception", storeIds: [storeId] })).context;
    for (let index = 0; index < 10; index += 1) {
      const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] });
      const { id } = await saveSalesperson(owner, { membershipId: seller.membershipId, code: `L${index}`, nickname: `L${index}`, storeIds: [storeId] });
      await setPresence(owner, { storeId, salespersonId: id, status: "available" });
    }
    const arrivals: number[] = [];
    const started = performance.now();
    await Promise.all(Array.from({ length: 60 }, () => timed(() => registerArrival(reception, { storeId, requestKey: randomUUID() }), arrivals)));
    stats("queue.registerArrival", arrivals, performance.now() - started);
    const calls: number[] = [];
    const callStarted = performance.now();
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => timed(() => callNext(reception, { storeId }), calls)));
    stats("queue.callNext", calls, performance.now() - callStarted);
    const served = results.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []));
    // Ten salespeople available: ten customers called, each once, each salesperson once.
    expect(served).toHaveLength(10);
    expect(new Set(served.map((call) => call.entryId)).size).toBe(10);
    expect(new Set(served.map((call) => call.salespersonId)).size).toBe(10);
  });
});
