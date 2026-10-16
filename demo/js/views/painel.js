// Executive dashboard (organization-wide). Managers and sellers get their own panels.
import { STORES } from "../catalog.js";
import { brl, int, pct, shortDay, minutesLabel } from "../lib.js";
import * as m from "../metrics.js";
import { store } from "../app-store.js";
import { BarChart, LineChart } from "../charts.js";
import { Badge, brlCompact, Card, DataTable, html, PageHeader, Progress, Segmented, SEVERITY, Tile, useNow, useState } from "../ui.js";
import { ManagerPanel, SellerPanel } from "./painel-equipe.js";

const PERIOD_OPTIONS = { hoje: "Hoje", "7d": "7 dias", mes: "Mês atual", mes_anterior: "Mês anterior" };

export function deltaOf(current, previous, label) {
  const change = m.variation(current, previous);
  if (change === null) return { tone: "neutral", text: `sem base em ${label}` };
  return { tone: change >= 0 ? "positive" : "critical", text: `${change >= 0 ? "▲ +" : "▼ "}${pct(change)} vs ${label}` };
}

export function Painel() {
  const viewer = store.viewer();
  if (store.can("dashboard.executive")) return html`<${ExecutivePanel} />`;
  if (store.can("dashboard.manager")) return html`<${ManagerPanel} />`;
  return html`<${SellerPanel} viewer=${viewer} />`;
}

