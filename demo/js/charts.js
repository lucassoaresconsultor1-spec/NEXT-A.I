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

/** Columns of one series (rounded data-end, square baseline); the last column is highlighted. */
export function ColumnChart({ points, format, axisFormat = format, height = 220, title, lastLabel }) {
  const [hover, setHover] = useState(null);
  const width = 640;
  const pad = { top: 22, right: 12, bottom: 26, left: 60 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...points.map((p) => p.value), 1);
  const step = niceStep(max, 3);
  const top = Math.ceil(max / step) * step;
  const band = innerW / points.length;
  const barW = Math.min(16, band * 0.62);
  const base = pad.top + innerH;
  const y = (v) => base - (v / top) * innerH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(points.length / 6);
  const last = points.length - 1;
  const column = (p, i) => {
    const h = p.value > 0 ? Math.max((p.value / top) * innerH, 2) : 0;
    const x0 = pad.left + band * i + (band - barW) / 2;
    const r = Math.min(4, barW / 2, h);
    const y0 = base - h;
    return `M${x0},${base}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + barW - r}Q${x0 + barW},${y0} ${x0 + barW},${y0 + r}V${base}Z`;
  };
  return html`<figure className="chart">
    <svg viewBox=${`0 0 ${width} ${height}`} role="img" aria-label=${title} onPointerLeave=${() => setHover(null)}>
      ${ticks.map((t) => html`<g key=${t}>
        <line x1=${pad.left} x2=${width - pad.right} y1=${y(t)} y2=${y(t)} className="chart__grid" />
        <text x=${pad.left - 8} y=${y(t) + 4} textAnchor="end" className="chart__axis">${axisFormat(t)}</text>
      </g>`)}
      ${points.map((p, i) => html`<g key=${i} onPointerEnter=${() => setHover(i)}>
        <rect x=${pad.left + band * i} y=${pad.top} width=${band} height=${innerH} className="chart__hit" />
        <path d=${column(p, i)} className=${`chart__col ${i === last ? "chart__col--last" : ""} ${hover === i ? "is-hover" : ""}`} />
        ${i % labelEvery === 0 || i === last ? html`<text x=${pad.left + band * i + band / 2} y=${height - 6} textAnchor="middle" className="chart__axis">${p.label}</text>` : null}
      </g>`)}
    </svg>
    ${hover !== null
      ? html`<div className="chart__tip" style=${{ left: `${((pad.left + band * hover + band / 2) / width) * 100}%` }}><strong>${format(points[hover].value)}</strong><span>${points[hover].label}</span></div>`
      : null}
    ${lastLabel
      ? html`<p className="chart__legend"><span className="chart__swatch chart__swatch--deep"></span>Dias anteriores<span className="chart__swatch chart__swatch--accent"></span>${lastLabel}</p>`
      : null}
    <details className="chart__table">
      <summary>Ver em tabela</summary>
      <table><tbody>${points.map((p, i) => html`<tr key=${i}><th scope="row">${p.label}</th><td className="num">${format(p.value)}</td></tr>`)}</tbody></table>
    </details>
  </figure>`;
}

const DONUT_COLORS = ["#062f28", "#9fe870", "#7b7b7b", "#c9d4d1"];

/** Donut with 2px surface gaps, total in the center and a legend that carries the values. */
export function Donut({ segments, format, centerLabel, title }) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return html`<div className="donut">
    <svg viewBox="0 0 140 140" role="img" aria-label=${title} className="donut__svg">
      <circle cx="70" cy="70" r=${r} className="donut__track" />
      ${segments.map((s, i) => {
        const share = total ? s.value / total : 0;
        const len = Math.max(share * c - 3, 0);
        const el = html`<circle key=${s.label} cx="70" cy="70" r=${r} stroke=${DONUT_COLORS[i % DONUT_COLORS.length]} strokeDasharray=${`${len} ${c - len}`} strokeDashoffset=${-offset} className="donut__seg" transform="rotate(-90 70 70)" />`;
        offset += share * c;
        return el;
      })}
      <text x="70" y="64" textAnchor="middle" className="donut__label">${centerLabel}</text>
      <text x="70" y="84" textAnchor="middle" className="donut__value">${format(total, true)}</text>
    </svg>
    <ul className="legend">
      ${segments.map((s, i) => html`<li key=${s.label}>
        <span className="legend__swatch" style=${{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}></span>
        <span className="legend__label">${s.label}</span>
        <span className="legend__share num">${total ? Math.round((s.value / total) * 100) : 0}%</span>
        <strong className="legend__value">${format(s.value)}</strong>
      </li>`)}
    </ul>
  </div>`;
}

/** Ten-dot progress (filled dots = share reached), labelled for screen readers. */
export function DotProgress({ value, label, total = 10, tone = "accent" }) {
  const filled = Math.round(Math.min(Math.max(value ?? 0, 0), 1) * total);
  return html`<div className=${`dots dots--${tone}`} role="img" aria-label=${label}>
    ${Array.from({ length: total }, (_, i) => html`<span key=${i} className=${i < filled ? "dot is-on" : "dot"}></span>`)}
  </div>`;
}

/** Half-circle gauge for one ratio (capped at 100% of the arc). */
export function Gauge({ value, display, caption, label }) {
  const len = Math.PI * 50;
  const filled = Math.min(Math.max(value ?? 0, 0), 1) * len;
  return html`<figure className="gauge" role="img" aria-label=${label}>
    <svg viewBox="0 0 120 70">
      <path d="M10 62a50 50 0 0 1 100 0" className="gauge__track" />
      <path d="M10 62a50 50 0 0 1 100 0" className="gauge__value" strokeDasharray=${`${filled} ${len}`} />
    </svg>
    <figcaption><strong>${display}</strong></figcaption>
    <p className="gauge__caption">${caption}</p>
  </figure>`;
}
