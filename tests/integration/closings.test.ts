import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { cashSessions } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { closeDay, getClosing } from "@/server/closings/service";
import { recordMovement } from "@/server/inventory/service";
import { createPaymentIntent } from "@/server/payments/intents";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { handlePaymentWebhook } from "@/server/payments/webhook";
import { completeSale } from "@/server/sales/complete";
import { refundSale } from "@/server/sales/refund";
import { todayIn } from "@/server/targets/schemas";
import { createFakePaymentProvider, FAKE_PROVIDER_KEY, signFakeWebhook } from "../support/fake-payment-provider";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

afterEach(() => setPaymentProviderForTests(undefined));

describe("daily closing", () => {
  it("snapshots the day, refuses open cash sessions and reconciles provider payments in versions", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const otherStore = await createStoreFixture(organizationId);
    const { variantId } = await createVariantFixture(organizationId);
    await setPriceFixture(organizationId, variantId, 1000);
    await recordMovement(owner, { storeId, variantId, type: "entry", quantity: "10", reason: "Estoque" });
    const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeId] });
    const sessionId = await openCashSessionFixture(organizationId, storeId, cashier.userId, 0);
    const provider = createFakePaymentProvider();
    setPaymentProviderForTests(provider);
    const sell = (quantity: number, payment: Record<string, unknown>) =>
      completeSale(cashier.context, { completionKey: randomUUID(), storeId, items: [{ variantId, quantity: String(quantity), expectedUnitPriceCents: 1000 }], payments: [payment] });

    const cashSale = await sell(2, { method: "cash", amountCents: 2000, tenderedCents: 2000 });
    await sell(1, { method: "card_external", amountCents: 1000, nsu: "VENDA123" });
    const intent = await createPaymentIntent(cashier.context, { storeId, method: "pix", amountCents: 1000, idempotencyKey: randomUUID() });
    const reference = provider.referenceOf(intent.id);
    const body = JSON.stringify({ eventId: `evt-${randomUUID()}`, providerReference: reference, status: "confirmed", amountCents: 1000 });
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } });
    await handlePaymentWebhook(FAKE_PROVIDER_KEY, new Headers({ "x-test-signature": signFakeWebhook(body) }), stream);
    // The provider itself also reports the charge as confirmed.
    provider.setRemoteStatus(reference, "confirmed");
    await sell(1, { method: "pix", amountCents: 1000, paymentIntentId: intent.id });
    await refundSale(owner, cashSale.saleId, { idempotencyKey: randomUUID(), reason: "Defeito", method: "card_external", nsu: "EST1234", items: [{ line: 1, quantity: "1" }] });

    const day = todayIn("America/Sao_Paulo");
    await expect(closeDay(owner, { storeId, day })).rejects.toMatchObject({ code: "invalid" });
    await withScope({ organizationId }, (tx) =>
      tx.update(cashSessions).set({ status: "closed", closedAt: new Date(), countedAmountCents: 1950, expectedAmountCents: 2000, differenceCents: -50 }).where(eq(cashSessions.id, sessionId)),
    );
    await expect(closeDay(owner, { storeId, day: "2999-01-01" })).rejects.toMatchObject({ code: "invalid" });

    expect(await closeDay(owner, { storeId, day })).toMatchObject({ version: 1 });
    expect(await getClosing(owner, storeId, day)).toMatchObject({
      saleCount: 3,
      salesCents: 4000,
      cashCents: 2000,
      cardExternalCents: 1000,
      pixCents: 1000,
      cardProviderCents: 0,
      returnedCents: 1000,
      cancelledCents: 0,
      cashDifferenceCents: -50,
      reconciliation: "reconciled",
      reconciledCount: 1,
      divergentCount: 0,
    });

    provider.setRemoteStatus(reference, "refunded");
    expect(await closeDay(owner, { storeId, day })).toMatchObject({ version: 2 });
    expect(await getClosing(owner, storeId, day)).toMatchObject({ version: 2, reconciliation: "divergent", divergences: [expect.objectContaining({ kind: "status_mismatch", providerStatus: "refunded", ourStatus: "confirmed" })] });
    setPaymentProviderForTests(undefined);
    await closeDay(owner, { storeId, day });
    expect(await getClosing(owner, storeId, day)).toMatchObject({ version: 3, reconciliation: "not_configured" });

    const otherManager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [otherStore] });
    await expect(closeDay(otherManager.context, { storeId, day })).rejects.toMatchObject({ code: "not_found" });
    await expect(closeDay(cashier.context, { storeId, day })).rejects.toMatchObject({ code: "forbidden" });
    const other = await createOrganizationFixture();
    expect(await getClosing(other.owner, storeId, day)).toBeNull();
  });
});
