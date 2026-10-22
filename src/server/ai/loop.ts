import "server-only";
import type { TenantContext } from "@/server/authz/context";
import { isDomainError } from "@/server/errors";
import type { ModelContentBlock, ModelMessage } from "./port";
import { callModel } from "./service";
import type { AiTool } from "./tools";

// Tool loop shared by the central agent and the specialists (m21, m39): only the
// given tools run; anything else is blocked; results go back as delimited data.

const MAX_ROUNDS = 4;
const MAX_RESULT_CHARS = 20_000;
export const NO_ANSWER = "Não consegui concluir a análise com as ferramentas disponíveis.";

export type ToolRecorder = (tool: string, status: "ok" | "error" | "blocked", params: unknown, error: string | null, durationMs: number) => Promise<void>;

export interface LoopResult {
  answer: string;
  sources: { tool: string; params: unknown }[];
  blocked: string[];
  tokens: number;
}

export async function runAgentLoop(context: TenantContext, options: { system: string; tools: AiTool[]; messages: ModelMessage[]; record: ToolRecorder }): Promise<LoopResult> {
  const messages = [...options.messages];
  const byName = new Map(options.tools.map((entry) => [entry.definition.name, entry]));
  const sources: LoopResult["sources"] = [];
  const blocked: string[] = [];
  let tokens = 0;
  for (let round = 0; round <= MAX_ROUNDS; round += 1) {
    const response = await callModel(context, { feature: "assistant", system: options.system, messages, tools: options.tools.map((entry) => entry.definition) });
    tokens += response.usage.inputTokens + response.usage.outputTokens;
    const uses = response.content.filter((block): block is Extract<ModelContentBlock, { type: "tool_use" }> => block.type === "tool_use");
    if (response.stopReason !== "tool_use" || uses.length === 0 || round === MAX_ROUNDS) {
      const answer = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n").trim() || NO_ANSWER;
      return { answer, sources, blocked, tokens };
    }
    messages.push({ role: "assistant", content: response.content });
    const results: ModelContentBlock[] = [];
    for (const use of uses) {
      const started = Date.now();
      const entry = byName.get(use.name);
      if (!entry) {
        blocked.push(use.name);
        await options.record(use.name, "blocked", undefined, "Ferramenta não autorizada para este perfil.", Date.now() - started);
        results.push({ type: "tool_result", toolUseId: use.id, content: "Ferramenta não autorizada para este perfil.", isError: true });
        continue;
      }
      const input = entry.input.safeParse(use.input);
      if (!input.success) {
        await options.record(use.name, "error", use.input, "Parâmetros inválidos.", Date.now() - started);
        results.push({ type: "tool_result", toolUseId: use.id, content: "Parâmetros inválidos para esta ferramenta.", isError: true });
        continue;
      }
      try {
        // "<" escaped as < (still valid JSON), so stored text cannot close the <dados> delimiter.
        const data = JSON.stringify(await entry.run(context, input.data as never)).replace(/</g, "\\u003c").slice(0, MAX_RESULT_CHARS);
        await options.record(use.name, "ok", input.data, null, Date.now() - started);
        sources.push({ tool: use.name, params: input.data });
        results.push({ type: "tool_result", toolUseId: use.id, content: `<dados ferramenta="${use.name}">${data}</dados>` });
      } catch (error) {
        if (!isDomainError(error)) throw error;
        await options.record(use.name, "error", input.data, error.message.slice(0, 240), Date.now() - started);
        results.push({ type: "tool_result", toolUseId: use.id, content: error.message, isError: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: NO_ANSWER, sources, blocked, tokens };
}
