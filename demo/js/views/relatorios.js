// Reports from the shared metrics (same numbers as the panels) and AI-generated reports.
import { PRODUCTS, STORES } from "../catalog.js";
import { brl, dateTime, int, minutesLabel, pct } from "../lib.js";
import * as m from "../metrics.js";
import { handoff, store } from "../app-store.js";
import { BarChart } from "../charts.js";
import { ask } from "../orchestrator.js";
import { AccessDenied, attempt, Card, DataTable, Field, html, PageHeader, Segmented, useNow, useState } from "../ui.js";
import { AnswerBlocks } from "./assistente-resposta.js";
import { STOCK_STATUS } from "./estoque.js";

const PERIODS = { hoje: "Hoje", "7d": "7 dias", mes: "Mês atual", mes_anterior: "Mês anterior", "30d": "30 dias" };
const TYPES = {
  lojas: "Vendas por loja",
  vendedores: "Vendas por vendedor",
  categorias: "Vendas por categoria",
  descontos: "Descontos, cancelamentos e devoluções",
  atendimento: "Atendimento e conversão",
  estoque: "Estoque crítico e excesso",
};

function build(type, state, window, scope, now) {
  if (type === "vendedores") {
    const rows = m.bySeller(state, window, scope).sort((a, b) => b.net - a.net);
    return { columns: ["Vendedor", "Loja", "Líquido", "Vendas", "Ticket", "Conversão"], numeric: [2, 3, 4, 5], rows: rows.map((r) => [r.person.name, STORES.find((s) => s.id === r.person.storeId).name, brl(r.net), int(r.count), r.ticket ? brl(r.ticket) : "—", pct(r.queue.conversion)]), chart: rows.map((r) => ({ label: r.person.name, value: r.net, display: brl(r.net) })) };
  }
  if (type === "categorias") {
    const rows = m.byCategory(state, window, scope);
    return { columns: ["Categoria", "Peças", "Líquido", "Margem"], numeric: [1, 2, 3], rows: rows.map((r) => [r.category, int(r.qty), brl(r.net), pct(r.margin)]), chart: rows.map((r) => ({ label: r.category, value: r.net, display: brl(r.net) })) };
  }
  if (type === "descontos") {
    const rows = m.byStore(state, window, scope);
    return { columns: ["Loja", "Descontos", "% do bruto", "Canceladas", "Valor cancelado", "Devolvidas", "Valor devolvido"], numeric: [1, 2, 3, 4, 5, 6], rows: rows.map((r) => [r.store.name, brl(r.discounts), pct(r.gross ? r.discounts / r.gross : null), int(r.cancelled.count), brl(r.cancelled.cents), int(r.returned.count), brl(r.returned.cents)]) };
  }
  if (type === "atendimento") {
    const rows = STORES.filter((s) => scope.storeIds.includes(s.id)).map((s) => ({ s, q: m.queueMetrics(state, window, { storeIds: [s.id] }) }));
    return { columns: ["Loja", "Chegadas", "Espera média", "Espera máxima", "Desistências", "Conversão"], numeric: [1, 2, 3, 4, 5], rows: rows.map(({ s, q }) => [s.name, int(q.arrivals), minutesLabel(q.avgWait), minutesLabel(q.maxWait), pct(q.abandonment), pct(q.conversion)]) };
  }
  if (type === "estoque") {
    const { alerts } = m.inventoryAlerts(state, scope, now);
    return { columns: ["Produto", "Loja", "Saldo", "Mínimo", "Vendas 30d", "Situação"], numeric: [2, 3, 4], rows: alerts.map((a) => [`${a.product.name} ${a.product.variant}`, STORES.find((s) => s.id === a.storeId).name, int(a.balance), int(a.product.minStock), int(a.sold30), STOCK_STATUS[a.status][1]]), noPeriod: true };
  }
  const rows = m.byStore(state, window, scope).sort((a, b) => b.net - a.net);
  return { columns: ["Loja", "Bruto", "Descontos", "Líquido", "Vendas", "Ticket", "Margem"], numeric: [1, 2, 3, 4, 5, 6], rows: rows.map((r) => [r.store.name, brl(r.gross), brl(r.discounts), brl(r.net), int(r.count), r.ticket ? brl(r.ticket) : "—", pct(r.margin)]), chart: rows.map((r) => ({ label: r.store.name, value: r.net, display: brl(r.net) })) };
}

