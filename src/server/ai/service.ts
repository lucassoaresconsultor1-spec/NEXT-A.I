import "server-only";
import { aiUsageRecords } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { DomainError, limitReached } from "@/server/errors";
import { assertFeature } from "@/server/plans/entitlements";
import { ModelProviderError, type ModelMessage, type ModelResponse, type ModelToolDefinition } from "./port";
import { getModelProvider } from "./registry";

// Model calls (m20): permission and plan first, the provider call outside any
// transaction with a time limit, and one usage row per call (tokens, cost from the
// adapter's declared price, outcome) without the text of the conversation.

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 2_000;

const ERROR_MESSAGES: Record<ModelProviderError["kind"], string> = {
  rate_limited: "O assistente está com muitas solicitações agora. Tente de novo em instantes.",
  timeout: "O assistente demorou demais para responder. Tente uma pergunta mais curta.",
  unavailable: "O assistente está indisponível no momento. Tente mais tarde.",
  invalid_request: "Não foi possível processar esta pergunta. Reformule e tente de novo.",
};

export function aiStatus(context: TenantContext) {
  assertCan(context, "ai.use");
  const provider = getModelProvider();
  return { configured: Boolean(provider), provider: provider?.key ?? null, model: provider?.model ?? null };
}

export interface ModelCall {
  feature: "assistant" | "report";
  system: string;
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  maxOutputTokens?: number;
}

export async function callModel(context: TenantContext, call: ModelCall): Promise<ModelResponse> {
  assertCan(context, "ai.use");
  const orgId = context.organization.id;
  await withScope(dbScope(context), (tx) => assertFeature(tx, orgId, "ai_assistant"));
  const provider = getModelProvider();
  if (!provider) throw limitReached("Assistente de IA pendente: nenhum provedor configurado.");

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: ModelResponse | null = null;
  let errorKind: ModelProviderError["kind"] | null = null;
  try {
    response = await provider.chat(
      { system: call.system, messages: call.messages, tools: call.tools, maxOutputTokens: Math.min(call.maxOutputTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS) },
      controller.signal,
    );
  } catch (error) {
    errorKind = controller.signal.aborted ? "timeout" : error instanceof ModelProviderError ? error.kind : "unavailable";
  } finally {
    clearTimeout(timer);
  }

  const usage = response?.usage ?? { inputTokens: 0, outputTokens: 0 };
  const costMicros = provider.pricing
    ? Math.ceil((usage.inputTokens * provider.pricing.inputMicrosPerMillion + usage.outputTokens * provider.pricing.outputMicrosPerMillion) / 1_000_000)
    : null;
  await withScope(dbScope(context), (tx) =>
    tx.insert(aiUsageRecords).values({
      organizationId: orgId,
      userId: context.user.id,
      feature: call.feature,
      provider: provider.key,
      model: provider.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costMicros,
      durationMs: Date.now() - started,
      status: errorKind ? "error" : "ok",
      errorKind,
    }),
  );
  if (errorKind || !response) throw new DomainError(ERROR_MESSAGES[errorKind ?? "unavailable"], "invalid");
  return response;
}
