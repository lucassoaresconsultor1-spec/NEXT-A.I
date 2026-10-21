import "server-only";
import type { FiscalProvider } from "./port";

// Resolves the configured fiscal provider. No adapter ships in this delivery:
// emission depends on a provider, a digital certificate and professional tax
// configuration (pending decisions of the product owner). Tests inject a fake.

const ADAPTERS: Record<string, () => FiscalProvider> = {};

let testOverride: FiscalProvider | null | undefined;

export function getFiscalProvider(): FiscalProvider | null {
  if (testOverride !== undefined) return testOverride;
  const key = process.env.FISCAL_PROVIDER?.trim();
  if (!key) return null;
  const factory = ADAPTERS[key];
  return factory ? factory() : null;
}

/** Integration tests only: replaces the configured provider (null = none, undefined = back to the environment). */
export function setFiscalProviderForTests(provider: FiscalProvider | null | undefined) {
  testOverride = provider;
}