const toCsv = (columns, rows) => [columns, ...rows].map((r) => r.map((c) => `"${String(typeof c === "string" || typeof c === "number" ? c : "").replace(/"/g, '""')}"`).join(";")).join("\n");

export function Relatorios() {
  return store.can("reports.read") ? html`<${RelatoriosView} />` : html`<${AccessDenied} what="Relatórios" />`;
}

function RelatoriosView() {
  const now = useNow(60_000);
  const [type, setType] = useState("lojas");
  const [period, setPeriod] = useState("mes");
  const [csv, setCsv] = useState(null);
  const [openId, setOpenId] = useState(() => {
    const id = handoff.reportId;
    handoff.reportId = null;
    return id ?? store.state.reports[0]?.id ?? null;
  });
  const { state } = store;
  const scope = store.scope();
  const window = m.periodRange(period, now);
  const report = build(type, state, window, scope, now);
  const generated = state.reports.filter((r) => store.viewer().name === r.author || store.can("reports.network"));
  const open = generated.find((r) => r.id === openId) ?? generated[0];
  const running = state.runs.some((r) => r.kind === "relatorio" && r.status === "em_execucao");
  const copy = async () => {
    const text = toCsv(report.columns, report.rows);
    try {
      await navigator.clipboard.writeText(text);
      store.notify("CSV copiado. Cole numa planilha.");
    } catch {
      setCsv(text);
    }
  };

  return html`<div className="view">
    <${PageHeader} title="Relatórios" subtitle="Mesmas funções de cálculo dos painéis e dos agentes; respeitam o seu acesso" />
    <${Card}
      title=${TYPES[type]}
      subtitle=${report.noPeriod ? "Posição atual" : `${window.label} · ${store.viewer().scopeLabel}`}
      actions=${html`<button type="button" className="btn btn--secondary btn--small" onClick=${copy}>Copiar CSV</button>`}
    >
      <div className="filters">
        <${Field} label="Relatório" id="rel-tipo"><select id="rel-tipo" value=${type} onChange=${(e) => { setType(e.target.value); setCsv(null); }}>${Object.entries(TYPES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        ${!report.noPeriod ? html`<${Segmented} label="Período" value=${period} options=${PERIODS} onChange=${setPeriod} />` : null}
      </div>
      ${report.chart && report.chart.length > 1 ? html`<${BarChart} title=${TYPES[type]} rows=${report.chart} />` : null}
      <${DataTable} columns=${report.columns} rows=${report.rows} numeric=${report.numeric} caption=${TYPES[type]} />
      ${csv ? html`<${Field} label="Selecione e copie o CSV" id="rel-csv"><textarea id="rel-csv" readOnly rows="6" value=${csv} onFocus=${(e) => e.target.select()}></textarea><//>` : null}
      <p className="muted small">Exportação em CSV (separador ;). XLSX e PDF entram com a central de relatórios do produto.</p>
    <//>
    <${Card}
      title="Relatórios gerados pelos agentes"
      subtitle="O Coordenador Central aciona os especialistas e a Analista de Dados consolida"
      actions=${store.can("ai.use") ? html`<button type="button" className="btn btn--primary btn--small" disabled=${running} onClick=${() => attempt(store, () => ask(store, "Gere o relatório executivo da semana."), "Relatório em geração; acompanhe no Escritório virtual.")}>${running ? "Gerando…" : "Gerar relatório da semana"}</button>` : null}
    >
      ${generated.length === 0 ? html`<p className="empty">Nenhum relatório gerado ainda.</p>` : null}
      <div className="report-tabs" role="tablist" aria-label="Relatórios gerados">
        ${generated.map((r) => html`<button key=${r.id} role="tab" type="button" aria-selected=${r.id === open?.id} className=${r.id === open?.id ? "is-active" : ""} onClick=${() => setOpenId(r.id)}>${r.title}<small>${dateTime(r.createdAt)}</small></button>`)}
      </div>
      ${open
        ? html`<article className="report">
            <header><h3>${open.title}</h3><p className="muted small">Gerado em ${dateTime(open.createdAt)} por ${open.author} · ${open.scopeLabel} · execução ${open.runId}</p></header>
            <${AnswerBlocks} blocks=${open.sections} />
            <h4>Metodologia e limitações</h4>
            <ul>${open.methodology.map((t) => html`<li key=${t}>${t}</li>`)}</ul>
          </article>`
        : null}
    <//>
    <p className="muted small">${PRODUCTS.length} produtos e ${STORES.length} lojas fictícias na base da demonstração.</p>
  </div>`;
}
