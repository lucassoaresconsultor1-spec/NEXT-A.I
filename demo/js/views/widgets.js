// Dashboard widgets shared by the panels: highlight card, mini stats, assistant
// launcher and per-store goal cards. All numbers come from the metrics module.
import { STORES } from "../catalog.js";
import { brl, pct } from "../lib.js";
import * as m from "../metrics.js";
import { go, store } from "../app-store.js";
import { DotProgress } from "../charts.js";
import { Icon } from "../icons.js";
import { ask } from "../orchestrator.js";
import { attempt, html, useState } from "../ui.js";

/** Money in reais without the currency symbol (the card shows "BRL" beside it). */
export const reais = (cents) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Up/down pill for a variation; neutral when there is no comparable base. */
export function Delta({ current, previous, label }) {
  const change = m.variation(current, previous);
  if (change === null) return html`<span className="delta delta--neutral">sem base</span>`;
  return html`<span className=${`delta ${change >= 0 ? "delta--up" : "delta--down"}`} title=${`Comparado com ${label}`}>${change >= 0 ? "▲" : "▼"} ${pct(Math.abs(change))}</span>`;
}

export function HeroCard({ label, value, unit = "BRL", note, delta, actions }) {
  return html`<section className="hero-card" aria-label=${label}>
    <div className="hero-card__top">
      <span>${label}</span>
      ${delta}
    </div>
    <p className="hero-card__value">${value}<small>${unit}</small></p>
    ${note ? html`<p className="hero-card__note">${note}</p>` : null}
    <div className="hero-card__actions">
      ${actions.map((a) => html`<a key=${a.href} href=${a.href} className=${`pill-link pill-link--${a.kind}`}>${a.label} <${Icon} name="seta" size=${14} /></a>`)}
    </div>
  </section>`;
}

export function MiniStats({ title, items }) {
  return html`<section className="card mini-stats">
    <header className="card__header"><div><h2>${title}</h2></div></header>
    <div className="mini-stats__grid">
      ${items.map((it) => html`<div key=${it.label} className="mini-stat">
        <span className="mini-stat__icon"><${Icon} name=${it.icon} size=${16} /></span>
        <span className="mini-stat__label">${it.label}</span>
        <strong className="mini-stat__value">${it.value}</strong>
        ${it.delta}
      </div>`)}
    </div>
  </section>`;
}

const QUICK = ["Como estão as vendas hoje?", "Quais lojas estão abaixo da meta?", "Quais produtos correm risco de ruptura?"];

/** Assistant launcher: sends the question for real and opens the conversation. */
export function AssistantCard({ questions = QUICK }) {
  const [text, setText] = useState("");
  if (!store.can("ai.use")) return null;
  const send = (q) => {
    if (attempt(store, () => ask(store, q))) go("assistente");
  };
  return html`<section className="card assistant-card">
    <header className="card__header"><div><h2>Assistente IA</h2><p className="card__subtitle">Respostas com dados das ferramentas</p></div></header>
    <div className="assistant-card__body">
      <span className="orb" aria-hidden="true"></span>
      <p className="assistant-card__title">Como posso ajudar?</p>
      <div className="assistant-card__chips">${questions.map((q) => html`<button key=${q} type="button" className="chip" onClick=${() => send(q)}>${q}</button>`)}</div>
      <form className="assistant-card__form" onSubmit=${(e) => { e.preventDefault(); if (text.trim()) send(text); }}>
        <label htmlFor="painel-pergunta" className="sr-only">Pergunta ao assistente</label>
        <input id="painel-pergunta" value=${text} maxLength="400" placeholder="Pergunte algo…" onChange=${(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn--accent btn--small"><${Icon} name="enviar" size=${14} /> Enviar</button>
      </form>
    </div>
  </section>`;
}

/** One card per store: % of the month goal, ten dots, projection; the best projection is highlighted. */
export function StoreGoalCards({ storeIds, now }) {
  const rows = STORES.filter((s) => storeIds.includes(s.id)).map((s) => ({ shop: s, g: m.goalProgress(store.state, now, s.id) }));
  const best = Math.max(...rows.map((r) => r.g.projectionRatio));
  return html`<div className="goal-cards">
    ${rows.map(({ shop, g }) => {
      const status = g.projectionRatio >= 1 ? "No ritmo" : g.projectionRatio >= 0.9 ? "Atenção" : "Em risco";
      return html`<article key=${shop.id} className=${`goal-card ${g.projectionRatio === best ? "goal-card--best" : ""}`}>
        <span className="goal-card__name">${shop.name}</span>
        <strong className="goal-card__pct">${pct(g.progress, 0)}</strong>
        <span className="goal-card__text">da meta de ${brl(g.targetCents)}</span>
        <${DotProgress} value=${g.progress} label=${`${shop.name}: ${pct(g.progress, 0)} da meta`} tone=${g.projectionRatio === best ? "deep" : "accent"} />
        <span className=${`goal-card__status goal-card__status--${status === "No ritmo" ? "ok" : status === "Atenção" ? "warn" : "risk"}`}>${status} · projeção ${pct(g.projectionRatio, 0)}</span>
      </article>`;
    })}
  </div>`;
}
