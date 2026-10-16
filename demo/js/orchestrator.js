// Central agent of the demo: routes a question to specialists and their tools, runs
// the steps, consolidates facts/hypotheses/recommendations and records everything.
// Routing uses local rules (no language model is called in the demo).
import { AGENTS, isEnabled } from "./agents.js";
import { STORES } from "./catalog.js";
import { normalize, brl, pct, minutesLabel, dayKey } from "./lib.js";
import * as m from "./metrics.js";
import { createTask, requestTransfer } from "./ops.js";
import { DemoError, VIEWERS } from "./store.js";
import { TOOLS } from "./tools.js";

export const SUGGESTED_QUESTIONS = [
  "Como estão as vendas hoje?",
  "Quais lojas estão abaixo da meta?",
  "Compare o faturamento deste mês com o anterior.",
  "Quais produtos correm risco de ruptura?",
  "Quais vendedores precisam de acompanhamento?",
  "Onde o tempo de espera aumentou?",
  "Gere o relatório executivo da semana.",
  "Qual a política de descontos?",
];

// Minimum visible duration of each step, only so the office animation can be followed.
let stepMs = 900;
export const setStepDelay = (ms) => (stepMs = ms);
const wait = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

const DOMAINS = [
  { key: "estoque", test: /estoque|ruptura|repor|reposic|excesso|transfer|giro|produto/, agentId: "estoque", tool: "get_inventory_alerts" },
  { key: "metas", test: /\bmetas?\b/, agentId: "comercial", tool: "get_goal_status", period: "mes" },
  { key: "vendedores", test: /vendedor|equipe|acompanhamento|ranking/, agentId: "comercial", tool: "get_salesperson_metrics", period: "mes" },
  { key: "fila", test: /espera|fila|desist|conversao|atendiment/, agentId: "atendimento", tool: "get_queue_metrics", period: "7d" },
  { key: "caixa", test: /caixa|divergen|fechamento|sangria|cancela/, agentId: "operacoes", tool: "get_cash_register_status" },
  { key: "financeiro", test: /margem|lucro|recebiment|financ|custo|despesa/, agentId: "financeiro", tool: "get_financial_summary", period: "mes" },
  { key: "lojas", test: /\blojas\b|filiais/, agentId: "bi", tool: "compare_store_performance", period: "mes" },
  { key: "vendas", test: /venda|fatur|ticket|como estao|resultado|desempenho/, agentId: "bi", tool: "get_sales_summary", period: "hoje" },
];
const PROCEDURE = /politica|procedimento|como (faco|devo|fazer|abro|fecho|abrir|fechar|registr)|posso|regra|manual|norma|permitid|lei /;

export function parsePeriod(text, fallback) {
  const t = normalize(text);
  if (/\bontem\b/.test(t)) return "ontem";
  if (/\bhoje\b|agora/.test(t)) return "hoje";
  if (/semana|7 dias/.test(t)) return "7d";
  if (/30 dias/.test(t)) return "30d";
  if (/mes (passado|anterior)/.test(t) && !/(este|deste|neste) mes|mes atual/.test(t)) return "mes_anterior";
  if (/\bmes\b|mensal/.test(t)) return "mes";
  return fallback;
}

/** Which specialists and tools answer a question; agentId narrows to one specialist. */
export function planQuestion(question, agentId) {
  const t = normalize(question);
  const forced = agentId && agentId !== "central" ? AGENTS.find((a) => a.id === agentId) : null;
  if (/relatorio|resumo executivo/.test(t) && (!forced || forced.id === "bi")) {
    const period = parsePeriod(question, "7d");
    const steps = [["bi", "get_sales_summary"], ["comercial", "get_goal_status"], ["estoque", "get_inventory_alerts"], ["atendimento", "get_queue_metrics"], ["operacoes", "get_cash_register_status"], ["bi", "generate_report"]];
    return { kind: "relatorio", period, steps: steps.map(([a, tool]) => ({ agentId: a, tool, params: { period } })) };
  }
  if ((PROCEDURE.test(t) && !forced) || forced?.id === "conhecimento") {
    return { kind: "conversa", period: null, steps: [{ agentId: "conhecimento", tool: "search_company_procedures", params: { query: question } }] };
  }
  let matched = DOMAINS.filter((d) => d.test.test(t) && (!forced || d.agentId === forced.id));
  if (matched.some((d) => d.key === "metas")) matched = matched.filter((d) => d.key !== "lojas" && d.key !== "vendas");
  if (matched.length === 0 && forced) matched = DOMAINS.filter((d) => d.agentId === forced.id).slice(0, 1);
  const unique = matched.filter((d, i) => matched.findIndex((x) => x.tool === d.tool) === i);
  const period = parsePeriod(question, unique[0]?.period ?? "hoje");
  return { kind: "conversa", period, steps: unique.map((d) => ({ agentId: d.agentId, tool: d.tool, params: { period: parsePeriod(question, d.period ?? period) } })) };
}

