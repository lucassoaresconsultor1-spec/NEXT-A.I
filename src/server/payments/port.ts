// Port for payment providers (ADR-005). Adapters translate a provider API to
// these shapes; nothing in the product confirms a payment by itself. No real
// adapter is registered in this delivery.

export type ProviderMethod = "pix" | "card_provider";
export type ProviderStatus = "pending" | "confirmed" | "failed" | "cancelled" | "refunded";

export interface CreateChargeInput {
  method: ProviderMethod;
  amountCents: number;
  /** Our intent id, so the provider echoes it back. */
  reference: string;
  description: string;
  expiresInSeconds: number;
}

export interface ChargeResult {
  providerReference: string;
  status: ProviderStatus;
  pix?: { qrCode: string; copyPaste: string; expiresAt: Date };
}

export interface ProviderEvent {
  eventId: string;
  providerReference: string;
  status: ProviderStatus;
  amountCents: number;
}

export interface PaymentProvider {
  readonly key: string;
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
  getStatus(providerReference: string): Promise<{ status: ProviderStatus; amountCents: number }>;
  refund(providerReference: string, amountCents: number, idempotencyKey: string): Promise<{ status: "refunded" | "pending" | "failed"; refundReference: string }>;
  /** Verifies the signature/authentication of a webhook; returns the normalized event or null when invalid. */
  verifyWebhook(headers: Headers, rawBody: string): Promise<ProviderEvent | null>;
}
