// Conversational assistant: the question goes to the Central Coordinator, who calls
// specialists through authorized tools; each step is shown as it really runs.
import { AGENTS, RUN_STATUS } from "../agents.js";
import { time } from "../lib.js";
import { go, handoff, store } from "../app-store.js";
import { ask, cancelRun, rerun, SUGGESTED_QUESTIONS } from "../orchestrator.js";
import { AccessDenied, attempt, Badge, html, PageHeader, useEffect, useRef, useState } from "../ui.js";
import { Answer } from "./assistente-resposta.js";

const STEP = { pendente: ["neutral", "Na fila"], em_execucao: ["info", "Em execução"], concluida: ["positive", "Concluída"], bloqueada: ["attention", "Bloqueada"], erro: ["critical", "Erro"], cancelada: ["neutral", "Cancelada"] };
const agent = (id) => AGENTS.find((a) => a.id === id);

export function Assistente() {
  return store.can("ai.use") ? html`<${AssistenteView} />` : html`<${AccessDenied} what="Assistente IA" />`;
}

function AssistenteView() {
  const [agentId, setAgentId] = useState(() => {
    const id = handoff.agentId ?? "central";
    handoff.agentId = null;
    return id;
  });
  const [text, setText] = useState("");
  const endRef = useRef(null);
  const viewer = store.viewer();
  const runs = store.state.runs.filter((r) => r.viewerId === viewer.id && r.kind !== "rotina").slice(0, 12).reverse();
  const send = (question) => {
    if (attempt(store, () => ask(store, question, { agentId }))) setText("");
  };
  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest" }), [runs.length]);

  return html`<div className="view view--chat">
    <${PageHeader} title="Assistente IA" subtitle=${`Respondendo como ${viewer.name} (${viewer.title}) · mesmas permissões e lojas do seu perfil`} />
    <div className="notice notice--info" role="note">Demonstração: as respostas são montadas por regras locais a partir de ferramentas determinísticas. Nenhum modelo de IA é chamado e nenhum número vem de texto gerado.</div>
    <div className="agent-picker" role="radiogroup" aria-label="Com quem falar">
      ${AGENTS.map((a) => html`<button key=${a.id} type="button" role="radio" aria-checked=${agentId === a.id} className=${agentId === a.id ? "is-active" : ""} onClick=${() => setAgentId(a.id)}>
        <strong>${a.name}</strong><small>${a.id === "central" ? "Coordenador (roteia)" : a.title}</small>
      </button>`)}
    </div>
    <div className="chat" aria-live="polite">
      ${runs.length === 0 ? html`<div className="chat__empty"><strong>Como posso ajudar?</strong><p>Escolha uma sugestão abaixo ou escreva a sua pergunta sobre a operação.</p></div>` : null}
      ${runs.map((run) => html`<article key=${run.id} className="chat__turn">
        <div className="bubble bubble--user"><span>${run.question}</span><small>${time(run.createdAt)}${run.agentId && run.agentId !== "central" ? ` · para ${agent(run.agentId).name}` : ""}</small></div>
        <div className="bubble bubble--agent">
          <ol className="steps" aria-label="Etapas da execução">
            ${run.steps.map((s) => html`<li key=${s.id}>
              <span className="steps__who">${agent(s.agentId).name}</span>
              <span className="steps__what">${s.label}</span>
              <${Badge} tone=${STEP[s.status][0]}>${STEP[s.status][1]}<//>
            </li>`)}
          </ol>
          ${run.answer ? html`<${Answer} run=${run} onOpenReport=${(id) => go("relatorios", { reportId: id })} />` : null}
          <div className="chat__actions">
            <span className="muted small">Execução ${run.id} · ${RUN_STATUS[run.status]}</span>
            <button type="button" className="btn btn--ghost btn--small" onClick=${() => go("escritorio")}>Ver no escritório</button>
            ${run.status === "em_execucao"
              ? html`<button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => cancelRun(store, run.id), "Execução cancelada.")}>Cancelar</button>`
              : html`<button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => rerun(store, run.id))}>Repetir</button>`}
          </div>
        </div>
      </article>`)}
      <div ref=${endRef}></div>
    </div>
    <div className="suggestions">
      ${SUGGESTED_QUESTIONS.map((q) => html`<button key=${q} type="button" className="chip" onClick=${() => send(q)}>${q}</button>`)}
    </div>
    <form className="composer" onSubmit=${(e) => { e.preventDefault(); send(text); }}>
      <label htmlFor="pergunta" className="sr-only">Pergunta</label>
      <input id="pergunta" value=${text} maxLength="400" placeholder=${agentId === "central" ? "Ex.: Como estão as vendas hoje?" : `Pergunte a ${agent(agentId).name} (${agent(agentId).title})`} onChange=${(e) => setText(e.target.value)} />
      <button type="submit" className="btn btn--primary">Enviar</button>
    </form>
  </div>`;
}
