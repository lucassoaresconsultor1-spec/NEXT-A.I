// Small SVG charts drawn to one scale, with hover tooltips and a table fallback.
import { html, useState } from "./ui.js";

const niceStep = (max, ticks) => {
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= raw) ?? raw;
  return step;
};

/**
 * Area/line chart of one series over time. points: [{ label, value }]; format(value) for
 * labels. A crosshair + tooltip follows the pointer; the endpoint is emphasized.
 */
export function LineChart({ points, format, axisFormat = format, height = 200, title }) {
  const [hover, setHover] = useState(null);
  const width = 640;
  const pad = { top: 16, right: 16, bottom: 26, left: 64 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...points.map((p) => p.value), 1);
  const step = niceStep(max, 3);
  const top = Math.ceil(max / step) * step;
  const x = (i) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (v / top) * innerH;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(points.length / 6);
  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const i = Math.round(((px - pad.left) / innerW) * (points.length - 1));
    setHover(Math.min(Math.max(i, 0), points.length - 1));
  };
  const last = points.length - 1;
  const h = hover ?? null;
  return html`<figure className="chart">
    <svg viewBox=${`0 0 ${width} ${height}`} role="img" aria-label=${title} onPointerMove=${onMove} onPointerLeave=${() => setHover(null)}>
      ${ticks.map((t) => html`<g key=${t}>
        <line x1=${pad.left} x2=${width - pad.right} y1=${y(t)} y2=${y(t)} className="chart__grid" />
        <text x=${pad.left - 8} y=${y(t) + 4} textAnchor="end" className="chart__axis">${axisFormat(t)}</text>
      </g>`)}
      ${points.map((p, i) => (i % labelEvery === 0 || i === last ? html`<text key=${i} x=${x(i)} y=${height - 6} textAnchor="middle" className="chart__axis">${p.label}</text>` : null))}
      <path d=${area} className="chart__area" />
      <path d=${line} className="chart__line" />
      <circle cx=${x(last)} cy=${y(points[last].value)} r="4" className="chart__end" />
      ${h !== null
        ? html`<g>
            <line x1=${x(h)} x2=${x(h)} y1=${pad.top} y2=${pad.top + innerH} className="chart__cross" />
            <circle cx=${x(h)} cy=${y(points[h].value)} r="5" className="chart__dot" />
          </g>`
        : null}
    </svg>
    ${h !== null
      ? html`<div className="chart__tip" style=${{ left: `${(x(h) / width) * 100}%` }}><strong>${format(points[h].value)}</strong><span>${points[h].label}</span></div>`
      : null}
    <details className="chart__table">
      <summary>Ver em tabela</summary>
      <table><tbody>${points.map((p, i) => html`<tr key=${i}><th scope="row">${p.label}</th><td className="num">${format(p.value)}</td></tr>`)}</tbody></table>
    </details>
  </figure>`;
}

/** Horizontal bars, one value per row, direct labels; rows: [{ label, value, display, note }]. */
export function BarChart({ rows, title, marker }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...rows.map((r) => r.value), marker?.value ?? 0, 1);
  return html`<div className="bars" role="list" aria-label=${title}>
    ${rows.map(
      (r, i) => html`<div key=${r.label} role="listitem" className=${`bars__row ${hover === i ? "is-hover" : ""}`} onPointerEnter=${() => setHover(i)} onPointerLeave=${() => setHover(null)}>
        <span className="bars__label">${r.label}</span>
        <span className="bars__track">
          <span className=${`bars__fill ${r.tone ? `bars__fill--${r.tone}` : ""}`} style=${{ width: `${(r.value / max) * 100}%` }}></span>
          ${r.target ? html`<span className="bars__target" style=${{ left: `${(Math.min(r.target, max) / max) * 100}%` }} title="Meta"></span>` : null}
        </span>
        <span className="bars__value">${r.display}</span>
        ${hover === i && r.note ? html`<span className="bars__tip" role="tooltip">${r.note}</span>` : null}
      </div>`,
    )}
  </div>`;
}