const agentName = (id) => AGENTS.find((a) => a.id === id);

function newRun(store, { kind, question, period, steps, agentId, viewerId }) {
  const { state } = store;
  const run = {
    id: `run-${String(state.runs.length + 1).padStart(4, "0")}`,
    kind,
    question,
    agentId: agentId ?? null,
    viewerId,
    createdAt: Date.now(),
    status: "em_execucao",
    period,
    steps: [
      { agentId: "central", tool: "interpretar", label: kind === "rotina" ? "Iniciar rotina de monitoramento" : "Interpretar o pedido, o período e as permissões" },
      ...steps.map((s) => ({ ...s, label: `${TOOLS[s.tool]?.label ?? "Relatório executivo"} (${s.tool})` })),
      { agentId: "central", tool: "consolidar", label: kind === "rotina" ? "Registrar alertas" : "Consolidar a resposta" },
    ].map((s, i) => ({ id: `step-${i + 1}`, status: "pendente", startedAt: null, endedAt: null, output: null, error: null, ...s })),
    answer: null,
  };
  state.runs.unshift(run);
  store.commit();
  return run;
}

export function ask(store, question, { agentId } = {}) {
  store.assertCan("ai.use", "Seu perfil não usa o assistente.");
  const text = String(question ?? "").trim();
  if (text.length < 3) throw new DemoError("Escreva a pergunta.");
  if (text.length > 400) throw new DemoError("Pergunta longa demais (máximo de 400 caracteres).");
  const plan = planQuestion(text, agentId);
  const run = newRun(store, { ...plan, question: text, agentId, viewerId: store.viewer().id });
  return { run, done: execute(store, run) };
}

export function runMonitoring(store) {
  const steps = [["operacoes", "get_cash_register_status"], ["estoque", "get_inventory_alerts"], ["comercial", "get_goal_status"], ["atendimento", "get_queue_metrics"]];
  const run = newRun(store, { kind: "rotina", question: "Rotina de monitoramento", period: "hoje", viewerId: "owner", steps: steps.map(([agentId, tool]) => ({ agentId, tool, params: { period: "7d" } })) });
  return { run, done: execute(store, run) };
}

async function execute(store, run) {
  const { state } = store;
  const viewer = VIEWERS.find((v) => v.id === run.viewerId);
  const ctx = { state, scope: { storeIds: viewer.storeIds, sellerId: viewer.sellerId ?? undefined }, can: (p) => viewer.permissions.has(p), viewer };
  for (const step of run.steps) {
    if (run.status === "cancelada") return run;
    Object.assign(step, { status: "em_execucao", startedAt: Date.now() });
    store.commit();
    await wait(stepMs);
    if (run.status === "cancelada") break;
    try {
      const output = runStep(store, run, step, { ...ctx, now: Date.now(), params: step.params ?? {} });
      Object.assign(step, { output, status: output?.blocked ? "bloqueada" : "concluida" });
    } catch (error) {
      Object.assign(step, { status: "erro", error: error instanceof Error ? error.message : String(error) });
    }
    step.endedAt = Date.now();
    store.commit();
  }
  if (run.status !== "cancelada") {
    const pending = state.recommendations.some((r) => r.runId === run.id && r.status === "pendente");
    run.status = run.steps.some((s) => s.status === "erro") ? "erro" : pending ? "aguardando_aprovacao" : "concluida";
  }
  run.endedAt = Date.now();
  store.commit();
  return run;
}

function runStep(store, run, step, ctx) {
  if (step.tool === "interpretar") {
    const names = [...new Set(run.steps.filter((s) => s.agentId !== "central").map((s) => agentName(s.agentId).title))];
    return { facts: [names.length ? `Especialistas acionados: ${names.join(", ")}.` : "Nenhum especialista corresponde ao pedido."] };
  }
  if (step.tool === "consolidar") return run.kind === "rotina" ? recordAlerts(store, run, ctx.now) : consolidate(store, run, ctx);
  if (!isEnabled(ctx.state, step.agentId)) return { blocked: true, reason: `${agentName(step.agentId).title} está desabilitado nesta empresa.` };
  if (step.tool === "generate_report") return generateReport(store, run, ctx);
  const output = TOOLS[step.tool].run(ctx);
  if (output.blocked) return output;
  for (const rec of output.recommendations) {
    if (!rec.approval) continue;
    const same = ctx.state.recommendations.find((r) => r.status === "pendente" && r.text === rec.text);
    if (same) {
      rec.id = same.id;
      continue;
    }
    const id = `rec-${ctx.state.recommendations.length + 1}`;
    ctx.state.recommendations.push({ id, runId: run.id, agentId: step.agentId, text: rec.text, approval: rec.approval, status: "pendente", createdAt: ctx.now });
    rec.id = id;
  }
  return output;
}

