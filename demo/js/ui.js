// Shared UI pieces (React 18 UMD + htm, no build step). Globals come from index.html.
import { DemoError } from "./store.js";
import { brl } from "./lib.js";

const { React, htm } = globalThis;
export const html = htm.bind(React.createElement);
export const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore, useId, Fragment } = React;

/** Re-renders on every store commit. */
export function useStore(store) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** Wall clock for live timers (queue waits, office states). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Runs a backend action; returns its value (true when it has none) or undefined after a visible error. */
export function attempt(store, action, success) {
  try {
    const value = action();
    if (success) store.notify(success);
    return value === undefined ? true : value;
  } catch (error) {
    if (error instanceof DemoError) store.notify(error.message, "error");
    else {
      console.error(error);
      store.notify("Algo deu errado nesta ação da demonstração. Recarregue a página para recomeçar.", "error");
    }
    return undefined;
  }
}

export const brlCompact = (cents) => {
  const reais = cents / 100;
  if (Math.abs(reais) >= 1_000_000) return `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(reais) >= 1000) return `R$ ${(reais / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return brl(cents);
};

export function PageHeader({ title, subtitle, actions }) {
  return html`<div className="page-header">
    <div className="page-header__text">
      <h1>${title}</h1>
      ${subtitle ? html`<p>${subtitle}</p>` : null}
    </div>
    ${actions ? html`<div className="page-header__actions">${actions}</div>` : null}
  </div>`;
}

const TONE_ICON = { positive: "✓", critical: "!", attention: "▲", info: "i", neutral: "•" };
export function Badge({ tone = "neutral", children, icon = true }) {
  return html`<span className=${`badge badge--${tone}`}>${icon ? html`<span aria-hidden="true" className="badge__icon">${TONE_ICON[tone]}</span>` : null}${children}</span>`;
}

export const SEVERITY = { alta: { tone: "critical", label: "Alta" }, media: { tone: "attention", label: "Média" }, baixa: { tone: "info", label: "Baixa" } };

/** KPI tile with an optional formula disclosure, so every number states how it is computed. */
export function Tile({ label, value, detail, delta, formula, tone }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return html`<div className=${`tile ${tone ? `tile--${tone}` : ""}`}>
    <div className="tile__top">
      <span className="tile__label">${label}</span>
      ${formula
        ? html`<button type="button" className="tile__info" aria-expanded=${open} aria-controls=${id} aria-label=${`Como calculamos: ${label}`} onClick=${() => setOpen(!open)}>?</button>`
        : null}
    </div>
    <div className="tile__value">${value}</div>
    ${delta ? html`<div className=${`tile__delta tile__delta--${delta.tone}`}>${delta.text}</div>` : null}
    ${detail ? html`<div className="tile__detail">${detail}</div>` : null}
    ${formula && open ? html`<p id=${id} className="tile__formula">${formula}</p>` : null}
  </div>`;
}

export function Card({ title, actions, children, className = "", subtitle }) {
  return html`<section className=${`card ${className}`}>
    ${title
      ? html`<header className="card__header">
          <div><h2>${title}</h2>${subtitle ? html`<p className="card__subtitle">${subtitle}</p>` : null}</div>
          ${actions ? html`<div className="card__actions">${actions}</div>` : null}
        </header>`
      : null}
    <div className="card__body">${children}</div>
  </section>`;
}

export function DataTable({ columns, rows, caption, empty = "Nada para mostrar.", numeric = [] }) {
  if (!rows.length) return html`<p className="empty">${empty}</p>`;
  return html`<div className="table-wrap">
    <table>
      ${caption ? html`<caption className="sr-only">${caption}</caption>` : null}
      <thead><tr>${columns.map((c, i) => html`<th key=${i} scope="col" className=${numeric.includes(i) ? "num" : ""}>${c}</th>`)}</tr></thead>
      <tbody>
        ${rows.map((row, r) => html`<tr key=${r}>${row.map((cell, i) => html`<td key=${i} className=${numeric.includes(i) ? "num" : ""}>${cell}</td>`)}</tr>`)}
      </tbody>
    </table>
  </div>`;
}

export function Progress({ value, marker, label, tone = "brand" }) {
  const width = `${Math.min(Math.max(value ?? 0, 0), 1) * 100}%`;
  return html`<div className="progress" role="img" aria-label=${label}>
    <div className=${`progress__bar progress__bar--${tone}`} style=${{ width }}></div>
    ${marker !== undefined ? html`<div className="progress__marker" style=${{ left: `${Math.min(marker, 1) * 100}%` }} title="Esperado até hoje"></div>` : null}
  </div>`;
}

export function Segmented({ value, options, onChange, label }) {
  return html`<div className="segmented" role="group" aria-label=${label}>
    ${Object.entries(options).map(
      ([key, text]) => html`<button key=${key} type="button" aria-pressed=${value === key} className=${value === key ? "is-active" : ""} onClick=${() => onChange(key)}>${text}</button>`,
    )}
  </div>`;
}

export function AccessDenied({ what }) {
  return html`<div className="denied" role="alert">
    <h1>Sem acesso a ${what}</h1>
    <p>O seu perfil não tem permissão para este módulo. No produto, a verificação acontece no servidor: esconder o menu não é o controle. Troque o perfil em “Ver como” para comparar.</p>
  </div>`;
}

export function Field({ label, id, hint, children }) {
  return html`<div className="field">
    <label htmlFor=${id}>${label}</label>
    ${children}
    ${hint ? html`<p className="field__hint">${hint}</p>` : null}
  </div>`;
}

export function Empty({ title, children }) {
  return html`<div className="empty-state"><strong>${title}</strong>${children ? html`<p>${children}</p>` : null}</div>`;
}
