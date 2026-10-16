// Line icons (24×24, stroke) drawn for the demo; static markup only.
import { html } from "./ui.js";

const PATHS = {
  painel: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>',
  pdv: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2.2l2.3 11.1a1 1 0 0 0 1 .9h9.1a1 1 0 0 0 1-.8L20 8H6.1"/>',
  caixa: '<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5H5.5A2.5 2.5 0 0 1 3 6.5"/><circle cx="16" cy="13.8" r="1"/>',
  estoque: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  fila: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.6a3.2 3.2 0 0 1 0 6.3"/><path d="M18.5 14.6A6 6 0 0 1 21 20"/>',
  metas: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  relatorios: '<path d="M21 13A9 9 0 1 1 11 3v10z"/><path d="M14.5 3.3A9 9 0 0 1 20.7 9.5h-6.2z"/>',
  auditoria: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V2.8h6V4"/><path d="M9 11h6M9 15h4"/>',
  assistente: '<path d="m4 20 10.5-10.5"/><path d="m12.5 7.5 4 4"/><path d="M18 3v3.2M16.4 4.6h3.2"/><path d="M8.5 3.5v2.2M7.4 4.6h2.2"/>',
  escritorio: '<rect x="3" y="3" width="8" height="8" rx="2.2"/><rect x="13" y="3" width="8" height="8" rx="2.2"/><rect x="3" y="13" width="8" height="8" rx="2.2"/><rect x="13" y="13" width="8" height="8" rx="2.2"/>',
  alertas: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.8 2H4.2z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  seta: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
  enviar: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  refazer: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>',
};

export function Icon({ name, size = 18, className = "" }) {
  return html`<svg className=${`icon ${className}`} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" dangerouslySetInnerHTML=${{ __html: PATHS[name] }}></svg>`;
}

// NEXT A.I logo, exact copy of brand/next-ai/svg/logo-horizontal.svg (concept 01B). Do not redraw.
const LOGO = '<rect width="120" height="120" rx="28" fill="#062F28"/><rect x="30" y="30" width="15" height="60" fill="#FFFFFF"/><polygon points="30,30 45,30 90,90 75,90" fill="#FFFFFF"/><rect x="75" y="46" width="15" height="44" fill="#9FE870"/><polygon points="64,48 82.5,26 101,48" fill="#9FE870"/><g transform="translate(146 30)"><path d="M5 50 V10 L32 50 V10 M70 10 H46 V50 H70 M46 30 H66 M82 10 L110 50 M110 10 L82 50 M120 10 H148 M134 10 V50" fill="none" stroke="#062F28" stroke-width="9" stroke-linejoin="miter"/><rect x="160" y="6" width="80" height="48" rx="24" fill="#9FE870"/><path d="M175 45 L187 15 L199 45 M180 34 H194 M222 15 V45" fill="none" stroke="#062F28" stroke-width="6" stroke-linejoin="miter"/><circle cx="210" cy="42.5" r="3.5" fill="#062F28"/></g>';

export function Logo() {
  return html`<svg className="brand__logo" viewBox="0 0 400 120" role="img" aria-label="NEXT A.I" dangerouslySetInnerHTML=${{ __html: LOGO }}></svg>`;
}
