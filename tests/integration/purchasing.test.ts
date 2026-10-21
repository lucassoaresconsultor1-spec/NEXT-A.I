import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLogs, inventoryBalances, inventoryMovements, organizations, plans, productCosts, purchaseOrderItems } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { setVariantCost } from "@/server/catalog/pricing";
import { receiveGoods } from "@/server/purchasing/receiving";
import { purchaseOrderFiltersSchema } from "@/server/purchasing/schemas";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  updatePurchaseOrder,
} from "@/server/purchasing/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createSupplierFixture, createVariantFixture, uniqueSuffix } from "./fixtures";

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const otherStoreId = await createStoreFixture(org.organizationId);
  const supplierId = await createSupplierFixture(org.organizationId);
  const a = await createVariantFixture(org.organizationId);
  const b = await createVariantFixture(org.organizationId, { unit: "kg" });
  const coordinator = await addMemberFixture(org.organizationId, { roleKey: "regional_manager" });
  const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeId] });
  return { ...org, storeId, otherStoreId, supplierId, a, b, coordinator: coordinator.context, manager: manager.context };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const orderInput = (s: Setup, items?: { variantId: string; quantity: string; unitCostCents: number }[]) => ({
  storeId: s.storeId,
  supplierId: s.supplierId,
  items: items ?? [
    { variantId: s.a.variantId, quantity: "10", unitCostCents: 1500 },
    { variantId: s.b.variantId, quantity: "2,5", unitCostCents: 4000 },
  ],
});

async function balance(organizationId: string, storeId: string, variantId: string) {
  const [row] = await withScope({ organizationId }, (tx) =>
    tx
      .select({ quantity: inventoryBalances.quantity })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.organizationId, organizationId), eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.variantId, variantId))),
  );
  return row?.quantity ?? null;
}

async function itemIds(s: Setup, orderId: string) {
  const order = await getPurchaseOrder(s.owner, orderId);
  const byVariant = new Map(order!.items.map((item) => [item.variantId, item.id]));
  return { a: byVariant.get(s.a.variantId)!, b: byVariant.get(s.b.variantId)! };
}

async function approvedOrder(s: Setup, items?: Parameters<typeof orderInput>[1]) {
  const { id } = await createPurchaseOrder(s.coordinator, orderInput(s, items));
  await approvePurchaseOrder(s.coordinator, id);
  return id;
}

