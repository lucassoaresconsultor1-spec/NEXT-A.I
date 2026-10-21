import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inventoryBalances, inventoryReservations, sales } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordMovement } from "@/server/inventory/service";
import { completeSale } from "@/server/sales/complete";
import { discardSuspendedSale, getSuspendedSale, listSuspendedSales, suspendSale } from "@/server/sales/suspend";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const { variantId } = await createVariantFixture(org.organizationId);
  await setPriceFixture(org.organizationId, variantId, 1000);
  await recordMovement(org.owner, { storeId, variantId, type: "entry", quantity: "5", reason: "Estoque inicial" });
  const first = await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [storeId] });
  const second = await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [storeId] });
  await openCashSessionFixture(org.organizationId, storeId, first.userId);
  await openCashSessionFixture(org.organizationId, storeId, second.userId);
  return { ...org, storeId, variantId, first: first.context, second: second.context };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function balance(s: Setup) {
  const [row] = await withScope({ organizationId: s.organizationId }, (tx) =>
    tx
      .select({ quantity: inventoryBalances.quantity, reserved: inventoryBalances.reserved })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.organizationId, s.organizationId), eq(inventoryBalances.storeId, s.storeId), eq(inventoryBalances.variantId, s.variantId))),
  );
  return row;
}

const items = (s: Setup, quantity = "3") => [{ variantId: s.variantId, quantity }];
const completion = (s: Setup, values: Record<string, unknown>) => ({
  completionKey: randomUUID(),
  storeId: s.storeId,
  items: [{ variantId: s.variantId, quantity: "3", expectedUnitPriceCents: 1000 }],
  payments: [{ method: "cash", amountCents: 3000, tenderedCents: 3000 }],
  ...values,
});

describe("suspended sales", () => {
  it("reserves the items, lets another operator of the store resume it and consumes the reservation once", async () => {
    const s = await setup();
    const { saleId } = await suspendSale(s.first, { storeId: s.storeId, items: items(s), note: "Cliente foi ao carro" });
    expect(await balance(s)).toEqual({ quantity: "5.000", reserved: "3.000" });

    const listed = await listSuspendedSales(s.second, s.storeId);
    expect(listed).toEqual([expect.objectContaining({ id: saleId, itemCount: 1, estimatedTotalCents: 3000, note: "Cliente foi ao carro" })]);
    expect(await getSuspendedSale(s.second, saleId)).toMatchObject({ items: [expect.objectContaining({ variantId: s.variantId, quantity: "3.000", currentUnitPriceCents: 1000 })] });

    // The reserved units cannot be sold by a regular sale meanwhile.
    await expect(completeSale(s.second, completion(s, { items: [{ variantId: s.variantId, quantity: "3", expectedUnitPriceCents: 1000 }] }))).rejects.toMatchObject({
      fieldErrors: { "items.0.quantity": expect.any(Array) },
    });

    const done = await completeSale(s.second, completion(s, { suspendedSaleId: saleId }));
    expect(done).toMatchObject({ saleId, number: 1, replayed: false });
    expect(await balance(s)).toEqual({ quantity: "2.000", reserved: "0.000" });
    const reservations = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ status: inventoryReservations.status }).from(inventoryReservations).where(eq(inventoryReservations.sourceId, saleId)),
    );
    expect(reservations).toEqual([{ status: "consumed" }]);
    expect(await listSuspendedSales(s.first, s.storeId)).toEqual([]);
    await expect(completeSale(s.first, completion(s, { suspendedSaleId: saleId }))).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses resuming with different items and keeps the reservation", async () => {
    const s = await setup();
    const { saleId } = await suspendSale(s.first, { storeId: s.storeId, items: items(s) });
    await expect(
      completeSale(s.first, completion(s, { suspendedSaleId: saleId, items: [{ variantId: s.variantId, quantity: "2", expectedUnitPriceCents: 1000 }], payments: [{ method: "cash", amountCents: 2000, tenderedCents: 2000 }] })),
    ).rejects.toMatchObject({ code: "invalid" });
    expect((await balance(s)).reserved).toBe("3.000");
  });

  it("returns the same suspension for a repeated key, sequentially and concurrently", async () => {
    const s = await setup();
    const suspensionKey = randomUUID();
    const first = await suspendSale(s.first, { suspensionKey, storeId: s.storeId, items: items(s, "2") });
    expect(await suspendSale(s.first, { suspensionKey, storeId: s.storeId, items: items(s, "2") })).toEqual(first);
    const parallelKey = randomUUID();
    const results = await Promise.all([0, 1].map(() => suspendSale(s.first, { suspensionKey: parallelKey, storeId: s.storeId, items: items(s, "1") })));
    expect(results[0]).toEqual(results[1]);
    expect(await balance(s)).toEqual({ quantity: "5.000", reserved: "3.000" });
    expect(await listSuspendedSales(s.first, s.storeId)).toHaveLength(2);
  });

  it("releases the reservation when discarded, with a reason", async () => {
    const s = await setup();
    const { saleId } = await suspendSale(s.first, { storeId: s.storeId, items: items(s) });
    await expect(discardSuspendedSale(s.second, saleId, { reason: "x" })).rejects.toMatchObject({ code: "invalid" });
    await discardSuspendedSale(s.second, saleId, { reason: "Cliente desistiu" });
    expect(await balance(s)).toEqual({ quantity: "5.000", reserved: "0.000" });
    const [row] = await withScope({ organizationId: s.organizationId }, (tx) => tx.select({ status: sales.status, reason: sales.discardReason }).from(sales).where(eq(sales.id, saleId)));
    expect(row).toEqual({ status: "discarded", reason: "Cliente desistiu" });
    await expect(discardSuspendedSale(s.second, saleId, { reason: "De novo" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses suspending more than the available stock and hides suspensions from other stores", async () => {
    const s = await setup();
    await expect(suspendSale(s.first, { storeId: s.storeId, items: items(s, "6") })).rejects.toMatchObject({ fieldErrors: { "items.0.quantity": expect.any(Array) } });
    expect((await balance(s)).reserved).toBe("0.000");

    const { saleId } = await suspendSale(s.first, { storeId: s.storeId, items: items(s, "1") });
    const otherStore = await createStoreFixture(s.organizationId);
    const outsider = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [otherStore] });
    expect(await listSuspendedSales(outsider.context, s.storeId)).toEqual([]);
    expect(await getSuspendedSale(outsider.context, saleId)).toBeNull();
    await expect(discardSuspendedSale(outsider.context, saleId, { reason: "Sem acesso" })).rejects.toMatchObject({ code: "not_found" });
    const other = await createOrganizationFixture();
    expect(await getSuspendedSale(other.owner, saleId)).toBeNull();
  });
});
