// Structured answer: per specialist, facts (with numbers from tools), hypotheses and
// recommendations kept apart; plus sources, filters and limitations.
import { AGENTS } from "../agents.js";
import { store } from "../app-store.js";
import { decideRecommendation } from "../orchestrator.js";
import { attempt, Badge, DataTable, html } from "../ui.js";

const agent = (id) => AGENTS.find((a) => a.id === id);

function Recommendation({ rec }) {
  const record = rec.id ? store.state.recommendations.find((r) => r.id === rec.id) : null;
  if (!record) return html`<li>${rec.text}</li>`;
  const canDecide = store.can("recommendations.approve");
  return html`<li className="rec">
    <span>${rec.text}</span>
    ${record.status === "pendente"
      ? html`<span className="rec__actions">
          <${Badge} tone="attention">Aguarda aprovação<//>
          ${canDecide
            ? html`<button type="button" className="btn btn--secondary btn--small" onClick=${() => attempt(store, () => decideRecommendation(store, record.id, true), record.approval.type === "transfer" ? "Aprovada: transferência solicitada." : "Aprovada: tarefa criada.")}>Aprovar</button>
                <button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => decideRecommendation(store, record.id, false), "Recomendação rejeitada.")}>Rejeitar</button>`
            : html`<small className="muted">Aprovação exige perfil de gestão.</small>`}
        </span>`
      : html`<${Badge} tone=${record.status === "aprovada" ? "positive" : "neutral"}>${record.status === "aprovada" ? `Aprovada por ${record.decidedBy}` : `Rejeitada por ${record.decidedBy}`}<//>`}
  </li>`;
}

export function AnswerBlocks({ blocks }) {
  return html`<div className="answer-blocks">
    ${blocks.map((b, i) => html`<section key=${i} className="answer-block">
      <h4><span className="answer-block__agent">${agent(b.agentId).name}</span> ${agent(b.agentId).title}${b.title ? ` · ${b.title}` : ""}</h4>
      ${b.facts?.length ? html`<div><h5>Fatos (dados)</h5><ul>${b.facts.map((f, j) => html`<li key=${j}>${f}</li>`)}</ul></div>` : null}
      ${b.table ? html`<${DataTable} columns=${b.table.columns} rows=${b.table.rows} caption=${`Tabela de ${agent(b.agentId).title}`} />` : null}
      ${b.hypotheses?.length ? html`<div><h5>Hipóteses (a confirmar)</h5><ul>${b.hypotheses.map((f, j) => html`<li key=${j}>${f}</li>`)}</ul></div>` : null}
      ${b.recommendations?.length ? html`<div><h5>Recomendações</h5><ul>${b.recommendations.map((r, j) => html`<${Recommendation} key=${j} rec=${r} />`)}</ul></div>` : null}
      ${b.limitations?.length ? html`<p className="muted small">Limitações: ${b.limitations.join(" ")}</p>` : null}
      ${b.sources?.length ? html`<p className="muted small">Fontes: ${b.sources.join("; ")}</p>` : null}
    </section>`)}
  </div>`;
}

export function Answer({ run, onOpenReport }) {
  const a = run.answer;
  if (!a) return null;
  return html`<div className="answer">
    <p className="answer__headline">${a.headline}</p>
    ${a.blocked.length
      ? html`<div className="notice notice--attention" role="status">
          <strong>Ferramenta bloqueada pelo seu perfil:</strong>
          <ul>${a.blocked.map((b, i) => html`<li key=${i}>${agent(b.agentId).title} (${b.tool}): ${b.reason}</li>`)}</ul>
        </div>`
      : null}
    <${AnswerBlocks} blocks=${a.blocks} />
    ${a.reportId ? html`<button type="button" className="btn btn--primary btn--small" onClick=${() => onOpenReport(a.reportId)}>Abrir relatório</button>` : null}
    ${a.suggestions.length ? html`<p>${a.suggestions[0]}</p>` : null}
    <details className="answer__meta">
      <summary>Fontes, filtros e limitações</summary>
      <p><strong>Filtros:</strong> ${a.filters.join(" · ")}</p>
      <p><strong>Fontes:</strong> ${a.sources.join(" · ")}</p>
      <ul>${a.limitations.map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>
    </details>
  </div>`;
}