describe("purchasing: order lifecycle and receipts", () => {
  it("numbers orders, receives in two steps, posts ledger entries and replacement costs", async () => {
    const s = await setup();
    const first = await createPurchaseOrder(s.coordinator, orderInput(s));
    const second = await createPurchaseOrder(s.coordinator, orderInput(s));
    expect([first.number, second.number]).toEqual([1, 2]);

    await updatePurchaseOrder(s.coordinator, first.id, orderInput(s, [{ variantId: s.a.variantId, quantity: "10", unitCostCents: 1500 }, { variantId: s.b.variantId, quantity: "2,5", unitCostCents: 4200 }]));
    await approvePurchaseOrder(s.coordinator, first.id);
    const ids = await itemIds(s, first.id);

    await receiveGoods(s.manager, first.id, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: "4" }] });
    expect((await getPurchaseOrder(s.owner, first.id))?.status).toBe("partially_received");
    expect(await balance(s.organizationId, s.storeId, s.a.variantId)).toBe("4.000");

    await receiveGoods(s.manager, first.id, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: "6" }, { orderItemId: ids.b, quantity: "2,5" }] });
    const detail = await getPurchaseOrder(s.owner, first.id);
    expect(detail?.status).toBe("received");
    expect(detail?.items.map((item) => [item.quantityReceived, item.quantityPending])).toEqual(
      expect.arrayContaining([["10.000", "0.000"], ["2.500", "0.000"]]),
    );
    expect(detail?.receipts).toHaveLength(2);
    expect(await balance(s.organizationId, s.storeId, s.b.variantId)).toBe("2.500");

    const movements = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ type: inventoryMovements.type, reason: inventoryMovements.reason }).from(inventoryMovements).where(eq(inventoryMovements.organizationId, s.organizationId)),
    );
    expect(movements).toHaveLength(3);
    expect(movements.every((movement) => movement.type === "entry" && movement.reason === `Recebimento do pedido de compra nº ${first.number}`)).toBe(true);

    const costs = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ variantId: productCosts.variantId, cents: productCosts.costCents }).from(productCosts).where(eq(productCosts.organizationId, s.organizationId)),
    );
    // One cost row per variant: the second receipt of "a" repeats the same cost and adds nothing.
    expect(costs).toEqual(expect.arrayContaining([{ variantId: s.a.variantId, cents: 1500 }, { variantId: s.b.variantId, cents: 4200 }]));
    expect(costs).toHaveLength(2);
    const costAudit = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ changes: auditLogs.changes }).from(auditLogs).where(and(eq(auditLogs.organizationId, s.organizationId), eq(auditLogs.action, "product_variant.cost_changed"))),
    );
    expect(costAudit.every((entry) => (entry.changes as { source?: string }).source === "purchase_receipt")).toBe(true);
    const receiptAudit = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, s.organizationId), eq(auditLogs.entityType, "goods_receipt")))
        .orderBy(asc(auditLogs.createdAt)),
    );
    expect(receiptAudit.map((entry) => entry.action)).toEqual(["goods_receipt.recorded", "goods_receipt.recorded"]);
  });

  it("returns the first receipt when the same key is sent again", async () => {
    const s = await setup();
    const orderId = await approvedOrder(s);
    const ids = await itemIds(s, orderId);
    const input = { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: "3" }] };
    const first = await receiveGoods(s.manager, orderId, input);
    const again = await receiveGoods(s.manager, orderId, input);
    expect(again).toEqual({ receiptId: first.receiptId, replayed: true });
    expect(await balance(s.organizationId, s.storeId, s.a.variantId)).toBe("3.000");
    const other = await approvedOrder(s);
    await expect(receiveGoods(s.manager, other, input)).rejects.toMatchObject({ code: "conflict" });
  });

  it("serializes concurrent receipts so the pending quantity is never exceeded", async () => {
    const s = await setup();
    const orderId = await approvedOrder(s);
    const ids = await itemIds(s, orderId);
    const results = await Promise.allSettled(
      [7, 6].map((quantity) => receiveGoods(s.manager, orderId, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: String(quantity) }] })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({ code: "invalid", fieldErrors: { "items.0.quantity": expect.any(Array) } });
    expect(["7.000", "6.000"]).toContain(await balance(s.organizationId, s.storeId, s.a.variantId));
  });

  it("refuses receipts above the pending quantity and on orders that do not accept them", async () => {
    const s = await setup();
    const { id: draft } = await createPurchaseOrder(s.coordinator, orderInput(s));
    const draftIds = await itemIds(s, draft);
    await expect(receiveGoods(s.manager, draft, { idempotencyKey: randomUUID(), items: [{ orderItemId: draftIds.a, quantity: "1" }] })).rejects.toMatchObject({ code: "invalid" });

    const orderId = await approvedOrder(s);
    const ids = await itemIds(s, orderId);
    await expect(receiveGoods(s.manager, orderId, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: "11" }] })).rejects.toMatchObject({
      fieldErrors: { "items.0.quantity": expect.any(Array) },
    });
    await expect(receiveGoods(s.manager, orderId, { idempotencyKey: randomUUID(), items: [{ orderItemId: draftIds.a, quantity: "1" }] })).rejects.toMatchObject({
      fieldErrors: { "items.0.orderItemId": expect.any(Array) },
    });
    await expect(receiveGoods(s.manager, orderId, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: "1,5" }] })).rejects.toMatchObject({ code: "invalid" });
  });

  it("cancels drafts and approved orders, and closes partially received ones with a reason", async () => {
    const s = await setup();
    const { id: draft } = await createPurchaseOrder(s.coordinator, orderInput(s));
    await cancelPurchaseOrder(s.coordinator, draft, "Fornecedor sem estoque");
    expect((await getPurchaseOrder(s.owner, draft))?.cancelReason).toBe("Fornecedor sem estoque");
    await expect(updatePurchaseOrder(s.coordinator, draft, orderInput(s))).rejects.toMatchObject({ code: "invalid" });

    const orderId = await approvedOrder(s);
    const ids = await itemIds(s, orderId);
    await receiveGoods(s.manager, orderId, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: "1" }] });
    await expect(cancelPurchaseOrder(s.coordinator, orderId, "Desistência")).rejects.toMatchObject({ code: "invalid" });
    await expect(closePurchaseOrder(s.coordinator, orderId, "x")).rejects.toMatchObject({ code: "invalid" });
    await closePurchaseOrder(s.coordinator, orderId, "Restante não será entregue");
    expect(await getPurchaseOrder(s.owner, orderId)).toMatchObject({ status: "received", closeReason: "Restante não será entregue" });
    await expect(receiveGoods(s.manager, orderId, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.b, quantity: "1" }] })).rejects.toMatchObject({ code: "invalid" });
  });

  it("validates references on create", async () => {
    const s = await setup();
    const inactiveSupplier = await createSupplierFixture(s.organizationId, { isActive: false });
    const inactive = await createVariantFixture(s.organizationId, { variantActive: false });
    await expect(createPurchaseOrder(s.coordinator, { ...orderInput(s), supplierId: inactiveSupplier })).rejects.toMatchObject({ fieldErrors: { supplierId: expect.any(Array) } });
    await expect(createPurchaseOrder(s.coordinator, orderInput(s, [{ variantId: inactive.variantId, quantity: "1", unitCostCents: 1 }]))).rejects.toMatchObject({
      fieldErrors: { "items.0.variantId": expect.any(Array) },
    });
  });
});