function consolidate(store, run, ctx) {
  const outputs = run.steps.filter((s) => s.agentId !== "central" && s.output);
  const blocks = outputs.filter((s) => !s.output.blocked && s.tool !== "generate_report").map((s) => ({ agentId: s.agentId, tool: s.tool, ...s.output }));
  const blockedList = outputs.filter((s) => s.output.blocked).map((s) => ({ agentId: s.agentId, tool: s.tool, reason: s.output.reason }));
  const report = outputs.find((s) => s.tool === "generate_report" && !s.output.blocked);
  const periodLabel = run.period ? m.PERIODS[run.period] : null;
  const answer = {
    headline: blocks[0]?.facts[0] ?? (blockedList.length ? "Não consegui consultar os dados pedidos com o seu perfil." : "Não identifiquei um assunto que eu saiba consultar."),
    blocks,
    blocked: blockedList,
    reportId: report?.output.reportId ?? null,
    filters: [ctx.viewer.scopeLabel, periodLabel, ...new Set(blocks.flatMap((b) => b.filters ?? []))].filter(Boolean),
    sources: [...new Set(blocks.flatMap((b) => b.sources ?? [])), `Ferramentas: ${[...new Set(blocks.map((b) => b.tool))].join(", ") || "nenhuma"}`, m.SOURCE],
    limitations: [...new Set(blocks.flatMap((b) => b.limitations ?? [])), "Demonstração: a resposta é montada por regras locais a partir das ferramentas; nenhum modelo de IA foi chamado."],
    suggestions: blocks.length || blockedList.length ? [] : ["Pergunte sobre vendas, metas, vendedores, estoque, fila, caixas, margem ou procedimentos."],
  };
  run.answer = answer;
  return { facts: [answer.headline] };
}

function generateReport(store, run, ctx) {
  if (!ctx.can("reports.read")) return { blocked: true, reason: "Gerar relatórios exige perfil de gestão." };
  const sections = run.steps.filter((s) => s.output && !s.output.blocked && TOOLS[s.tool]).map((s) => ({ agentId: s.agentId, title: TOOLS[s.tool].label, ...s.output }));
  const report = {
    id: `rep-${ctx.state.reports.length + 1}`,
    title: `Relatório executivo — ${m.PERIODS[run.period].toLowerCase()}`,
    createdAt: ctx.now,
    runId: run.id,
    author: ctx.viewer.name,
    scopeLabel: ctx.viewer.scopeLabel,
    period: run.period,
    sections,
    methodology: ["Indicadores calculados pelas mesmas funções dos painéis.", "Reflete os dados disponíveis no momento da geração.", "Dados fictícios da demonstração."],
  };
  ctx.state.reports.unshift(report);
  return { facts: [`Relatório gerado com ${sections.length} seções.`], reportId: report.id };
}

