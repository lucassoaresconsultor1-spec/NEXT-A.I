import type { ModelProvider, ModelRequest, ModelResponse } from "@/server/ai/port";

// Test-only model adapter: answers from a scripted queue and records the requests
// it received. Never registered outside tests.

export function createFakeModelProvider(options: { pricing?: ModelProvider["pricing"] } = {}) {
  const script: (ModelResponse | Error)[] = [];
  const requests: ModelRequest[] = [];
  const provider: ModelProvider & { script: typeof script; requests: typeof requests } = {
    key: "teste",
    model: "modelo-de-teste",
    pricing: options.pricing ?? null,
    script,
    requests,
    async chat(request) {
      requests.push(request);
      const next = script.shift();
      if (!next) throw new Error("Fake model provider has no scripted response");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return provider;
}

export const textResponse = (text: string, usage = { inputTokens: 100, outputTokens: 20 }): ModelResponse => ({ content: [{ type: "text", text }], stopReason: "end", usage });
