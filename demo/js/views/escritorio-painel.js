// Selected-agent panel, accessible list view and activity log of the virtual office.
import { AGENTS, RUN_STATUS, STATE_LABELS } from "../agents.js";
import { dateTime, timeSeconds } from "../lib.js";
import { go, store } from "../app-store.js";
import { cancelRun, decideRecommendation, rerun, toggleAgent } from "../orchestrator.js";
import { drawFront } from "../sprites.js";
import { attempt, Badge, html, useEffect, useRef } from "../ui.js";

export const STATE_TONE = { disponivel: "positive", analisando: "info", executando: "info", gerando_relatorio: "info", aguardando_aprovacao: "attention", concluido: "positive", erro: "critical", indisponivel: "neutral", desatualizado: "neutral" };
const STEP_LABEL = { pendente: "na fila", em_execucao: "em execução", concluida: "concluída", bloqueada: "bloqueada", erro: "erro", cancelada: "cancelada" };
const MODULES = { assistente: "Assistente IA", relatorios: "Relatórios", metas: "Metas", estoque: "Estoque", caixa: "Caixa", fila: "Fila" };

/** Only managers see other people's questions; everyone sees the automatic routine. */
const visibleRun = (h) => store.can("tasks.manage") || h.kind === "rotina" || store.state.runs.find((r) => r.id === h.runId)?.viewerId === store.viewer().id;

function Avatar({ look, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = ref.current.getContext("2d");
    ctx.clearRect(0, 0, 16, 20);
    drawFront(ctx, 2, 3, look, 0, muted);
  }, [look, muted]);
  return html`<canvas ref=${ref} width="16" height="20" className="avatar" aria-hidden="true"></canvas>`;
}

export function AgentPanel({ agent, stale, hint }) {
  const state = stale ? "desatualizado" : agent.state;
  const history = agent.history.filter(visibleRun);
  const running = store.state.runs.find((r) => r.status === "em_execucao" && r.steps.some((s) => s.agentId === agent.id) && (store.can("tasks.manage") || r.viewerId === store.viewer().id));
  const last = history.find((h) => h.endedAt);
  const lastRun = last ? store.state.runs.find((r) => r.id === last.runId) : null;
  const canDecide = store.can("recommendations.approve");
  const enabled = agent.state !== "indisponivel";

  return html`<aside className="agent-panel" aria-label=${`Agente ${agent.name}`}>
    <header>
      <${Avatar} look=${agent.look} muted=${state === "indisponivel" || stale} />
      <div>
        <h2>${agent.name}</h2>
        <p>${agent.title} · sala ${agent.room} (${agent.roomName})</p>
        <small className="muted">id técnico: agent.${agent.id}</small>
      </div>
    </header>
    <p>${agent.specialty}</p>
    <div className="agent-panel__state">
      <${Badge} tone=${STATE_TONE[state]}>${STATE_LABELS[state]}<//>
      <span className="muted small">${hint}</span>
    </div>
    <dl className="facts">
      <div><dt>Tarefa em andamento</dt><dd>${stale ? "Desconhecida (sem conexão)" : agent.task ?? "Nenhuma"}</dd></div>
      <div><dt>Última atividade</dt><dd>${agent.lastActivity ? dateTime(agent.lastActivity) : "Sem execuções ainda"}</dd></div>
      <div><dt>Ferramentas</dt><dd>${agent.tools.length ? agent.tools.join(", ") : "Orquestração (sem ferramenta de dados)"}</dd></div>
      <div><dt>Custo estimado</dt><dd>${store.can("office.costs") ? "Não se aplica: nenhum modelo chamado" : "Restrito ao proprietário"}</dd></div>
    </dl>
    ${agent.pending.length
      ? html`<div className="agent-panel__pending">
          <h3>Aguardando aprovação</h3>
          <ul>${agent.pending.map((rec) => html`<li key=${rec.id}>
            <span>${rec.text}</span>
            ${canDecide && !stale
              ? html`<span className="actions">
                  <button type="button" className="btn btn--secondary btn--small" onClick=${() => attempt(store, () => decideRecommendation(store, rec.id, true), "Recomendação aprovada.")}>Aprovar</button>
                  <button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => decideRecommendation(store, rec.id, false), "Recomendação rejeitada.")}>Rejeitar</button>
                </span>`
              : html`<small className="muted">${stale ? "Disponível após reconectar." : "Aprovação exige perfil de gestão."}</small>`}
          </li>`)}</ul>
        </div>`
      : null}
    <div className="actions actions--wrap">
      <button type="button" className="btn btn--primary btn--small" disabled=${!store.can("ai.use")} onClick=${() => go("assistente", { agentId: agent.id })}>Conversar</button>
      <button type="button" className="btn btn--secondary btn--small" onClick=${() => go("alertas")}>Ver tarefas</button>
      ${agent.module ? html`<button type="button" className="btn btn--secondary btn--small" onClick=${() => go(agent.module)}>Abrir ${MODULES[agent.module]}</button>` : null}
      ${lastRun && lastRun.status !== "em_execucao" && !stale ? html`<button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => rerun(store, lastRun.id), "Execução repetida.")}>Reexecutar última</button>` : null}
      ${running && !stale ? html`<button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => cancelRun(store, running.id), "Execução cancelada.")}>Cancelar execução</button>` : null}
      ${store.can("office.manage") && agent.id !== "central" ? html`<button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => toggleAgent(store, agent.id), enabled ? "Agente desabilitado." : "Agente habilitado.")}>${enabled ? "Desabilitar" : "Habilitar"}</button>` : null}
    </div>
    <h3>Histórico recente</h3>
    ${history.length === 0 ? html`<p className="empty">Sem etapas registradas para este agente.</p>` : null}
    <ol className="history">
      ${history.map((h) => html`<li key=${`${h.runId}-${h.id}`}>
        <div><strong>${h.label}</strong> <${Badge} tone=${h.status === "erro" ? "critical" : h.status === "bloqueada" ? "attention" : h.status === "concluida" ? "positive" : "info"} icon=${false}>${STEP_LABEL[h.status]}<//></div>
        <small className="muted">${h.runId} · ${h.kind === "rotina" ? "rotina automática" : `“${h.question}”`} · ${h.startedAt ? timeSeconds(h.startedAt) : "—"}</small>
        ${h.output?.facts?.[0] ? html`<p className="small">${h.output.facts[0]}</p>` : null}
        ${h.output?.blocked ? html`<p className="small text-attention">${h.output.reason}</p>` : null}
        ${h.error ? html`<p className="small text-critical">Erro: ${h.error}</p>` : null}
      </li>`)}
    </ol>
  </aside>`;
}