/** Deterministic alert rules; the same situation updates its alert instead of duplicating it. */
function recordAlerts(store, run, now) {
  const { state } = store;
  const all = { storeIds: STORES.map((s) => s.id) };
  const found = [];
  const add = (key, fields) => found.push({ key, ...fields });
  for (const shop of STORES) {
    const g = m.goalProgress(state, now, shop.id);
    if (g && g.projectionRatio < 0.95) add(`meta:${shop.id}`, { rule: "Meta em risco", agentId: "comercial", storeId: shop.id, severity: g.projectionRatio < 0.85 ? "alta" : "media", detail: `Projeção de ${pct(g.projectionRatio, 0)} da meta; ritmo necessário ${brl(g.pace)} por dia.` });
    const today = m.queueMetrics(state, m.periodRange("hoje", now), { storeIds: [shop.id] });
    const week = m.queueMetrics(state, m.periodRange("7d", now), { storeIds: [shop.id] });
    const before = m.queueMetrics(state, m.periodRange("7d", now).previous, { storeIds: [shop.id] });
    if ((today.avgWait ?? 0) > 12 || (week.avgWait && before.avgWait && week.avgWait > before.avgWait * 1.3)) {
      add(`espera:${shop.id}`, { rule: "Tempo de espera elevado", agentId: "atendimento", storeId: shop.id, severity: "media", detail: `Espera média de ${minutesLabel(week.avgWait)} nos últimos 7 dias (antes ${minutesLabel(before.avgWait)}).` });
    }
  }
  for (const a of m.inventoryAlerts(state, all, now).alerts.filter((x) => x.status !== "excesso")) {
    add(`estoque:${a.storeId}:${a.product.id}`, { rule: a.status === "ruptura" ? "Ruptura de estoque" : "Estoque crítico", agentId: "estoque", storeId: a.storeId, severity: a.status === "ruptura" ? "alta" : "media", detail: `${a.product.name} ${a.product.variant}: saldo ${a.balance}, mínimo ${a.product.minStock}.` });
  }
  for (const c of m.cashStatus(state, all, now)) {
    for (const p of c.pending) add(`caixa:${p.id}`, { rule: "Caixa pendente", agentId: "operacoes", storeId: c.store.id, severity: "alta", detail: `Fechamento de ${p.day.split("-").reverse().join("/")} não realizado.` });
    for (const d of c.divergent) add(`divergencia:${d.session.id}`, { rule: "Divergência de caixa", agentId: "operacoes", storeId: c.store.id, severity: Math.abs(d.diff) > 5000 ? "alta" : "media", detail: `Diferença de ${brl(d.diff)} no fechamento de ${d.session.day.split("-").reverse().join("/")}.` });
  }
  let created = 0;
  for (const alert of found) {
    const existing = state.alerts.find((a) => a.key === alert.key && a.status === "aberto");
    if (existing) Object.assign(existing, { detail: alert.detail, lastSeenAt: now, runId: run.id });
    else {
      state.alerts.unshift({ id: `alert-${state.alerts.length + 1}`, ...alert, status: "aberto", detectedAt: now, lastSeenAt: now, day: dayKey(now), runId: run.id });
      created += 1;
    }
  }
  return { facts: [`${found.length} situação(ões) em alerta; ${created} nova(s).`] };
}

export function decideRecommendation(store, recId, approve) {
  store.assertCan("recommendations.approve", "Aprovar recomendações exige perfil de gestão.");
  const rec = store.state.recommendations.find((r) => r.id === recId);
  if (!rec) throw new DemoError("Recomendação não encontrada.");
  if (rec.status !== "pendente") throw new DemoError("Esta recomendação já foi decidida.");
  if (approve) {
    const due = dayKey(Date.now() + 3 * 86_400_000);
    if (rec.approval.type === "transfer") requestTransfer(store, { ...rec.approval, origin: rec.id });
    else createTask(store, { title: rec.approval.title, description: rec.text, assignee: rec.approval.assignee, due, priority: "media", origin: `Recomendação ${rec.id}`, storeId: rec.approval.storeId });
  }
  Object.assign(rec, { status: approve ? "aprovada" : "rejeitada", decidedAt: Date.now(), decidedBy: store.viewer().name });
  const run = store.state.runs.find((r) => r.id === rec.runId);
  if (run?.status === "aguardando_aprovacao" && !store.state.recommendations.some((r) => r.runId === run.id && r.status === "pendente")) run.status = "concluida";
  store.audit(approve ? "recommendation.approved" : "recommendation.rejected", rec.text, { agente: agentName(rec.agentId).title });
  store.commit();
}

export function cancelRun(store, runId) {
  const run = store.state.runs.find((r) => r.id === runId);
  if (!run) throw new DemoError("Execução não encontrada.");
  if (run.viewerId !== store.viewer().id && !store.can("tasks.manage")) throw new DemoError("Você só cancela as próprias execuções.");
  if (run.status !== "em_execucao") throw new DemoError("Só execuções em andamento podem ser canceladas.");
  run.status = "cancelada";
  for (const step of run.steps) if (step.status === "em_execucao" || step.status === "pendente") Object.assign(step, { status: "cancelada", endedAt: Date.now() });
  store.audit("run.cancelled", run.question, { execução: run.id });
  store.commit();
}

export function rerun(store, runId) {
  const run = store.state.runs.find((r) => r.id === runId);
  if (!run || run.status === "em_execucao") throw new DemoError("Esta execução não pode ser repetida agora.");
  return run.kind === "rotina" ? runMonitoring(store) : ask(store, run.question, { agentId: run.agentId });
}

export function toggleAgent(store, agentId) {
  store.assertCan("office.manage", "Habilitar ou desabilitar agentes exige perfil de proprietário.");
  if (agentId === "central") throw new DemoError("O coordenador central não pode ser desabilitado.");
  const enabled = isEnabled(store.state, agentId);
  store.state.agentsEnabled[agentId] = !enabled;
  store.audit("agent.toggled", agentName(agentId).title, { situação: enabled ? "desabilitado" : "habilitado" });
  store.commit();
}
