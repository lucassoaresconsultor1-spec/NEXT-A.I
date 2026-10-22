import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listSessions } from "@/server/cash/session-queries";
import { sessionFiltersSchema } from "@/server/cash/schemas";
import { listExpenses } from "@/server/expenses/service";
import { fullSalesSummary } from "@/server/metrics/complete";
import { salesSeries } from "@/server/metrics/sales";
import { queueStats } from "@/server/queue/service";
import { targetProgress } from "@/server/targets/progress";
import type { ModelToolDefinition } from "./port";

// Assistant tools (m21): read-only contracts over the domain services. A tool is
// offered only when the member's permissions allow it, and the service checks
// authorization and store scope again when it runs. No tool writes data.

const day = z.iso.date();
const period = z.object({ from: day, to: day, storeId: z.uuid().optional() }).strict();
const PERIOD_SCHEMA = {
  type: "object",
  properties: {
    from: { type: "string", format: "date", description: "Primeiro dia (AAAA-MM-DD), no fuso da loja." },
    to: { type: "string", format: "date", description: "Último dia (AAAA-MM-DD), incluído." },
    storeId: { type: "string", description: "Opcional: id de uma loja." },
  },
  required: ["from", "to"],
  additionalProperties: false,
};
const storeFilter = (input: z.output<typeof period>) => ({ from: input.from, to: input.to, ...(input.storeId ? { storeIds: [input.storeId] } : {}) });

export interface AiTool {
  definition: ModelToolDefinition;
  allowed(context: TenantContext): boolean;
  input: z.ZodType;
  run(context: TenantContext, input: never): Promise<unknown>;
}

const tool = <S extends z.ZodType>(definition: ModelToolDefinition, allowed: (context: TenantContext) => boolean, input: S, run: (context: TenantContext, input: z.output<S>) => Promise<unknown>): AiTool => ({
  definition,
  allowed,
  input,
  run: run as AiTool["run"],
});

const salesReader = (context: TenantContext) => can(context, "sales.read");

export const AI_TOOLS: AiTool[] = [
  tool(
    { name: "get_sales_summary", description: "Faturamento bruto e líquido, descontos, cancelamentos, devoluções, vendas, ticket médio, itens por venda; margem, lucro, conversão e comissões quando o perfil permite.", inputSchema: PERIOD_SCHEMA },
    salesReader,
    period,
    (context, input) => fullSalesSummary(context, storeFilter(input)),
  ),
  tool(
    { name: "compare_stores", description: "Mesmas métricas de vendas por loja no período, para comparar lojas.", inputSchema: PERIOD_SCHEMA },
    salesReader,
    period,
    (context, input) => salesSeries(context, { ...storeFilter(input), groupBy: "store" }),
  ),
  tool(
    { name: "get_salesperson_ranking", description: "Métricas de vendas por vendedor no período.", inputSchema: PERIOD_SCHEMA },
    salesReader,
    period,
    (context, input) => salesSeries(context, { ...storeFilter(input), groupBy: "salesperson" }),
  ),
  tool(
    {
      name: "get_target_progress",
      description: "Metas do mês com realizado, percentual, dias úteis e projeção.",
      inputSchema: { type: "object", properties: { month: { type: "string", description: "Mês AAAA-MM." } }, required: ["month"], additionalProperties: false },
    },
    (context) => can(context, "targets.read"),
    z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict(),
    (context, input) => targetProgress(context, { month: input.month }),
  ),
  tool(
    { name: "get_queue_metrics", description: "Atendimentos da fila no período: encerrados, com venda, sem venda, desistências e conversão.", inputSchema: PERIOD_SCHEMA },
    (context) => can(context, "queue.read"),
    period,
    (context, input) => queueStats(context, input),
  ),
  tool(
    {
      name: "get_open_cash_sessions",
      description: "Caixas abertos agora, com loja, operador e abertura.",
      inputSchema: { type: "object", properties: { storeId: { type: "string" } }, additionalProperties: false },
    },
    (context) => can(context, "cash.read"),
    z.object({ storeId: z.uuid().optional() }).strict(),
    async (context, input) => (await listSessions(context, sessionFiltersSchema.parse({ status: "open", storeId: input.storeId, page: 1 }))).rows,
  ),
  tool(
    { name: "get_expenses_total", description: "Total de despesas (por competência, sem as canceladas) no período.", inputSchema: PERIOD_SCHEMA },
    (context) => can(context, "expenses.read"),
    period,
    async (context, input) => ({ totalCents: (await listExpenses(context, { from: input.from, to: input.to, storeId: input.storeId, page: 1 })).totalCents }),
  ),
];

export function availableTools(context: TenantContext) {
  return AI_TOOLS.filter((entry) => entry.allowed(context));
}
