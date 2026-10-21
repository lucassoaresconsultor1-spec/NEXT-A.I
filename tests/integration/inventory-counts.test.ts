import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories, inventoryBalances, inventoryMovements, products } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { approveCount, cancelCount, getCount, listCounts, openCount, recordCountedQuantities } from "@/server/inventory/counts";
import { reserveStock } from "@/server/inventory/reservations";
import { recordMovement } from "@/server/inventory/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture } from "./fixtures";

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeId] });
  const supervisor = await addMemberFixture(org.organizationId, { roleKey: "supervisor", storeIds: [storeId] });
  return { ...org, storeId, manager: manager.context, supervisor: supervisor.context };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function variant(s: Setup, stock: string | null, values: Parameters<typeof createVariantFixture>[1] = {}) {
  const created = await createVariantFixture(s.organizationId, values);
  if (stock) await recordMovement(s.owner, { storeId: s.storeId, variantId: created.variantId, type: "entry", quantity: stock, reason: "Estoque inicial" });
  return created;
}

async function balance(s: Setup, variantId: string) {
  const [row] = await withScope({ organizationId: s.organizationId }, (tx) =>
    tx.select({ quantity: inventoryBalances.quantity }).from(inventoryBalances).where(and(eq(inventoryBalances.storeId, s.storeId), eq(inventoryBalances.variantId, variantId))),
  );
  return row?.quantity ?? "0.000";
}

async function itemIds(s: Setup, countId: string) {
  const detail = await getCount(s.manager, countId);
  return new Map(detail!.items.map((item) => [item.variantId, item.id]));
}

