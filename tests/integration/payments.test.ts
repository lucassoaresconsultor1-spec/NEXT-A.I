import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { paymentEvents, paymentIntents, salePayments } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { recordMovement } from "@/server/inventory/service";
import { cancelPaymentIntent, createPaymentIntent, refreshPaymentIntent } from "@/server/payments/intents";
import { setPaymentProviderForTests } from "@/server/payments/registry";
import { MAX_WEBHOOK_BYTES } from "@/server/payments/schemas";
import { handlePaymentWebhook } from "@/server/payments/webhook";
import { completeSale } from "@/server/sales/complete";
import { createFakePaymentProvider, FAKE_PROVIDER_KEY, signFakeWebhook } from "../support/fake-payment-provider";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

afterEach(() => setPaymentProviderForTests(undefined));

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const { variantId } = await createVariantFixture(org.organizationId);
  await setPriceFixture(org.organizationId, variantId, 1000);
  await recordMovement(org.owner, { storeId, variantId, type: "entry", quantity: "10", reason: "Estoque inicial" });
  const cashier = await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [storeId] });
  await openCashSessionFixture(org.organizationId, storeId, cashier.userId);
  const provider = createFakePaymentProvider();
  setPaymentProviderForTests(provider);
  return { ...org, storeId, variantId, cashier: cashier.context, provider };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const intentInput = (s: Setup, amountCents = 3000, method: "pix" | "card_provider" = "pix") => ({ storeId: s.storeId, method, amountCents, idempotencyKey: randomUUID() });

/** Body as a stream; `pulled` tells whether the handler read it at all. */
function streamOf(text: string, chunkSize = 16 * 1024) {
  const bytes = new TextEncoder().encode(text);
  const state = { pulled: false };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled = true;
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  }, { highWaterMark: 0 });
  return { stream, state };
}

async function webhook(event: Record<string, unknown>, signature?: string) {
  const body = JSON.stringify(event);
  const headers = new Headers({ "x-test-signature": signature ?? signFakeWebhook(body) });
  return handlePaymentWebhook(FAKE_PROVIDER_KEY, headers, streamOf(body).stream);
}

async function intentRow(s: Setup, id: string) {
  const [row] = await withScope({ organizationId: s.organizationId }, (tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, id)));
  return row;
}

const saleWith = (s: Setup, payments: unknown[]) => ({
  completionKey: randomUUID(),
  storeId: s.storeId,
  items: [{ variantId: s.variantId, quantity: "3", expectedUnitPriceCents: 1000 }],
  payments,
});

describe("payment intents", () => {
  it("refuses provider payments when no provider is configured, writing nothing", async () => {
    const s = await setup();
    setPaymentProviderForTests(null);
    await expect(createPaymentIntent(s.cashier, intentInput(s))).rejects.toMatchObject({ code: "invalid" });
    const rows = await withScope({ organizationId: s.organizationId }, (tx) => tx.select({ id: paymentIntents.id }).from(paymentIntents));
    expect(rows).toHaveLength(0);
  });

  it("creates a pending PIX intent, is idempotent and confirms only through an authenticated webhook", async () => {
    const s = await setup();
    const input = intentInput(s);
    const intent = await createPaymentIntent(s.cashier, input);
    expect(intent).toMatchObject({ status: "pending", method: "pix", amountCents: 3000, pixCopyPaste: expect.any(String), replayed: false });
    expect(await createPaymentIntent(s.cashier, input)).toMatchObject({ id: intent.id, replayed: true });

    const event = { eventId: `evt-${randomUUID()}`, providerReference: s.provider.referenceOf(intent.id), status: "confirmed", amountCents: 3000 };
    expect(await webhook(event, "assinatura-falsa")).toMatchObject({ status: 401 });
    expect((await intentRow(s, intent.id)).status).toBe("pending");

    expect(await webhook(event)).toMatchObject({ status: 200 });
    expect(await webhook(event)).toMatchObject({ status: 200 });
    expect((await intentRow(s, intent.id)).status).toBe("confirmed");
    const events = await withScope({ organizationId: s.organizationId }, (tx) => tx.select({ id: paymentEvents.id }).from(paymentEvents).where(eq(paymentEvents.intentId, intent.id)));
    expect(events).toHaveLength(1);
    expect((await handlePaymentWebhook("outro", new Headers(), streamOf("{}").stream)).status).toBe(404);
  });

  it("checks provider and size before reading the body, and cuts oversized streams", async () => {
    await setup();
    setPaymentProviderForTests(null);
    const unread = streamOf("x".repeat(100));
    expect((await handlePaymentWebhook(FAKE_PROVIDER_KEY, new Headers(), unread.stream)).status).toBe(404);
    expect(unread.state.pulled).toBe(false);

    setPaymentProviderForTests(createFakePaymentProvider());
    const declared = streamOf("{}");
    expect((await handlePaymentWebhook(FAKE_PROVIDER_KEY, new Headers({ "content-length": String(MAX_WEBHOOK_BYTES + 1) }), declared.stream)).status).toBe(413);
    expect(declared.state.pulled).toBe(false);

    // No Content-Length: the stream is read with a counter and cut past the limit.
    expect((await handlePaymentWebhook(FAKE_PROVIDER_KEY, new Headers(), streamOf("x".repeat(MAX_WEBHOOK_BYTES + 1)).stream)).status).toBe(413);
  });

  it("still processes a signed body of exactly the limit", async () => {
    const s = await setup();
    const intent = await createPaymentIntent(s.cashier, intentInput(s, 3000));
    const base = { eventId: `evt-${randomUUID()}`, providerReference: s.provider.referenceOf(intent.id), status: "confirmed", amountCents: 3000, pad: "" };
    const padding = MAX_WEBHOOK_BYTES - Buffer.byteLength(JSON.stringify(base));
    const body = JSON.stringify({ ...base, pad: "p".repeat(padding) });
    expect(Buffer.byteLength(body)).toBe(MAX_WEBHOOK_BYTES);
    const result = await handlePaymentWebhook(FAKE_PROVIDER_KEY, new Headers({ "x-test-signature": signFakeWebhook(body), "content-length": String(MAX_WEBHOOK_BYTES) }), streamOf(body).stream);
    expect(result.status).toBe(200);
    expect((await intentRow(s, intent.id)).status).toBe("confirmed");
  });

  it("fails the intent when the confirmed amount diverges", async () => {
    const s = await setup();
    const intent = await createPaymentIntent(s.cashier, intentInput(s, 3000));
    await webhook({ eventId: `evt-${randomUUID()}`, providerReference: s.provider.referenceOf(intent.id), status: "confirmed", amountCents: 2999 });
    expect(await intentRow(s, intent.id)).toMatchObject({ status: "failed", failureReason: "amount_mismatch" });
  });

  it("confirms by querying the provider and cancels pending intents", async () => {
    const s = await setup();
    const intent = await createPaymentIntent(s.cashier, intentInput(s, 3000, "card_provider"));
    expect((await refreshPaymentIntent(s.cashier, intent.id)).status).toBe("pending");
    s.provider.setRemoteStatus(s.provider.referenceOf(intent.id), "confirmed");
    expect((await refreshPaymentIntent(s.cashier, intent.id)).status).toBe("confirmed");

    const other = await createPaymentIntent(s.cashier, intentInput(s));
    await cancelPaymentIntent(s.cashier, other.id);
    expect((await intentRow(s, other.id)).status).toBe("cancelled");
    await expect(cancelPaymentIntent(s.cashier, intent.id)).rejects.toMatchObject({ code: "invalid" });
  });

  it("marks the intent failed when the provider is unavailable", async () => {
    const s = await setup();
    s.provider.failNext();
    expect(await createPaymentIntent(s.cashier, intentInput(s))).toMatchObject({ status: "failed", failureReason: "provider_unavailable" });
  });
});

