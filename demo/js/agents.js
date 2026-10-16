// Agent registry and the derived state the virtual office shows. Visual identity
// (name, look) is kept apart from the technical id; states come only from run records.

export const AGENTS = [
  { id: "central", room: 1, name: "Otto", title: "Coordenador Central", roomName: "Central de Inteligência", specialty: "Recebe pedidos, aciona especialistas e consolida as respostas.", tools: [], module: "assistente", look: { hair: "#2b2118", skin: "#c68b59", shirt: "#1f5bd1", style: "short", extra: "headset" } },
  { id: "bi", room: 2, name: "Bia", title: "Analista de Dados", roomName: "Business Intelligence", specialty: "Indicadores, comparação entre lojas e relatórios.", tools: ["get_sales_summary", "compare_store_performance", "generate_report"], module: "relatorios", look: { hair: "#6b3e26", skin: "#f1c27d", shirt: "#0f8b8d", style: "long", extra: "glasses" } },
  { id: "comercial", room: 3, name: "Caio", title: "Especialista Comercial", roomName: "Comercial", specialty: "Metas, vendedores, ticket médio, conversão e projeções.", tools: ["get_goal_status", "get_salesperson_metrics"], module: "metas", look: { hair: "#1b1b1b", skin: "#8d5524", shirt: "#c2410c", style: "short", extra: "tie" } },
  { id: "estoque", room: 4, name: "Duda", title: "Especialista de Estoque", roomName: "Estoque e Logística", specialty: "Ruptura, excesso, giro, reposição e transferências.", tools: ["get_inventory_alerts"], module: "estoque", look: { hair: "#a0522d", skin: "#e0ac69", shirt: "#4d7c0f", style: "long", extra: "cap" } },
  { id: "financeiro", room: 5, name: "Iara", title: "Analista Financeira", roomName: "Financeiro", specialty: "Margens, recebimentos, despesas cadastradas e divergências.", tools: ["get_financial_summary"], module: "caixa", look: { hair: "#111827", skin: "#a86b3c", shirt: "#7c3aed", style: "bun", extra: "glasses" } },
  { id: "atendimento", room: 6, name: "Léo", title: "Especialista de Atendimento", roomName: "Atendimento", specialty: "Fila, espera, desistências, conversão e distribuição.", tools: ["get_queue_metrics"], module: "fila", look: { hair: "#d4a373", skin: "#f5d0a9", shirt: "#db2777", style: "short", extra: "headset" } },
  { id: "operacoes", room: 7, name: "Rui", title: "Especialista Operacional", roomName: "Operações e Auditoria", specialty: "Caixas, cancelamentos, pendências e divergências.", tools: ["get_cash_register_status"], module: "caixa", look: { hair: "#4b5563", skin: "#d39b6a", shirt: "#334155", style: "short", extra: "glasses" } },
  { id: "conhecimento", room: 8, name: "Sofia", title: "Especialista de Procedimentos", roomName: "Conhecimento", specialty: "Manuais, políticas internas e dúvidas operacionais, sempre com a fonte.", tools: ["search_company_procedures"], module: null, look: { hair: "#7f1d1d", skin: "#f3c6a5", shirt: "#0e7490", style: "long", extra: null } },
];

export const STATE_LABELS = {
  disponivel: "Disponível",
  analisando: "Analisando",
  executando: "Executando tarefa",
  gerando_relatorio: "Gerando relatório",
  aguardando_aprovacao: "Aguardando aprovação",
  concluido: "Concluído",
  erro: "Erro",
  indisponivel: "Indisponível",
  desatualizado: "Desatualizado",
};

export const RUN_STATUS = {
  em_execucao: "em execução",
  concluida: "concluída",
  erro: "com erro",
  aguardando_aprovacao: "aguardando aprovação",
  cancelada: "cancelada",
};

export const STATE_HINTS = {
  disponivel: "Pronto para receber tarefas.",
  analisando: "Consultando dados por uma ferramenta autorizada.",
  executando: "Coordenando uma execução em andamento.",
  gerando_relatorio: "Montando um relatório com os resultados dos especialistas.",
  aguardando_aprovacao: "Há recomendação esperando decisão humana.",
  concluido: "Terminou uma etapa há menos de 20 segundos.",
  erro: "A última etapa falhou; veja o histórico.",
  indisponivel: "Agente desabilitado nesta empresa.",
  desatualizado: "Sem conexão com o servidor: mostrando o último estado conhecido.",
};

const RECENT_MS = 20_000;

export const isEnabled = (state, agentId) => state.agentsEnabled[agentId] !== false;

function stepsOf(state, agentId) {
  const steps = [];
  for (const run of state.runs) for (const step of run.steps) if (step.agentId === agentId) steps.push({ run, step });
  return steps;
}

/** State derived only from execution records (no randomness, no fake progress). */
export function agentState(state, agentId, now) {
  if (!isEnabled(state, agentId)) return "indisponivel";
  const steps = stepsOf(state, agentId);
  const running = steps.find(({ step }) => step.status === "em_execucao");
  if (running) return running.step.tool === "generate_report" ? "gerando_relatorio" : agentId === "central" ? "executando" : "analisando";
  if (agentId === "central" && state.runs.some((run) => run.status === "em_execucao")) return "executando";
  if (state.recommendations?.some((rec) => rec.agentId === agentId && rec.status === "pendente")) return "aguardando_aprovacao";
  const last = steps.filter(({ step }) => step.endedAt).sort((a, b) => b.step.endedAt - a.step.endedAt)[0];
  if (last?.step.status === "erro" && now - last.step.endedAt < 5 * 60_000) return "erro";
  if (last && now - last.step.endedAt < RECENT_MS) return "concluido";
  return "disponivel";
}

/** One consistent snapshot for the office: the map, the list view and the counters read the same object. */
export function officeSnapshot(state, now) {
  const agents = AGENTS.map((agent) => {
    const steps = stepsOf(state, agent.id).sort((a, b) => (b.step.startedAt ?? 0) - (a.step.startedAt ?? 0));
    const running = steps.find(({ step }) => step.status === "em_execucao");
    const pending = (state.recommendations ?? []).filter((rec) => rec.agentId === agent.id && rec.status === "pendente");
    const last = steps.find(({ step }) => step.endedAt);
    return {
      ...agent,
      state: agentState(state, agent.id, now),
      task: running ? running.step.label : pending.length ? `${pending.length} recomendação(ões) aguardando aprovação` : null,
      lastActivity: last?.step.endedAt ?? null,
      history: steps.slice(0, 8).map(({ run, step }) => ({ runId: run.id, question: run.question, kind: run.kind, ...step })),
      pending,
    };
  });
  const connections = [];
  for (const run of state.runs) {
    for (const step of run.steps) {
      if (step.status === "em_execucao" && step.agentId !== "central") connections.push({ from: "central", to: step.agentId, runId: run.id, label: step.label });
    }
  }
  const allSteps = state.runs.flatMap((run) => run.steps);
  return {
    takenAt: now,
    agents,
    connections,
    counters: {
      enabled: agents.filter((a) => a.state !== "indisponivel").length,
      available: agents.filter((a) => a.state === "disponivel").length,
      running: agents.filter((a) => ["analisando", "executando", "gerando_relatorio"].includes(a.state)).length,
      completed: allSteps.filter((s) => s.status === "concluida").length,
      awaiting: (state.recommendations ?? []).filter((rec) => rec.status === "pendente").length,
      errors: allSteps.filter((s) => s.status === "erro").length,
    },
  };
}