describe("purchasing: access, costs and isolation", () => {
  it("enforces permissions and hides costs from members without catalog.costs.read", async () => {
    const s = await setup();
    await expect(createPurchaseOrder(s.manager, orderInput(s))).rejects.toMatchObject({ code: "forbidden" });
    const { id } = await createPurchaseOrder(s.coordinator, orderInput(s));
    await expect(approvePurchaseOrder(s.manager, id)).rejects.toMatchObject({ code: "forbidden" });
    await approvePurchaseOrder(s.coordinator, id);
    const ids = await itemIds(s, id);
    await expect(receiveGoods(s.coordinator, id, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: "1" }] })).rejects.toMatchObject({ code: "forbidden" });

    const forManager = await getPurchaseOrder(s.manager, id);
    expect(forManager?.items.every((item) => !("unitCostCents" in item))).toBe(true);
    expect(forManager && "totalCents" in forManager).toBe(false);
    expect((await listPurchaseOrders(s.manager, purchaseOrderFiltersSchema.parse({}))).rows.every((row) => !("totalCents" in row))).toBe(true);

    const finance = await addMemberFixture(s.organizationId, { roleKey: "finance" });
    expect((await getPurchaseOrder(finance.context, id))?.totalCents).toBe(10 * 1500 + 2.5 * 4000);
    await expect(createPurchaseOrder(finance.context, orderInput(s))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("limits store-scoped members to their stores and isolates organizations", async () => {
    const s = await setup();
    const { id } = await createPurchaseOrder(s.coordinator, { ...orderInput(s), storeId: s.otherStoreId });
    expect(await getPurchaseOrder(s.manager, id)).toBeNull();
    expect((await listPurchaseOrders(s.manager, purchaseOrderFiltersSchema.parse({}))).rows.map((row) => row.id)).not.toContain(id);

    const other = await createOrganizationFixture();
    expect(await getPurchaseOrder(other.owner, id)).toBeNull();
    await expect(approvePurchaseOrder(other.owner, id)).rejects.toMatchObject({ code: "not_found" });
    const seen = await withScope({ organizationId: other.organizationId }, (tx) => tx.select({ id: purchaseOrderItems.id }).from(purchaseOrderItems));
    expect(seen).toHaveLength(0);
  });

  it("refuses receipts when the plan has no inventory feature", async () => {
    const s = await setup();
    const orderId = await approvedOrder(s);
    const ids = await itemIds(s, orderId);
    const planKey = `sem_estoque_${uniqueSuffix()}`;
    await getDb().insert(plans).values({ key: planKey, name: "Sem estoque", description: "Plano de teste sem recursos" });
    await withScope({ organizationId: s.organizationId }, (tx) => tx.update(organizations).set({ planKey }).where(eq(organizations.id, s.organizationId)));
    await expect(receiveGoods(s.manager, orderId, { idempotencyKey: randomUUID(), items: [{ orderItemId: ids.a, quantity: "1" }] })).rejects.toMatchObject({ code: "limit" });
  });

  it("keeps manual cost changes audited as manual", async () => {
    const s = await setup();
    await setVariantCost(s.owner, s.a.variantId, 999);
    const [entry] = await withScope({ organizationId: s.organizationId }, (tx) =>
      tx.select({ changes: auditLogs.changes }).from(auditLogs).where(and(eq(auditLogs.organizationId, s.organizationId), eq(auditLogs.action, "product_variant.cost_changed"))),
    );
    expect(entry.changes).toMatchObject({ source: "manual", costRecordId: expect.any(String) });
  });
});
