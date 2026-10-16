// Generates svg/ (run from brand/next-ai). Geometry = canvas artboard "01B · Avanço Sólido".
import { writeFileSync } from "node:fs";
const D = "#062F28", L = "#9FE870", W = "#FFFFFF";
const mark = (stem, arrow) => `<rect x="30" y="30" width="15" height="60" fill="${stem}"/><polygon points="30,30 45,30 90,90 75,90" fill="${stem}"/><rect x="75" y="46" width="15" height="44" fill="${arrow}"/><polygon points="64,48 82.5,26 101,48" fill="${arrow}"/>`;
const word = (next, pill, ai, outline = false) => `<path d="M5 50 V10 L32 50 V10 M70 10 H46 V50 H70 M46 30 H66 M82 10 L110 50 M110 10 L82 50 M120 10 H148 M134 10 V50" fill="none" stroke="${next}" stroke-width="9" stroke-linejoin="miter"/>${outline ? `<rect x="161.5" y="7.5" width="77" height="45" rx="22.5" fill="none" stroke="${pill}" stroke-width="3"/>` : `<rect x="160" y="6" width="80" height="48" rx="24" fill="${pill}"/>`}<path d="M175 45 L187 15 L199 45 M180 34 H194 M222 15 V45" fill="none" stroke="${ai}" stroke-width="6" stroke-linejoin="miter"/><circle cx="210" cy="42.5" r="3.5" fill="${ai}"/>`;
const svg = (vb, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const files = {
  "icon.svg": svg("0 0 120 120", `<rect width="120" height="120" rx="28" fill="${D}"/>${mark(W, L)}`, "NEXT A.I ícone"),
  "icon-lime.svg": svg("0 0 120 120", `<rect width="120" height="120" rx="28" fill="${L}"/>${mark(D, D)}`, "NEXT A.I ícone lima"),
  "symbol.svg": svg("0 0 120 120", mark(D, "#0E453A"), "NEXT A.I símbolo"),
  "symbol-negative.svg": svg("0 0 120 120", mark(W, L), "NEXT A.I símbolo negativo"),
  "symbol-mono.svg": svg("0 0 120 120", mark(D, D), "NEXT A.I símbolo monocromático"),
  "wordmark.svg": svg("0 0 244 60", word(D, L, D), "NEXT A.I"),
  "wordmark-negative.svg": svg("0 0 244 60", word(W, L, D), "NEXT A.I negativo"),
  "logo-horizontal.svg": svg("0 0 400 120", `<rect width="120" height="120" rx="28" fill="${D}"/>${mark(W, L)}<g transform="translate(146 30)">${word(D, L, D)}</g>`, "NEXT A.I"),
  "logo-horizontal-negative.svg": svg("0 0 400 120", `<rect width="120" height="120" rx="28" fill="${L}"/>${mark(D, D)}<g transform="translate(146 30)">${word(W, L, D)}</g>`, "NEXT A.I negativo"),
  "logo-horizontal-mono.svg": svg("0 0 400 120", `${mark(D, D)}<g transform="translate(146 30)">${word(D, D, D, true)}</g>`, "NEXT A.I monocromático"),
  "logo-vertical.svg": svg("0 0 244 200", `<g transform="translate(62 0)"><rect width="120" height="120" rx="28" fill="${D}"/>${mark(W, L)}</g><g transform="translate(0 140)">${word(D, L, D)}</g>`, "NEXT A.I vertical"),
};
for (const [n, c] of Object.entries(files)) writeFileSync(`svg/${n}`, c);
console.log(Object.keys(files).length, "svgs");
