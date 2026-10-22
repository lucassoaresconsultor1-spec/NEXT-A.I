import "server-only";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { aiConversations, aiMessages, aiToolRuns, alerts, queueEntries } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { getModelProvider } from "@/server/ai/registry";
import { availableTools } from "@/server/ai/tools";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/guard";

// Virtual office state (m24a): every agent state is derived from recorded
// executions (tool runs and conversations); nothing is random or estimated.

export const OFFICE_AGENTS = [
  { id: "agent.central", name: "Otto", room: "Central de Inteligência", tools: [] as string[] },
  { id: "agent.bi", name: "Bia", room: "Business Intelligence", tools: ["get_sales_summary", "compare_stores"] },
  { id: "agent.comercial", name: "Caio", room: "Comercial", tools: ["get_target_progress", "get_salesperson_ranking"] },
  { id: "agent.estoque", name: "Duda", room: "Estoque e Logística", tools: [] as string[] },
  { id: "agent.financeiro", name: "Iara", room: "Financeiro", tools: ["get_expenses_total"] },
  { id: "agent.atendimento", name: "Léo", room: "Atendimento", tools: ["get_queue_metrics"] },
  { id: "agent.operacoes", name: "Rui", room: "Operações e Auditoria", tools: ["get_open_cash_sessions"] },
  { id: "agent.conhecimento", name: "Sofia", room: "Conhecimento", tools: ["search_company_procedures"] },
] as const;

export type OfficeState = "unavailable" | "analyzing" | "done" | "error" | "available";
const DONE_MS = 20_000;
const ERROR_MS = 5 * 60_000;
const ANALYZING_MS = 2 * 60_000;

const agentOf = (tool: string) => OFFICE_AGENTS.find((agent) => (agent.tools as readonly string[]).includes(tool))?.id ?? "agent.central";

export async function officeSnapshot(context: TenantContext, now = new Date()) {
  assertCan(context, "ai.use");
  const orgId = context.organization.id;
  const aiConfigured = getModelProvider() !== null;
  const allowed = new Set(availableTools(context).map((tool) => tool.definition.name));
  return withScope(dbScope(context), async (tx) => {
    const recent = await tx
      .select({ tool: aiToolRuns.tool, status: aiToolRuns.status, error: aiToolRuns.error, at: aiToolRuns.createdAt })
      .from(aiToolRuns)
      .where(and(eq(aiToolRuns.organizationId, orgId), gte(aiToolRuns.createdAt, new Date(now.getTime() - 24 * 3_600_000))))
      .orderBy(desc(aiToolRuns.createdAt))
      .limit(200);
    // A conversation whose latest message is a question still being answered.
    const [pending] = await tx
      .select({ value: count() })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.organizationId, orgId),
          sql`(select m.role from ${aiMessages} m where m.organization_id = ${aiConversations.organizationId} and m.conversation_id = ${aiConversations.id}
            order by m.created_at desc limit 1) = 'user'`,
          sql`(select max(m.created_at) from ${aiMessages} m where m.organization_id = ${aiConversations.organizationId} and m.conversation_id = ${aiConversations.id}) >= ${new Date(now.getTime() - ANALYZING_MS)}`,
        ),
      );

    const agents = OFFICE_AGENTS.map((agent) => {
      const runs = recent.filter((run) => agentOf(run.tool) === agent.id);
      const last = runs[0];
      const age = last ? now.getTime() - last.at.getTime() : Infinity;
      const reachable = agent.id === "agent.central" || agent.tools.some((tool) => allowed.has(tool));
      let state: OfficeState = "available";
      if (!aiConfigured || !reachable) state = "unavailable";
      else if (agent.id === "agent.central" && pending.value > 0) state = "analyzing";
      else if (last?.status !== "ok" && last && age < ERROR_MS) state = "error";
      else if (last && age < DONE_MS) state = "done";
      return { id: agent.id, name: agent.name, room: agent.room, tools: [...agent.tools], state, lastActivityAt: last?.at ?? null, lastError: last && last.status !== "ok" ? last.error : null };
    });

    const panels = {
      openAlerts: can(context, "alerts.read")
        ? (await tx.select({ value: count() }).from(alerts).where(and(eq(alerts.organizationId, orgId), sql`${alerts.status} <> 'resolved'`, storeScopeCondition(context.storeScope, alerts.storeId))))[0].value
        : null,
      waitingInQueue: can(context, "queue.read")
        ? (await tx.select({ value: count() }).from(queueEntries).where(and(eq(queueEntries.organizationId, orgId), eq(queueEntries.status, "waiting"), storeScopeCondition(context.storeScope, queueEntries.storeId))))[0].value
        : null,
    };
    const counters = {
      available: agents.filter((agent) => agent.state === "available").length,
      running: agents.filter((agent) => agent.state === "analyzing").length,
      done: agents.filter((agent) => agent.state === "done").length,
      errors: agents.filter((agent) => agent.state === "error").length,
      unavailable: agents.filter((agent) => agent.state === "unavailable").length,
    };
    // History without parameters or authors: only which agent ran, how it ended and when.
    const history = recent.slice(0, 20).map((run) => ({ agent: agentOf(run.tool), status: run.status, at: run.at }));
    return { generatedAt: now, aiConfigured, agents, counters, history, panels };
  });
}
