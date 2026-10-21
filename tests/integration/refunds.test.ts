import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { cashMovements, cashSessions, inventoryBalances, paymentIntents, rolePermissions, roles, saleRefundItems, saleRefunds, sales } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordMovement } from "@/server/inventory/service";
import { createPaymentIntent } from "@/server/payments/intents";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { handlePaymentWebhook } from "@/server/payments/webhook";
import { cancelSale } from "@/server/sales/cancel";
import { completeSale } from "@/server/sales/complete";
import { getSale } from "@/server/sales/queries";
import { refundSale } from "@/server/sales/refund";
import { createFakePaymentProvider, FAKE_PROVIDER_KEY, signFakeWebhook } from "../support/fake-payment-provider";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture, uniqueSuffix } from "./fixtures";

afterEach(() => setPaymentProviderForTests(undefined));

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const { variantId } = await createVariantFixture(org.organizationId);
  await setPriceFixture(org.organizationId, variantId, 1000);
  await recordMovement(org.owner, { storeId, variantId, type: "entry", quantity: "10", reason: "Estoque inicial" });
  const cashier = await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [storeId] });
  const manager = await addMemberFixture(org.organizationId, { roleKey: "store_manager", storeIds: [storeId] });
  const sessionId = await openCashSessionFixture(org.organizationId, storeId, cashier.userId, 5000);
  await openCashSessionFixture(org.organizationId, storeId, manager.userId, 5000);
  return { ...org, storeId, variantId, cashier: cashier.context, manager: manager.context, sessionId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function sell(s: Setup, quantity = "3", payments?: unknown[], saleDiscountCents = 0) {
  const total = Number(quantity) * 1000 - saleDiscountCents;
  // A sale discount needs the manager (the store ceiling is 0 % by default).
  return completeSale(saleDiscountCents > 0 ? s.manager : s.cashier, {
    completionKey: randomUUID(),
    storeId: s.storeId,
    items: [{ variantId: s.variantId, quantity, expectedUnitPriceCents: 1000 }],
    saleDiscountCents,
    payments: payments ?? [{ method: "cash", amountCents: total, tenderedCents: total }],
  });
}

async function quantity(s: Setup) {
  const [row] = await withScope({ organizationId: s.organizationId }, (tx) =>
    tx.select({ quantity: inventoryBalances.quantity }).from(inventoryBalances).where(and(eq(inventoryBalances.storeId, s.storeId), eq(inventoryBalances.variantId, s.variantId))),
  );
  return row.quantity;
}

async function cashRefunds(s: Setup, sessionId: string) {
  const rows = await withScope({ organizationId: s.organizationId }, (tx) =>
    tx.select({ amount: cashMovements.amountCents }).from(cashMovements).where(and(eq(cashMovements.sessionId, sessionId), eq(cashMovements.type, "refund"))),
  );
  return rows.map((row) => row.amount);
}

describe("sale cancellation", () => {
  it("reverses cash and stock while the cash session is open and marks the sale cancelled", async () => {
    const s = await setup();
    const sale = await sell(s);
    expect(await quantity(s)).toBe("7.000");
    const key = randomUUID();
    const result = await cancelSale(s.cashier, sale.saleId, { idempotencyKey: key, reason: "Cliente desistiu" });
    expect(await cancelSale(s.cashier, sale.saleId, { idempotencyKey: key, reason: "Cliente desistiu" })).toEqual({ ...result, replayed: true });
    expect(await quantity(s)).toBe("10.000");
    expect(await cashRefunds(s, s.sessionId)).toEqual([3000]);
    const [row] = await withScope({ organizationId: s.organizationId }, (tx) => tx.select({ status: sales.status }).from(sales).where(eq(sales.id, sale.saleId)));
    expect(row.status).toBe("cancelled");
    await expect(cancelSale(s.manager, sale.saleId, { idempotencyKey: randomUUID(), reason: "De novo" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("requires the open session of the sale, the card reversal NSU and the operator's own sale", async () => {
    const s = await setup();
    const card = await sell(s, "1", [{ method: "card_external", amountCents: 1000, nsu: "VENDA123" }]);
    await expect(cancelSale(s.cashier, card.saleId, { idempotencyKey: randomUUID(), reason: "Erro" })).rejects.toMatchObject({ fieldErrors: { cardRefundNsu: expect.any(Array) } });
    const other = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeId] });
    await expect(cancelSale(other.context, card.saleId, { idempotencyKey: randomUUID(), reason: "Erro" })).rejects.toMatchObject({ code: "not_found" });
    await cancelSale(s.cashier, card.saleId, { idempotencyKey: randomUUID(), reason: "Erro", cardRefundNsu: "EST98765", restock: "false" });
    expect(await quantity(s)).toBe("9.000");

    const late = await sell(s, "1");
    await withScope({ organizationId: s.organizationId }, (tx) =>
      tx
        .update(cashSessions)
        .set({ status: "closed", closedAt: new Date(), countedAmountCents: 0, expectedAmountCents: 0, differenceCents: 0 })
        .where(eq(cashSessions.id, s.sessionId)),
    );
    await expect(cancelSale(s.manager, late.saleId, { idempotencyKey: randomUUID(), reason: "Tarde" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("refunds provider payments through the provider after the commit", async () => {
    const s = await setup();
    const provider = createFakePaymentProvider();
    setPaymentProviderForTests(provider);
    const intent = await createPaymentIntent(s.cashier, { storeId: s.storeId, method: "pix", amountCents: 1000, idempotencyKey: randomUUID() });
    const body = JSON.stringify({ eventId: `evt-${randomUUID()}`, providerReference: provider.referenceOf(intent.id), status: "confirmed", amountCents: 1000 });
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } });
    await handlePaymentWebhook(FAKE_PROVIDER_KEY, new Headers({ "x-test-signature": signFakeWebhook(body) }), stream);
    const sale = await sell(s, "1", [{ method: "pix", amountCents: 1000, paymentIntentId: intent.id }]);
    await cancelSale(s.cashier, sale.saleId, { idempotencyKey: randomUUID(), reason: "Pagou em duplicidade" });
    const [row] = await withScope({ organizationId: s.organizationId }, (tx) => tx.select({ status: paymentIntents.status }).from(paymentIntents).where(eq(paymentIntents.id, intent.id)));
    expect(row.status).toBe("refunded");
  });
});

describe("sale returns", () => {
  it("returns items in steps until the line is exhausted, with exact amounts and optional restock", async () => {
    const s = await setup();
    const sale = await sell(s, "3", undefined, 1);
    // Sale total 2999 for 3 units: 999, 999 and the remainder 1001 on the last return.
    const first = await refundSale(s.manager, sale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "cash", items: [{ line: 1, quantity: "1", restock: "on" }] });
    await refundSale(s.manager, sale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "card_external", nsu: "EST1111", items: [{ line: 1, quantity: "1" }] });
    await expect(refundSale(s.manager, sale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "cash", items: [{ line: 1, quantity: "2" }] })).rejects.toMatchObject({
      fieldErrors: { "items.0.quantity": expect.any(Array) },
    });
    await refundSale(s.manager, sale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "cash", items: [{ line: 1, quantity: "1", restock: "on" }] });
    const refunds = await withScope({ organizationId: s.organizationId }, (tx) => tx.select({ amount: saleRefunds.amountCents }).from(saleRefunds).where(eq(saleRefunds.saleId, sale.saleId)));
    expect(refunds.map((row) => row.amount).sort((a, b) => a - b)).toEqual([999, 999, 1001]);
    expect(refunds.reduce((sum, row) => sum + row.amount, 0)).toBe(2999);
    expect(await quantity(s)).toBe("9.000");
    const detail = await getSale(s.manager, sale.saleId);
    expect(detail?.items[0].returnedQuantity).toBe("3.000");
    expect(detail?.refunds).toHaveLength(3);
    expect(first.replayed).toBe(false);
    await expect(cancelSale(s.manager, sale.saleId, { idempotencyKey: randomUUID(), reason: "Já devolvida" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("serializes concurrent returns of the same line", async () => {
    const s = await setup();
    const sale = await sell(s, "2");
    const results = await Promise.allSettled(
      [0, 1].map(() => refundSale(s.manager, sale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "cash", items: [{ line: 1, quantity: "2" }] })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const items = await withScope({ organizationId: s.organizationId }, (tx) => tx.select({ quantity: saleRefundItems.quantity }).from(saleRefundItems));
    expect(items).toEqual([{ quantity: "2.000" }]);
  });

  it("refuses cash refunds above the drawer, returns out of the window without override and members without permission", async () => {
    const s = await setup();
    const sale = await sell(s, "3");
    const poor = await addMemberFixture(s.organizationId, { roleKey: "store_manager", storeIds: [s.storeId] });
    await openCashSessionFixture(s.organizationId, s.storeId, poor.userId, 0);
    await expect(refundSale(poor.context, sale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "cash", items: [{ line: 1, quantity: "1" }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(refundSale(s.cashier, sale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "cash", items: [{ line: 1, quantity: "1" }] })).rejects.toMatchObject({ code: "forbidden" });

    await withScope({ organizationId: s.organizationId }, (tx) => tx.update(sales).set({ completedAt: new Date(Date.now() - 91 * 86_400_000) }).where(eq(sales.id, sale.saleId)));
    // Custom role with sales.refund but without the override.
    const key = `devolucao_${uniqueSuffix()}`;
    await withScope({ organizationId: s.organizationId }, async (tx) => {
      const [role] = await tx.insert(roles).values({ organizationId: s.organizationId, key, name: `Devolução ${key}`, isSystem: false, rank: 45 }).returning({ id: roles.id });
      await tx.insert(rolePermissions).values(
        ["sales.read", "sales.refund"].map((permission) => ({ organizationId: s.organizationId, roleId: role.id, permission })),
      );
    });
    const limited = await addMemberFixture(s.organizationId, { roleKey: key, storeAccess: "stores", storeIds: [s.storeId] });
    const late = { reason: "Fora do prazo", method: "card_external", nsu: "EST2222", items: [{ line: 1, quantity: "1" }] };
    await expect(refundSale(limited.context, sale.saleId, { ...late, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "forbidden" });
    await expect(refundSale(s.manager, sale.saleId, { ...late, idempotencyKey: randomUUID() })).resolves.toMatchObject({ replayed: false });
  });

  it("isolates refunds between organizations", async () => {
    const s = await setup();
    const sale = await sell(s, "1");
    const other = await createOrganizationFixture();
    await expect(refundSale(other.owner, sale.saleId, { idempotencyKey: randomUUID(), reason: "Invasão", method: "card_external", nsu: "EST3333", items: [{ line: 1, quantity: "1" }] })).rejects.toMatchObject({ code: "not_found" });
    await cancelSale(s.cashier, sale.saleId, { idempotencyKey: randomUUID(), reason: "Erro" });
    const seen = await withScope({ organizationId: other.organizationId }, (tx) => tx.select({ id: saleRefunds.id }).from(saleRefunds));
    expect(seen).toHaveLength(0);
  });
});

describe("idempotency under concurrency", () => {
  it("answers concurrent calls with the same key with the first cancellation or return", async () => {
    const s = await setup();
    const cancelled = await sell(s, "1");
    const cancelKey = randomUUID();
    const cancels = await Promise.all([0, 1].map(() => cancelSale(s.cashier, cancelled.saleId, { idempotencyKey: cancelKey, reason: "Duplo clique" })));
    expect(cancels[0].refundId).toBe(cancels[1].refundId);
    expect(cancels.filter((result) => result.replayed)).toHaveLength(1);

    const returned = await sell(s, "2");
    const refundKey = randomUUID();
    const input = { idempotencyKey: refundKey, reason: "Duplo clique", method: "cash", items: [{ line: 1, quantity: "2" }] };
    const refunds = await Promise.all([0, 1].map(() => refundSale(s.manager, returned.saleId, input)));
    expect(refunds[0].refundId).toBe(refunds[1].refundId);
    expect(refunds.filter((result) => result.replayed)).toHaveLength(1);
    const rows = await withScope({ organizationId: s.organizationId }, (tx) => tx.select({ id: saleRefunds.id }).from(saleRefunds));
    expect(rows).toHaveLength(2);
  });

  it("refuses a key already used on another sale", async () => {
    const s = await setup();
    const first = await sell(s, "1");
    const second = await sell(s, "1");
    const key = randomUUID();
    await refundSale(s.manager, first.saleId, { idempotencyKey: key, reason: "Defeito", method: "cash", items: [{ line: 1, quantity: "1" }] });
    await expect(refundSale(s.manager, second.saleId, { idempotencyKey: key, reason: "Defeito", method: "cash", items: [{ line: 1, quantity: "1" }] })).rejects.toMatchObject({ code: "conflict" });
    await expect(cancelSale(s.cashier, second.saleId, { idempotencyKey: key, reason: "Erro" })).rejects.toMatchObject({ code: "conflict" });
  });
});
