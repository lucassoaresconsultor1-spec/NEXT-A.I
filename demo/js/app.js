// Demo shell: navigation by permission, viewer switch, toasts and hash routing.
import { ORGANIZATION } from "./catalog.js";
import { date } from "./lib.js";
import { store } from "./app-store.js";
import { runMonitoring } from "./orchestrator.js";
import { VIEWERS } from "./store.js";
import { html, useEffect, useState, useStore } from "./ui.js";
import { Alertas, Auditoria } from "./views/alertas.js";
import { Assistente } from "./views/assistente.js";
import { Caixa } from "./views/caixa.js";
import { Escritorio } from "./views/escritorio.js";
import { Estoque } from "./views/estoque.js";
import { Fila } from "./views/fila.js";
import { Metas } from "./views/metas.js";
import { Painel } from "./views/painel.js";
import { Pdv } from "./views/pdv.js";
import { Relatorios } from "./views/relatorios.js";

const ROUTES = [
  { section: "Visão geral", id: "painel", label: "Painel", view: Painel, can: () => true },
  { section: "Operação", id: "pdv", label: "PDV", view: Pdv, can: () => store.can("pdv.sell") },
  { section: "Operação", id: "caixa", label: "Caixa", view: Caixa, can: () => store.can("cash.read") },
  { section: "Operação", id: "estoque", label: "Estoque", view: Estoque, can: () => store.can("inventory.read") },
  { section: "Operação", id: "fila", label: "Fila de atendimento", view: Fila, can: () => store.can("queue.read") },
  { section: "Gestão", id: "metas", label: "Metas e comissões", view: Metas, can: () => store.can("goals.read") || store.can("goals.own") },
  { section: "Gestão", id: "relatorios", label: "Relatórios", view: Relatorios, can: () => store.can("reports.read") },
  { section: "Gestão", id: "auditoria", label: "Auditoria", view: Auditoria, can: () => store.can("audit.read") },
  { section: "Inteligência", id: "assistente", label: "Assistente IA", view: Assistente, can: () => store.can("ai.use") },
  { section: "Inteligência", id: "escritorio", label: "Escritório virtual", view: Escritorio, can: () => store.can("office.read") },
  { section: "Inteligência", id: "alertas", label: "Alertas e tarefas", view: Alertas, can: () => store.can("alerts.read") || store.can("tasks.own") },
];
const routeFromHash = () => {
  const id = window.location.hash.replace("#", "");
  return ROUTES.some((r) => r.id === id) ? id : "painel";
};

function Toast() {
  const flash = store.state.flash;
  const [visible, setVisible] = useState(null);
  useEffect(() => {
    if (!flash) return undefined;
    setVisible(flash);
    const id = setTimeout(() => setVisible(null), flash.tone === "error" ? 6000 : 3500);
    return () => clearTimeout(id);
  }, [flash]);
  return html`<div className="toast-region" role="status" aria-live="polite">
    ${visible ? html`<div className=${`toast toast--${visible.tone}`}>${visible.message}</div>` : null}
  </div>`;
}

function App() {
  useStore(store);
  const [route, setRoute] = useState(routeFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      setMenuOpen(false);
      document.getElementById("conteudo")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const viewer = store.viewer();
  const current = ROUTES.find((r) => r.id === route);
  const View = current.view;
  const sections = [...new Set(ROUTES.map((r) => r.section))];
  const openAlerts = store.can("alerts.read") ? store.state.alerts.filter((a) => a.status === "aberto" && viewer.storeIds.includes(a.storeId)).length : 0;

  return html`<div className=${`app ${menuOpen ? "app--menu" : ""}`}>
    <a className="skip" href="#conteudo">Pular para o conteúdo</a>
    <aside className="sidebar" aria-label="Navegação principal">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">VI</span>
        <div><strong>Varejo Inteligente</strong><small>${ORGANIZATION.name}</small></div>
      </div>
      <nav>
        ${sections.map((section) => {
          const items = ROUTES.filter((r) => r.section === section && r.can());
          if (!items.length) return null;
          return html`<div key=${section} className="nav-section">
            <span className="nav-section__title">${section}</span>
            ${items.map((r) => html`<a key=${r.id} href=${`#${r.id}`} aria-current=${r.id === route ? "page" : undefined} className=${r.id === route ? "is-active" : ""}>
              ${r.label}${r.id === "alertas" && openAlerts ? html`<span className="nav-count" aria-label=${`${openAlerts} alertas abertos`}>${openAlerts}</span>` : null}
            </a>`)}
          </div>`;
        })}
      </nav>
      <p className="sidebar__foot">Demonstração · dados fictícios gerados em ${date(store.state.meta.generatedAt)}</p>
    </aside>
    <div className="main">
      <header className="topbar">
        <button type="button" className="btn btn--ghost menu-button" aria-expanded=${menuOpen} onClick=${() => setMenuOpen(!menuOpen)}>Menu</button>
        <span className="demo-badge">DEMONSTRAÇÃO</span>
        <label className="viewer">
          <span>Ver como</span>
          <select value=${viewer.id} onChange=${(e) => store.setViewer(e.target.value)}>
            ${VIEWERS.map((v) => html`<option key=${v.id} value=${v.id}>${v.name} · ${v.title} (${v.scopeLabel})</option>`)}
          </select>
        </label>
      </header>
      <p className="demo-banner">Dados fictícios de uma empresa inventada. Pagamentos não são processados, nada é emitido na Receita e nenhum modelo de IA é chamado: os agentes usam regras locais sobre os mesmos cálculos dos painéis. Recarregar a página restaura os dados iniciais.</p>
      <main id="conteudo" tabIndex="-1">
        <${View} key=${`${viewer.id}-${route}`} />
      </main>
    </div>
    <${Toast} />
  </div>`;
}

const root = globalThis.ReactDOM.createRoot(document.getElementById("app"));
root.render(html`<${App} />`);
// The monitoring routine runs once on open, like a scheduled job would.
setTimeout(() => runMonitoring(store), 1200);