describe("sales with provider payments", () => {
  it("completes a sale with a confirmed intent plus cash, once", async () => {
    const s = await setup();
    const intent = await createPaymentIntent(s.cashier, intentInput(s, 2000));
    await expect(completeSale(s.cashier, saleWith(s, [{ method: "pix", amountCents: 2000, paymentIntentId: intent.id }, { method: "cash", amountCents: 1000, tenderedCents: 1000 }]))).rejects.toMatchObject({
      fieldErrors: { "payments.0.paymentIntentId": expect.any(Array) },
    });
    await webhook({ eventId: `evt-${randomUUID()}`, providerReference: s.provider.referenceOf(intent.id), status: "confirmed", amountCents: 2000 });

    const done = await completeSale(s.cashier, saleWith(s, [{ method: "pix", amountCents: 2000, paymentIntentId: intent.id }, { method: "cash", amountCents: 1000, tenderedCents: 1000 }]));
    expect((await intentRow(s, intent.id)).saleId).toBe(done.saleId);
    const payments = await withScope({ organizationId: s.organizationId }, (tx) => tx.select().from(salePayments).where(eq(salePayments.saleId, done.saleId)));
    expect(payments.find((payment) => payment.method === "pix")).toMatchObject({ status: "confirmed", providerReference: s.provider.referenceOf(intent.id) });

    await expect(completeSale(s.cashier, saleWith(s, [{ method: "pix", amountCents: 2000, paymentIntentId: intent.id }, { method: "cash", amountCents: 1000, tenderedCents: 1000 }]))).rejects.toMatchObject({
      fieldErrors: { "payments.0.paymentIntentId": expect.any(Array) },
    });
  });

  it("refuses an intent of another operator or with a different amount", async () => {
    const s = await setup();
    const intent = await createPaymentIntent(s.cashier, intentInput(s, 3000));
    await webhook({ eventId: `evt-${randomUUID()}`, providerReference: s.provider.referenceOf(intent.id), status: "confirmed", amountCents: 3000 });
    const other = await addMemberFixture(s.organizationId, { roleKey: "cashier", storeIds: [s.storeId] });
    await openCashSessionFixture(s.organizationId, s.storeId, other.userId);
    await expect(completeSale(other.context, saleWith(s, [{ method: "pix", amountCents: 3000, paymentIntentId: intent.id }]))).rejects.toMatchObject({ code: "invalid" });
    await expect(completeSale(s.cashier, saleWith(s, [{ method: "card_provider", amountCents: 3000, paymentIntentId: intent.id }]))).rejects.toMatchObject({ code: "invalid" });
  });

  it("isolates intents between organizations", async () => {
    const s = await setup();
    const intent = await createPaymentIntent(s.cashier, intentInput(s));
    const other = await createOrganizationFixture();
    await expect(refreshPaymentIntent(other.owner, intent.id)).rejects.toMatchObject({ code: "not_found" });
    const seen = await withScope({ organizationId: other.organizationId }, (tx) => tx.select({ id: paymentIntents.id }).from(paymentIntents));
    expect(seen).toHaveLength(0);
  });
});