function ExecutivePanel() {
  const now = useNow(30_000);
  const [period, setPeriod] = useState("mes");
  const scope = store.scope();
  const { state } = store;
  const window = m.periodRange(period, now);
  const cur = m.salesSummary(state, window, scope);
  const prev = m.salesSummary(state, window.previous, scope);
  const queue = m.queueMetrics(state, window, scope);
  const queuePrev = m.queueMetrics(state, window.previous, scope);
  const stores = m.byStore(state, window, scope);
  const categories = m.byCategory(state, window, scope);
  const daily = m.dailyNet(state, 30, scope, now);
  const goals = STORES.map((s) => ({ store: s, g: m.goalProgress(state, now, s.id) }));
  const network = goals.reduce((acc, x) => ({ target: acc.target + x.g.targetCents, achieved: acc.achieved + x.g.achieved }), { target: 0, achieved: 0 });
  const alerts = state.alerts.filter((a) => a.status === "aberto" && scope.storeIds.includes(a.storeId)).slice(0, 6);
  const cash = m.cashStatus(state, scope, now);
  const prevLabel = window.previous.label;

  return html`<div className="view">
    <${PageHeader}
      title="Painel executivo"
      subtitle=${`Rede ${STORES.length} lojas · ${window.label}${period === "hoje" ? " até agora" : ""} · comparação com ${prevLabel}`}
      actions=${html`<${Segmented} label="Período" value=${period} options=${PERIOD_OPTIONS} onChange=${setPeriod} />`}
    />
    <div className="tiles">
      <${Tile} label="Faturamento líquido" value=${brl(cur.net)} delta=${deltaOf(cur.net, prev.net, prevLabel)} formula=${m.METRICS.net.formula} detail=${`Bruto ${brl(cur.gross)}`} />
      <${Tile} label="Vendas" value=${int(cur.count)} delta=${deltaOf(cur.count, prev.count, prevLabel)} formula=${m.METRICS.count.formula} detail=${`${int(cur.items)} peças`} />
      <${Tile} label="Ticket médio" value=${cur.ticket ? brl(cur.ticket) : "—"} delta=${deltaOf(cur.ticket, prev.ticket, prevLabel)} formula=${m.METRICS.ticket.formula} detail=${`${cur.itemsPerSale ? cur.itemsPerSale.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} itens por venda`} />
      <${Tile} label="Margem bruta" value=${pct(cur.margin)} formula=${m.METRICS.margin.formula} detail=${`Custo das mercadorias ${brl(cur.cost)}`} />
      <${Tile} label="Conversão" value=${pct(queue.conversion)} delta=${deltaOf(queue.conversion, queuePrev.conversion, prevLabel)} formula=${m.METRICS.conversion.formula} detail=${`${int(queue.converted)} de ${int(queue.attended)} atendimentos`} />
      <${Tile} label="Descontos" value=${brl(cur.discounts)} formula=${m.METRICS.discounts.formula} detail=${`${pct(cur.gross ? cur.discounts / cur.gross : null)} do bruto`} />
      <${Tile} label="Cancelamentos e devoluções" value=${`${int(cur.cancelled.count)} · ${int(cur.returned.count)}`} detail=${`${brl(cur.cancelled.cents)} cancelados · ${brl(cur.returned.cents)} devolvidos`} formula="Vendas canceladas no próprio dia e vendas devolvidas depois; ambas ficam fora do faturamento líquido." />
      <${Tile} label="Lucro líquido" value="Não calculado" tone="muted" formula=${m.METRICS.netProfit.formula} detail="Faltam despesas cadastradas" />
    </div>

    <div className="grid grid--2-1">
      <${Card} title="Faturamento líquido por dia" subtitle="Últimos 30 dias, todas as lojas">
        <${LineChart} title="Faturamento líquido por dia nos últimos 30 dias" points=${daily.map((d) => ({ label: shortDay(d.key), value: d.value }))} format=${brl} axisFormat=${brlCompact} />
      <//>
      <${Card} title="Meta da rede" subtitle="Mês atual">
        <div className="goal-big">
          <strong>${pct(network.achieved / network.target)}</strong>
          <span>${brl(network.achieved)} de ${brl(network.target)}</span>
        </div>
        <${Progress} value=${network.achieved / network.target} marker=${goals[0].g.expected} label=${`Meta da rede: ${pct(network.achieved / network.target)} atingido`} />
        <ul className="goal-list">
          ${goals.map(({ store: s, g }) => html`<li key=${s.id}>
            <span>${s.name}</span>
            <span className="num">${pct(g.progress, 0)}</span>
            <${Badge} tone=${g.projectionRatio >= 1 ? "positive" : g.projectionRatio >= 0.9 ? "attention" : "critical"}>projeção ${pct(g.projectionRatio, 0)}<//>
          </li>`)}
        </ul>
        <p className="muted small">${m.METRICS.goal.formula} Marcador = esperado até hoje.</p>
      <//>
    </div>

    <div className="grid grid--2">
      <${Card} title="Resultado por loja" subtitle=${window.label}>
        <${BarChart}
          title="Faturamento líquido por loja"
          rows=${[...stores].sort((a, b) => b.net - a.net).map((s) => ({ label: s.store.name, value: s.net, display: brl(s.net), note: `${int(s.count)} vendas · ticket ${s.ticket ? brl(s.ticket) : "—"} · margem ${pct(s.margin)}` }))}
        />
      <//>
      <${Card} title="Resultado por categoria" subtitle=${window.label}>
        <${BarChart} title="Faturamento líquido por categoria" rows=${categories.map((c) => ({ label: c.category, value: c.net, display: brl(c.net), note: `${int(c.qty)} peças · margem ${pct(c.margin)}` }))} />
      <//>
    </div>

    <div className="grid grid--2">
      <${Card} title="Alertas prioritários" actions=${html`<a href="#alertas" className="link">Ver todos</a>`}>
        ${alerts.length
          ? html`<ul className="alert-list">${alerts.map((a) => html`<li key=${a.id}>
              <${Badge} tone=${SEVERITY[a.severity].tone}>${SEVERITY[a.severity].label}<//>
              <div><strong>${a.rule}</strong> · ${STORES.find((s) => s.id === a.storeId).name}<p className="muted small">${a.detail}</p></div>
            </li>`)}</ul>`
          : html`<p className="empty">Nenhum alerta aberto. A rotina de monitoramento roda ao abrir a demonstração.</p>`}
      <//>
      <${Card} title="Caixas e atendimento" subtitle="Hoje">
        <${DataTable}
          columns=${["Loja", "Caixa", "Pendências", "Espera hoje"]}
          rows=${cash.map((c) => [
            c.store.name,
            c.current ? html`<${Badge} tone=${c.current.status === "aberto" ? "positive" : "neutral"}>${c.current.status === "aberto" ? "Aberto" : "Fechado"}<//>` : html`<${Badge} tone="neutral">Não aberto<//>`,
            c.pending.length || c.divergent.length ? html`<${Badge} tone="critical">${c.pending.length ? "Fechamento pendente" : `Divergência ${brl(c.divergent[0].diff)}`}<//>` : "—",
            minutesLabel(m.queueMetrics(state, m.periodRange("hoje", now), { storeIds: [c.store.id] }).avgWait),
          ])}
        />
      <//>
    </div>
  </div>`;
}
