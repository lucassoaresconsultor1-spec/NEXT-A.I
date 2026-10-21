import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ChargeResult, CreateChargeInput, PaymentProvider, ProviderEvent, ProviderStatus } from "@/server/payments/port";

// TEST-ONLY payment adapter. Never registered by the product (registry.ts has no
// adapters); integration tests inject it with setPaymentProviderForTests. It
// signs webhooks with HMAC-SHA256 so the signature path is exercised for real.

export const FAKE_PROVIDER_KEY = "teste";
const SECRET = "segredo-somente-para-testes-de-integracao";

export function signFakeWebhook(body: string) {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

export function createFakePaymentProvider() {
  const charges = new Map<string, { amountCents: number; status: ProviderStatus }>();
  let failNextCharge = false;
  const provider: PaymentProvider & {
    setRemoteStatus(reference: string, status: ProviderStatus): void;
    failNext(): void;
    referenceOf(intentId: string): string;
  } = {
    key: FAKE_PROVIDER_KEY,
    async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
      if (failNextCharge) {
        failNextCharge = false;
        throw new Error("provider offline");
      }
      const providerReference = `fake-${input.reference}`;
      charges.set(providerReference, { amountCents: input.amountCents, status: "pending" });
      return {
        providerReference,
        status: "pending",
        pix: input.method === "pix" ? { qrCode: "data:image/png;base64,AAAA", copyPaste: `00020126-${randomUUID()}`, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000) } : undefined,
      };
    },
    async getStatus(providerReference: string) {
      const charge = charges.get(providerReference);
      return { status: charge?.status ?? "failed", amountCents: charge?.amountCents ?? 0 };
    },
    async refund(providerReference: string) {
      const charge = charges.get(providerReference);
      if (charge) charge.status = "refunded";
      return { status: "refunded" as const, refundReference: `refund-${providerReference}` };
    },
    async verifyWebhook(headers: Headers, rawBody: string): Promise<ProviderEvent | null> {
      const signature = headers.get("x-test-signature") ?? "";
      const expected = signFakeWebhook(rawBody);
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
      const event = JSON.parse(rawBody) as ProviderEvent;
      return event;
    },
    setRemoteStatus(reference, status) {
      const charge = charges.get(reference);
      if (charge) charge.status = status;
    },
    failNext() {
      failNextCharge = true;
    },
    referenceOf(intentId) {
      return `fake-${intentId}`;
    },
  };
  return provider;
}
