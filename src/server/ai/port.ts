// Model provider port (m20). Adapters translate this shape to a provider API; the
// rest of the system never depends on a provider. No adapter ships until the
// owner chooses a provider and configures its credentials.

export interface ModelToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the tool input. */
  inputSchema: Record<string, unknown>;
}

export type ModelContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ModelMessage {
  role: "user" | "assistant";
  content: ModelContentBlock[];
}

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  maxOutputTokens: number;
}

export interface ModelResponse {
  content: ModelContentBlock[];
  stopReason: "end" | "tool_use" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number };
}

export type ModelErrorKind = "rate_limited" | "timeout" | "unavailable" | "invalid_request";

export class ModelProviderError extends Error {
  constructor(readonly kind: ModelErrorKind) {
    super(`Model provider error: ${kind}`);
    this.name = "ModelProviderError";
  }
}

export interface ModelProvider {
  readonly key: string;
  readonly model: string;
  /** Price declared by the adapter's configuration, in millionths of a real per million tokens; null = unknown. */
  readonly pricing: { inputMicrosPerMillion: number; outputMicrosPerMillion: number } | null;
  chat(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}
