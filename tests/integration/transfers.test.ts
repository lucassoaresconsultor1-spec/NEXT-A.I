import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, inventoryBalances, inventoryMovements, stockTransfers } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { balanceFiltersSchema } from "@/server/inventory/schemas";
import { listBalances, recordMovement } from "@/server/inventory/service";
import { getTransfer, listTransfers } from "@/server/inventory/transfer-queries";
import { transferFiltersSchema } from "@/server/inventory/transfer-schemas";
import { approveTransfer, cancelTransfer, dispatchTransfer, receiveTransfer, requestTransfer } from "@/server/inventory/transfers";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture } from "./fixtures";

async function setup(stock = "10") {
  const org = await createOrganizationFixture();
  const storeA = await createStoreFixture(org.organizationId, { name: "Loja A" });
  const storeB = await createStoreFixture(org.organizationId, { name: "Loja B" });
  const storeC = await createStoreFixture(org.organizationId, { name: "Loja C" });
  const { variantId } = await createVariantFixture(org.organizationId);
  await recordMovement(org.owner, { storeId: storeA, variantId, type: "entry", quantity: stock, reason: "Estoque inicial" });
  const managerA = (await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeA] })).context;
  const managerB = (await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeB] })).context;
  return { ...org, storeA, storeB, storeC, variantId, managerA, managerB };
}

async function balanceOf(organizationId: string, storeId: string, variantId: string) {
  const [row] = await withScope({ organizationId }, (tx) =>
    tx
      .select({ quantity: inventoryBalances.quantity, reserved: inventoryBalances.reserved, inTransit: inventoryBalances.inTransit })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.organizationId, organizationId), eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.variantId, variantId))),
  );
  return row ?? { quantity: "0.000", reserved: "0.000", inTransit: "0.000" };
}

const request = (s: Awaited<ReturnType<typeof setup>>, quantity = "4") =>
  requestTransfer(s.managerB, { originStoreId: s.storeA, destinationStoreId: s.storeB, items: [{ variantId: s.variantId, quantity }] });

async function itemId(s: Awaited<ReturnType<typeof setup>>, transferId: string) {
  return (await getTransfer(s.owner, transferId))!.items[0].id;
}