describe("inventory counts", () => {
  it("counts a category blind, flags movements during the count and adjusts only divergent items against the current balance", async () => {
    const s = await setup();
    const [category] = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.insert(categories).values({ organizationId: s.organizationId, name: `Cat ${randomUUID().slice(0, 8)}` }).returning({ id: categories.id }),
    );
    const a = await variant(s, "10");
    const b = await variant(s, null);
    const d = await variant(s, "3");
    const outside = await variant(s, "5");
    await withScope({ organizationId: s.organizationId }, async (tx) => {
      for (const item of [a, b, d]) await tx.update(products).set({ categoryId: category.id }).where(eq(products.id, item.productId));
    });

    const opened = await openCount(s.manager, { storeId: s.storeId, categoryId: category.id });
    const ids = await itemIds(s, opened.id);
    expect([...ids.keys()].sort()).toEqual([a.variantId, b.variantId, d.variantId].sort());
    expect(ids.has(outside.variantId)).toBe(false);

    const blind = await getCount(s.supervisor, opened.id, { blind: false });
    expect(blind?.blind).toBe(true);
    expect(blind?.items[0]).not.toHaveProperty("expectedQuantity");
    expect(blind?.items[0]).not.toHaveProperty("currentQuantity");

    await recordCountedQuantities(s.supervisor, opened.id, { items: [{ itemId: ids.get(a.variantId)!, countedQuantity: "7" }] });
    // The last record wins.
    await recordCountedQuantities(s.supervisor, opened.id, {
      items: [
        { itemId: ids.get(a.variantId)!, countedQuantity: "8" },
        { itemId: ids.get(b.variantId)!, countedQuantity: "2" },
        { itemId: ids.get(d.variantId)!, countedQuantity: "3" },
      ],
    });
    await recordMovement(s.owner, { storeId: s.storeId, variantId: a.variantId, type: "entry", quantity: "5", reason: "Chegou durante a contagem" });

    const review = await getCount(s.manager, opened.id);
    const reviewA = review!.items.find((item) => item.variantId === a.variantId) as Record<string, unknown>;
    expect(reviewA).toMatchObject({ expectedQuantity: "10.000", currentQuantity: "15.000", countedQuantity: "8.000", difference: "-7.000", movedDuringCount: true });
    expect(review!.items.find((item) => item.variantId === d.variantId)).toMatchObject({ movedDuringCount: false, difference: "0.000" });

    await expect(approveCount(s.supervisor, opened.id, { reason: "Contagem mensal" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await approveCount(s.manager, opened.id, { reason: "Contagem mensal" })).toEqual({ adjusted: 2 });
    expect([await balance(s, a.variantId), await balance(s, b.variantId), await balance(s, d.variantId)]).toEqual(["8.000", "2.000", "3.000"]);
    const counts = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ variantId: inventoryMovements.variantId }).from(inventoryMovements).where(and(eq(inventoryMovements.storeId, s.storeId), eq(inventoryMovements.type, "count"))),
    );
    expect(counts.map((row) => row.variantId).sort()).toEqual([a.variantId, b.variantId].sort());
    const approved = await getCount(s.manager, opened.id);
    expect(approved!.items.find((item) => item.variantId === a.variantId)).toMatchObject({ adjustment: "-7.000", movedDuringCount: true, currentQuantity: null });
    await expect(recordCountedQuantities(s.supervisor, opened.id, { items: [{ itemId: ids.get(a.variantId)!, countedQuantity: "1" }] })).rejects.toMatchObject({ code: "invalid" });
  });

  it("keeps one open count per store, also under concurrency, and lets a cancelled count be replaced", async () => {
    const s = await setup();
    await variant(s, "1");
    const results = await Promise.allSettled([0, 1].map(() => openCount(s.manager, { storeId: s.storeId })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
    const open = (await listCounts(s.manager, { page: 1 })).rows[0];
    expect(open).toMatchObject({ status: "open", itemCount: 1, countedCount: 0 });
    await expect(cancelCount(s.supervisor, open.id, { reason: "Erro" })).rejects.toMatchObject({ code: "forbidden" });
    await cancelCount(s.manager, open.id, { reason: "Aberto por engano" });
    await expect(approveCount(s.manager, open.id, { reason: "Tarde" })).rejects.toMatchObject({ code: "invalid" });
    await expect(openCount(s.manager, { storeId: s.storeId })).resolves.toMatchObject({ number: 2 });
  });

  it("includes inactive items that still have stock and refuses whole-unit violations and counts below the reserved stock", async () => {
    const s = await setup();
    const reservedItem = await variant(s, "10");
    const inactive = await variant(s, "2");
    const inactiveEmpty = await variant(s, null, { variantActive: false });
    const weighed = await variant(s, "1", { unit: "kg" });
    await withScope({ organizationId: s.organizationId }, async (tx) => {
      await tx.update(products).set({ isActive: false }).where(eq(products.id, inactive.productId));
      await reserveStock(tx, s.organizationId, { storeId: s.storeId, variantId: reservedItem.variantId, quantityMilli: BigInt(4000), source: "transfer", sourceId: randomUUID(), actorUserId: s.owner.user.id });
    });
    const opened = await openCount(s.manager, { storeId: s.storeId });
    const ids = await itemIds(s, opened.id);
    expect(ids.has(inactive.variantId)).toBe(true);
    expect(ids.has(inactiveEmpty.variantId)).toBe(false);

    await expect(recordCountedQuantities(s.manager, opened.id, { items: [{ itemId: ids.get(reservedItem.variantId)!, countedQuantity: "1,5" }] })).rejects.toMatchObject({
      fieldErrors: { "items.0.countedQuantity": expect.any(Array) },
    });
    await expect(recordCountedQuantities(s.manager, opened.id, { items: [{ itemId: randomUUID(), countedQuantity: "1" }] })).rejects.toMatchObject({
      fieldErrors: { "items.0.itemId": expect.any(Array) },
    });
    await recordCountedQuantities(s.manager, opened.id, {
      items: [
        { itemId: ids.get(reservedItem.variantId)!, countedQuantity: "3" },
        { itemId: ids.get(weighed.variantId)!, countedQuantity: "0,75" },
        { itemId: ids.get(inactive.variantId)!, countedQuantity: "0" },
      ],
    });
    await expect(approveCount(s.manager, opened.id, { reason: "Mensal" })).rejects.toMatchObject({ code: "invalid" });
    expect(await balance(s, weighed.variantId)).toBe("1.000");
    expect((await getCount(s.manager, opened.id))?.status).toBe("open");

    await recordCountedQuantities(s.manager, opened.id, { items: [{ itemId: ids.get(reservedItem.variantId)!, countedQuantity: "4" }] });
    expect(await approveCount(s.manager, opened.id, { reason: "Mensal" })).toEqual({ adjusted: 3 });
    expect([await balance(s, reservedItem.variantId), await balance(s, weighed.variantId), await balance(s, inactive.variantId)]).toEqual(["4.000", "0.750", "0.000"]);
  });

  it("respects permissions, store scope and organization isolation", async () => {
    const s = await setup();
    await variant(s, "1");
    const opened = await openCount(s.manager, { storeId: s.storeId });
    const ids = [...(await itemIds(s, opened.id)).values()];
    const otherStore = await createStoreFixture(s.organizationId);
    const outsider = await addMemberFixture(s.organizationId, { roleKey: "store_manager", storeIds: [otherStore] });
    expect(await getCount(outsider.context, opened.id)).toBeNull();
    await expect(recordCountedQuantities(outsider.context, opened.id, { items: [{ itemId: ids[0], countedQuantity: "1" }] })).rejects.toMatchObject({ code: "not_found" });
    await expect(openCount(outsider.context, { storeId: s.storeId })).rejects.toMatchObject({ code: "not_found" });
    expect((await listCounts(outsider.context, { page: 1 })).rows).toEqual([]);
    const cashier = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeId] });
    // Cashiers read stock but do not count: they see the count blind and cannot record.
    expect((await getCount(cashier.context, opened.id))?.blind).toBe(true);
    await expect(recordCountedQuantities(cashier.context, opened.id, { items: [{ itemId: ids[0], countedQuantity: "1" }] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(openCount(s.supervisor, { storeId: otherStore })).rejects.toMatchObject({ code: "forbidden" });
    const other = await createOrganizationFixture();
    expect(await getCount(other.owner, opened.id)).toBeNull();
    await expect(approveCount(other.owner, opened.id, { reason: "Invasão" })).rejects.toMatchObject({ code: "not_found" });
  });
});
