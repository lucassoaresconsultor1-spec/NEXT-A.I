import "server-only";
import type { ModelProvider } from "./port";

// Resolves the configured model provider. This delivery ships no real adapter:
// AI_PROVIDER names one only after the owner chooses a provider (pending), so the
// assistant shows "pending" instead of simulating answers. Tests inject a fake.

const ADAPTERS: Record<string, () => ModelProvider> = {};

let testOverride: ModelProvider | null | undefined;

export function getModelProvider(): ModelProvider | null {
  if (testOverride !== undefined) return testOverride;
  const key = process.env.AI_PROVIDER?.trim();
  if (!key) return null;
  const factory = ADAPTERS[key];
  return factory ? factory() : null;
}

/** Integration tests only: replaces the configured provider (null = none, undefined = back to the environment). */
export function setModelProviderForTests(provider: ModelProvider | null | undefined) {
  testOverride = provider;
}