describe("stock transfers: lifecycle", () => {
  it("reserves on approval, moves stock to transit on dispatch and into the destination on receipt", async () => {
    const s = await setup();
    const { id, number } = await request(s);
    expect(number).toBe(1);
    await approveTransfer(s.managerA, id);
    expect(await balanceOf(s.organizationId, s.storeA, s.variantId)).toEqual({ quantity: "10.000", reserved: "4.000", inTransit: "0.000" });
    const [row] = (await listBalances(s.owner, balanceFiltersSchema.parse({ storeId: s.storeA }))).rows;
    expect(row).toMatchObject({ reserved: "4.000", available: "6.000", inTransit: "0.000" });

    await dispatchTransfer(s.managerA, id, {});
    expect(await balanceOf(s.organizationId, s.storeA, s.variantId)).toEqual({ quantity: "6.000", reserved: "0.000", inTransit: "0.000" });
    expect(await balanceOf(s.organizationId, s.storeB, s.variantId)).toMatchObject({ quantity: "0.000", inTransit: "4.000" });

    await receiveTransfer(s.managerB, id, {});
    expect(await balanceOf(s.organizationId, s.storeB, s.variantId)).toEqual({ quantity: "4.000", reserved: "0.000", inTransit: "0.000" });
    const detail = await getTransfer(s.owner, id);
    expect(detail).toMatchObject({ status: "received", requestedByName: expect.any(String) });
    expect(detail?.items[0]).toMatchObject({ quantityRequested: "4.000", quantitySent: "4.000", quantityReceived: "4.000", divergenceReason: null });

    const movements = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx
        .select({ storeId: inventoryMovements.storeId, type: inventoryMovements.type, reason: inventoryMovements.reason })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.organizationId, s.organizationId))
        .orderBy(asc(inventoryMovements.createdAt)),
    );
    expect(movements.slice(1)).toEqual([
      { storeId: s.storeA, type: "exit", reason: "Transferência nº 1 para Loja B" },
      { storeId: s.storeB, type: "entry", reason: "Transferência nº 1 de Loja A" },
    ]);
    const trail = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, s.organizationId), eq(auditLogs.entityId, id))).orderBy(asc(auditLogs.createdAt)),
    );
    expect(trail.map((entry) => entry.action)).toEqual([
      "stock_transfer.requested",
      "stock_transfer.approved",
      "stock_transfer.dispatched",
      "stock_transfer.received",
    ]);
  });

  it("frees the unsent part of the reservation and records a divergence on receipt", async () => {
    const s = await setup();
    const { id } = await request(s);
    await approveTransfer(s.managerA, id);
    const item = await itemId(s, id);
    await dispatchTransfer(s.managerA, id, { items: [{ itemId: item, quantitySent: "3" }] });
    expect(await balanceOf(s.organizationId, s.storeA, s.variantId)).toEqual({ quantity: "7.000", reserved: "0.000", inTransit: "0.000" });
    expect((await balanceOf(s.organizationId, s.storeB, s.variantId)).inTransit).toBe("3.000");

    await expect(receiveTransfer(s.managerB, id, { items: [{ itemId: item, quantityReceived: "2" }] })).rejects.toMatchObject({
      fieldErrors: { divergenceReason: expect.any(Array) },
    });
    await expect(receiveTransfer(s.managerB, id, { items: [{ itemId: item, quantityReceived: "4" }] })).rejects.toMatchObject({
      fieldErrors: { "items.0.quantityReceived": expect.any(Array) },
    });
    await receiveTransfer(s.managerB, id, { items: [{ itemId: item, quantityReceived: "2" }], divergenceReason: "Uma unidade avariada no transporte" });
    expect(await balanceOf(s.organizationId, s.storeB, s.variantId)).toEqual({ quantity: "2.000", reserved: "0.000", inTransit: "0.000" });
    expect((await getTransfer(s.owner, id))?.items[0]).toMatchObject({ quantitySent: "3.000", quantityReceived: "2.000", divergenceReason: "Uma unidade avariada no transporte" });
  });

  it("refuses approval without available stock and protects reserved stock from manual exits", async () => {
    const s = await setup("5");
    const { id: tooMuch } = await request(s, "6");
    await expect(approveTransfer(s.managerA, tooMuch)).rejects.toMatchObject({ fieldErrors: { "items.0.quantity": expect.any(Array) } });
    expect((await balanceOf(s.organizationId, s.storeA, s.variantId)).reserved).toBe("0.000");

    const { id } = await request(s, "4");
    await approveTransfer(s.managerA, id);
    await expect(recordMovement(s.managerA, { storeId: s.storeA, variantId: s.variantId, type: "exit", quantity: "2", reason: "Saída manual" })).rejects.toMatchObject({
      fieldErrors: { quantity: expect.any(Array) },
    });
    await expect(recordMovement(s.managerA, { storeId: s.storeA, variantId: s.variantId, type: "count", quantity: "3", reason: "Inventário" })).rejects.toMatchObject({
      fieldErrors: { quantity: expect.any(Array) },
    });
    await recordMovement(s.managerA, { storeId: s.storeA, variantId: s.variantId, type: "exit", quantity: "1", reason: "Saída manual" });
    expect(await balanceOf(s.organizationId, s.storeA, s.variantId)).toMatchObject({ quantity: "4.000", reserved: "4.000" });
  });

  it("cancels requested and approved transfers, releasing reservations, but not transfers in transit", async () => {
    const s = await setup();
    const { id: requested } = await request(s);
    await cancelTransfer(s.managerB, requested, "Pedido duplicado");
    expect((await getTransfer(s.owner, requested))?.status).toBe("cancelled");

    const { id } = await request(s);
    await approveTransfer(s.managerA, id);
    await expect(cancelTransfer(s.managerB, id, "Não precisa mais")).rejects.toMatchObject({ code: "forbidden" });
    await cancelTransfer(s.managerA, id, "Não precisa mais");
    expect((await balanceOf(s.organizationId, s.storeA, s.variantId)).reserved).toBe("0.000");

    const { id: moving } = await request(s);
    await approveTransfer(s.managerA, moving);
    await dispatchTransfer(s.managerA, moving, {});
    await expect(cancelTransfer(s.managerA, moving, "Tarde demais")).rejects.toMatchObject({ code: "invalid" });
    await expect(dispatchTransfer(s.managerA, moving, {})).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("stock transfers: concurrency, scope and isolation", () => {
  it("lets only one of two competing approvals reserve the stock", async () => {
    const s = await setup("5");
    const first = await request(s, "4");
    const second = await request(s, "4");
    const results = await Promise.allSettled([approveTransfer(s.managerA, first.id), approveTransfer(s.managerA, second.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await balanceOf(s.organizationId, s.storeA, s.variantId)).reserved).toBe("4.000");
  });

  it("dispatches a transfer only once under concurrent calls", async () => {
    const s = await setup();
    const { id } = await request(s);
    await approveTransfer(s.managerA, id);
    const results = await Promise.allSettled([dispatchTransfer(s.managerA, id, {}), dispatchTransfer(s.managerA, id, {})]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await balanceOf(s.organizationId, s.storeA, s.variantId)).toMatchObject({ quantity: "6.000", reserved: "0.000" });
    expect((await balanceOf(s.organizationId, s.storeB, s.variantId)).inTransit).toBe("4.000");
  });

  it("checks the side of each step and hides transfers outside the scope", async () => {
    const s = await setup();
    const { id } = await request(s);
    await expect(approveTransfer(s.managerB, id)).rejects.toMatchObject({ code: "forbidden" });
    await approveTransfer(s.managerA, id);
    await expect(dispatchTransfer(s.managerB, id, {})).rejects.toMatchObject({ code: "forbidden" });
    await dispatchTransfer(s.managerA, id, {});
    await expect(receiveTransfer(s.managerA, id, {})).rejects.toMatchObject({ code: "forbidden" });

    const managerC = (await addMemberFixture(s.organizationId, { roleKey: "store_manager", storeIds: [s.storeC] })).context;
    expect(await getTransfer(managerC, id)).toBeNull();
    expect((await listTransfers(managerC, transferFiltersSchema.parse({}))).rows).toHaveLength(0);
    await expect(receiveTransfer(managerC, id, {})).rejects.toMatchObject({ code: "not_found" });
    await expect(requestTransfer(s.managerA, { originStoreId: s.storeC, destinationStoreId: s.storeB, items: [{ variantId: s.variantId, quantity: "1" }] })).rejects.toMatchObject({
      code: "not_found",
    });

    const other = await createOrganizationFixture();
    expect(await getTransfer(other.owner, id)).toBeNull();
    const seen = await withScope({ organizationId: other.organizationId }, (tx) => tx.select({ id: stockTransfers.id }).from(stockTransfers));
    expect(seen).toHaveLength(0);
  });

  it("validates requests", async () => {
    const s = await setup();
    await expect(requestTransfer(s.managerB, { originStoreId: s.storeB, destinationStoreId: s.storeB, items: [{ variantId: s.variantId, quantity: "1" }] })).rejects.toMatchObject({
      fieldErrors: { destinationStoreId: expect.any(Array) },
    });
    await expect(requestTransfer(s.managerB, { originStoreId: s.storeA, destinationStoreId: s.storeB, items: [{ variantId: s.variantId, quantity: "1,5" }] })).rejects.toMatchObject({
      fieldErrors: { "items.0.quantity": expect.any(Array) },
    });
    const seller = (await addMemberFixture(s.organizationId, { roleKey: "salesperson", storeIds: [s.storeB] })).context;
    await expect(requestTransfer(seller, { originStoreId: s.storeA, destinationStoreId: s.storeB, items: [{ variantId: s.variantId, quantity: "1" }] })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
