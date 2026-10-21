import "server-only";
import type { PaymentProvider } from "./port";

// Resolves the configured payment provider. This delivery ships no real
// adapter: PAYMENT_PROVIDER names one only after a provider is chosen and
// integrated (pending decision of the product owner), so the provider methods
// stay unavailable instead of being simulated. Tests inject a fake adapter.

const ADAPTERS: Record<string, () => PaymentProvider> = {};

let testOverride: PaymentProvider | null | undefined;

export function getPaymentProvider(): PaymentProvider | null {
  if (testOverride !== undefined) return testOverride;
  const key = process.env.PAYMENT_PROVIDER?.trim();
  if (!key) return null;
  const factory = ADAPTERS[key];
  return factory ? factory() : null;
}

/** Integration tests only: replaces the configured provider (null = none, undefined = back to the environment). */
export function setPaymentProviderForTests(provider: PaymentProvider | null | undefined) {
  testOverride = provider;
}