export function AgentList({ agents, stale, selectedId, onSelect }) {
  return html`<div className="table-wrap">
    <table>
      <caption className="sr-only">Agentes do escritório virtual</caption>
      <thead><tr><th scope="col">Agente</th><th scope="col">Sala</th><th scope="col">Estado</th><th scope="col">Tarefa atual</th><th scope="col">Última atividade</th><th scope="col"></th></tr></thead>
      <tbody>
        ${agents.map((a) => {
          const st = stale ? "desatualizado" : a.state;
          return html`<tr key=${a.id} className=${a.id === selectedId ? "is-selected" : ""}>
            <td><strong>${a.name}</strong><small className="block muted">${a.title}</small></td>
            <td>${a.room} · ${a.roomName}</td>
            <td><${Badge} tone=${STATE_TONE[st]}>${STATE_LABELS[st]}<//></td>
            <td>${stale ? "Desconhecida" : a.task ?? "—"}</td>
            <td>${a.lastActivity ? timeSeconds(a.lastActivity) : "—"}</td>
            <td><button type="button" className="btn btn--ghost btn--small" onClick=${() => onSelect(a.id)}>Detalhes</button></td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

export function ActivityLog() {
  const runs = store.state.runs.filter((r) => store.can("tasks.manage") || r.kind === "rotina" || r.viewerId === store.viewer().id).slice(0, 8);
  const name = (id) => AGENTS.find((a) => a.id === id).name;
  return html`<section className="card activity">
    <header className="card__header"><div><h2>Histórico de atividades</h2><p className="card__subtitle">Delegações reais: coordenador → especialista, por execução</p></div></header>
    <div className="card__body">
      ${runs.length === 0 ? html`<p className="empty">Nenhuma execução ainda.</p>` : null}
      <ul className="activity__list">
        ${runs.map((r) => html`<li key=${r.id}>
          <div><strong>${r.id}</strong> · ${r.kind === "rotina" ? "Rotina de monitoramento" : `“${r.question}”`}</div>
          <small className="muted">${dateTime(r.createdAt)} · ${RUN_STATUS[r.status]}</small>
          <p className="small">${[...new Set(r.steps.filter((s) => s.agentId !== "central").map((s) => `${name("central")} → ${name(s.agentId)} (${s.tool}, ${STEP_LABEL[s.status]})`))].join(" · ") || "Sem delegação"}</p>
        </li>`)}
      </ul>
    </div>
  </section>`;
}
