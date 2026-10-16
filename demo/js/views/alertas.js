// Alerts from deterministic rules, tasks with owner/deadline/priority/history, and the audit trail.
import { AGENTS } from "../agents.js";
import { STORE_MANAGERS, STORES } from "../catalog.js";
import { dateTime, dayKey } from "../lib.js";
import { store } from "../app-store.js";
import { createTask, PRIORITIES, resolveAlert, TASK_STATUS, updateTask } from "../ops.js";
import { runMonitoring } from "../orchestrator.js";
import { AUDIT_LABELS } from "../store.js";
import { AccessDenied, attempt, Badge, Card, DataTable, Field, html, PageHeader, SEVERITY, useState } from "../ui.js";

const storeName = (id) => STORES.find((s) => s.id === id)?.name ?? "—";
const TASK_TONE = { aberta: "attention", andamento: "info", concluida: "positive" };

export function Alertas() {
  return store.can("alerts.read") || store.can("tasks.own") ? html`<${AlertasView} />` : html`<${AccessDenied} what="Alertas e tarefas" />`;
}

function AlertasView() {
  const { state } = store;
  const viewer = store.viewer();
  const [taskFor, setTaskFor] = useState(null);
  const [form, setForm] = useState(null);
  const [notes, setNotes] = useState({});
  const canManage = store.can("tasks.manage");
  const alerts = store.can("alerts.read") ? state.alerts.filter((a) => viewer.storeIds.includes(a.storeId)) : [];
  const open = alerts.filter((a) => a.status === "aberto");
  const tasks = state.tasks.filter((t) => (canManage ? !t.storeId || viewer.storeIds.includes(t.storeId) : t.assignee === viewer.name));
  const routineRunning = state.runs.some((r) => r.kind === "rotina" && r.status === "em_execucao");
  const lastRoutine = state.runs.find((r) => r.kind === "rotina" && r.endedAt);

  const startTask = (alert) => {
    setTaskFor(alert.id);
    setForm({ title: `${alert.rule} · ${storeName(alert.storeId)}`, assignee: STORE_MANAGERS[alert.storeId], due: dayKey(Date.now() + 2 * 86_400_000), priority: alert.severity === "alta" ? "alta" : "media", description: alert.detail });
  };
  const saveTask = (alert) => {
    const ok = attempt(store, () => createTask(store, { ...form, origin: `Alerta ${alert.id}`, storeId: alert.storeId }), "Tarefa criada.");
    if (ok) {
      setTaskFor(null);
      setForm(null);
    }
  };

  return html`<div className="view">
    <${PageHeader}
      title="Alertas e tarefas"
      subtitle=${lastRoutine ? `Última rotina de monitoramento: ${dateTime(lastRoutine.endedAt)} (${lastRoutine.id})` : "A rotina de monitoramento ainda não terminou"}
      actions=${canManage ? html`<button type="button" className="btn btn--secondary" disabled=${routineRunning} onClick=${() => attempt(store, () => runMonitoring(store), "Rotina iniciada; acompanhe no Escritório virtual.")}>${routineRunning ? "Rotina em execução…" : "Executar rotina agora"}</button>` : null}
    />
    ${store.can("alerts.read")
      ? html`<${Card} title=${`Alertas abertos (${open.length})`} subtitle="Regras determinísticas; a mesma situação atualiza o alerta em vez de duplicar">
          ${open.length === 0 ? html`<p className="empty">Nenhum alerta aberto no seu acesso.</p>` : null}
          <ul className="alert-list alert-list--full">
            ${open.map((a) => html`<li key=${a.id}>
              <${Badge} tone=${SEVERITY[a.severity].tone}>${SEVERITY[a.severity].label}<//>
              <div className="alert-list__body">
                <div><strong>${a.rule}</strong> · ${storeName(a.storeId)}</div>
                <p className="muted small">${a.detail}</p>
                <p className="muted small">Detectado em ${dateTime(a.detectedAt)} por ${AGENTS.find((x) => x.id === a.agentId).title}</p>
                ${taskFor === a.id && form
                  ? html`<div className="form-grid">
                      <${Field} label="Título" id=${`t-${a.id}`}><input id=${`t-${a.id}`} value=${form.title} onChange=${(e) => setForm({ ...form, title: e.target.value })} /><//>
                      <${Field} label="Responsável" id=${`r-${a.id}`}><input id=${`r-${a.id}`} value=${form.assignee} onChange=${(e) => setForm({ ...form, assignee: e.target.value })} /><//>
                      <${Field} label="Prazo" id=${`p-${a.id}`}><input id=${`p-${a.id}`} type="date" value=${form.due} onChange=${(e) => setForm({ ...form, due: e.target.value })} /><//>
                      <${Field} label="Prioridade" id=${`pr-${a.id}`}><select id=${`pr-${a.id}`} value=${form.priority} onChange=${(e) => setForm({ ...form, priority: e.target.value })}>${Object.entries(PRIORITIES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
                      <div className="actions">
                        <button type="button" className="btn btn--primary btn--small" onClick=${() => saveTask(a)}>Criar tarefa</button>
                        <button type="button" className="btn btn--ghost btn--small" onClick=${() => setTaskFor(null)}>Voltar</button>
                      </div>
                    </div>`
                  : null}
              </div>
              ${canManage && taskFor !== a.id
                ? html`<div className="alert-list__actions">
                    <button type="button" className="btn btn--secondary btn--small" onClick=${() => startTask(a)}>Criar tarefa</button>
                    <button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => resolveAlert(store, a.id), "Alerta marcado como resolvido.")}>Resolver</button>
                  </div>`
                : null}
            </li>`)}
          </ul>
        <//>`
      : null}
    <${Card} title=${canManage ? "Central de tarefas" : "Minhas tarefas"} subtitle="Recomendações viram tarefa só por ação humana">
      ${tasks.length === 0 ? html`<p className="empty">${canManage ? "Nenhuma tarefa ainda. Crie a partir de um alerta ou aprove uma recomendação de agente." : "Nenhuma tarefa atribuída a você."}</p>` : null}
      <ul className="tasks">
        ${tasks.map((t) => html`<li key=${t.id}>
          <div className="tasks__head">
            <strong>${t.title}</strong>
            <${Badge} tone=${TASK_TONE[t.status]}>${TASK_STATUS[t.status]}<//>
            <${Badge} tone=${t.priority === "alta" ? "critical" : t.priority === "media" ? "attention" : "neutral"} icon=${false}>Prioridade ${PRIORITIES[t.priority].toLowerCase()}<//>
          </div>
          <p className="muted small">${t.assignee} · prazo ${t.due.split("-").reverse().join("/")} · ${t.storeId ? storeName(t.storeId) : "Rede"} · origem: ${t.origin}</p>
          ${t.description ? html`<p className="small">${t.description}</p>` : null}
          <div className="form-grid form-grid--inline">
            <input aria-label=${`Nota para ${t.title}`} placeholder="Nota (opcional)" value=${notes[t.id] ?? ""} onChange=${(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
            ${Object.entries(TASK_STATUS).filter(([k]) => k !== t.status).map(([k, v]) => html`<button key=${k} type="button" className="btn btn--ghost btn--small" onClick=${() => { if (attempt(store, () => updateTask(store, t.id, k, notes[t.id]), "Tarefa atualizada.")) setNotes({ ...notes, [t.id]: "" }); }}>${v}</button>`)}
          </div>
          <details><summary>Histórico (${t.history.length})</summary><ul className="plain">${t.history.map((h, i) => html`<li key=${i}><span>${h.text}</span><small className="muted">${h.by} · ${dateTime(h.at)}</small></li>`)}</ul></details>
        </li>`)}
      </ul>
    <//>
  </div>`;
}

export function Auditoria() {
  if (!store.can("audit.read")) return html`<${AccessDenied} what="Auditoria" />`;
  const entries = store.state.audit.slice(0, 60);
  const detail = (d) => Object.entries(d).map(([k, v]) => `${k}: ${typeof v === "number" && /valor|líquido|fundo|contado|divergência/.test(k) ? (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : v}`).join(" · ");
  return html`<div className="view">
    <${PageHeader} title="Auditoria" subtitle="Toda ação da demonstração gera um registro imutável com responsável e campos de negócio" />
    <${Card}>
      <${DataTable} columns=${["Quando", "Quem", "Ação", "Registro", "Detalhes"]} rows=${entries.map((e) => [dateTime(e.at), e.actor, AUDIT_LABELS[e.action] ?? e.action, e.entity, detail(e.details)])} />
    <//>
  </div>`;
}
