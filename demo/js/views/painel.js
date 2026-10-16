// Executive dashboard (organization-wide). Managers and sellers get their own panels.
import { STORES } from "../catalog.js";
import { brl, int, pct, shortDay, minutesLabel } from "../lib.js";
import * as m from "../metrics.js";
import { store } from "../app-store.js";
import { BarChart, ColumnChart, Donut, Gauge } from "../charts.js";
import { Badge, brlCompact, Card, DataTable, html, PageHeader, Segmented, SEVERITY, Tile, useNow, useState } from "../ui.js";
import { ManagerPanel, SellerPanel } from "./painel-equipe.js";
import { AssistantCard, Delta, HeroCard, MiniStats, reais, StoreGoalCards } from "./widgets.js";

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
  const goals = STORES.map((s) => m.goalProgress(state, now, s.id));
  const network = goals.reduce((acc, g) => ({ target: acc.target + g.targetCents, achieved: acc.achieved + g.achieved, projection: acc.projection + g.projection }), { target: 0, achieved: 0, projection: 0 });
  const networkStatus = network.projection >= network.target ? "No ritmo" : network.projection >= network.target * 0.9 ? "Atenção" : "Em risco";
  const alerts = state.alerts.filter((a) => a.status === "aberto" && scope.storeIds.includes(a.storeId)).slice(0, 5);
  const cash = m.cashStatus(state, scope, now);
  const prevLabel = window.previous.label;

  return html`<div className="view">
    <${PageHeader}
      title="Painel executivo"
      subtitle=${`Rede com ${STORES.length} lojas · ${window.label}${period === "hoje" ? " até agora" : ""} · comparação com ${prevLabel}`}
      actions=${html`<${Segmented} label="Período" value=${period} options=${PERIOD_OPTIONS} onChange=${setPeriod} />`}
    />
    <div className="grid grid--hero">
      <${HeroCard}
        label="Faturamento líquido"
        value=${reais(cur.net)}
        delta=${html`<${Delta} current=${cur.net} previous=${prev.net} label=${prevLabel} />`}
        note=${`Bruto ${brl(cur.gross)} − descontos ${brl(cur.discounts)} · vendas concluídas`}
        actions=${[{ href: "#pdv", label: "Abrir PDV", kind: "light" }, { href: "#relatorios", label: "Relatórios", kind: "dark" }]}
      />
      <${MiniStats}
        title="Indicadores do período"
        items=${[
          { icon: "pdv", label: "Vendas", value: int(cur.count), delta: html`<${Delta} current=${cur.count} previous=${prev.count} label=${prevLabel} />` },
          { icon: "caixa", label: "Ticket médio", value: cur.ticket ? brl(cur.ticket) : "—", delta: html`<${Delta} current=${cur.ticket} previous=${prev.ticket} label=${prevLabel} />` },
          { icon: "relatorios", label: "Margem bruta", value: pct(cur.margin), delta: html`<span className="mini-stat__note">custo ${brlCompact(cur.cost)}</span>` },
        ]}
      />
      <${Card} title="Meta da rede" subtitle="Mês atual · projeção linear">
        <${Gauge} value=${network.achieved / network.target} display=${pct(network.achieved / network.target, 0)} caption=${`${brl(network.achieved)} de ${brl(network.target)}`} label=${`Meta da rede: ${pct(network.achieved / network.target)} atingido`} />
        <p className=${`status-word status-word--${networkStatus === "No ritmo" ? "ok" : networkStatus === "Atenção" ? "warn" : "risk"}`}>${networkStatus} <span>projeção ${pct(network.projection / network.target, 0)}</span></p>
      <//>
    </div>

    <div className="grid grid--2-1">
      <${Card} title="Faturamento líquido por dia" subtitle="Últimos 30 dias, todas as lojas · hoje em destaque">
        <${ColumnChart} title="Faturamento líquido por dia nos últimos 30 dias" points=${daily.map((d) => ({ label: shortDay(d.key), value: d.value }))} format=${brl} axisFormat=${brlCompact} lastLabel=${`Hoje até agora: ${brlCompact(daily.at(-1).value)}`} />
      <//>
      <${AssistantCard} />
    </div>

    <section className="section">
      <h2 className="section__title">Metas por loja <span>· ${m.METRICS.goal.formula}</span></h2>
      <${StoreGoalCards} storeIds=${scope.storeIds} now=${now} />
    </section>

    <div className="grid grid--3">
      <${Card} title="Resultado por loja" subtitle=${window.label}>
        <${BarChart}
          title="Faturamento líquido por loja"
          rows=${[...stores].sort((a, b) => b.net - a.net).map((s) => ({ label: s.store.name, value: s.net, display: brlCompact(s.net), note: `${int(s.count)} vendas · ticket ${s.ticket ? brl(s.ticket) : "—"} · margem ${pct(s.margin)}` }))}
        />
      <//>
      <${Card} title="Por categoria" subtitle=${`${window.label} · faturamento líquido`}>
        <${Donut} title="Faturamento líquido por categoria" centerLabel="Total" segments=${categories.map((c) => ({ label: c.category, value: c.net }))} format=${(v, short) => (short ? brlCompact(v) : brl(v))} />
      <//>
      <${Card} title="Alertas prioritários" actions=${html`<a href="#alertas" className="link">Ver todos</a>`}>
        ${alerts.length
          ? html`<ul className="alert-list">${alerts.map((a) => html`<li key=${a.id}>
              <${Badge} tone=${SEVERITY[a.severity].tone}>${SEVERITY[a.severity].label}<//>
              <div><strong>${a.rule}</strong> · ${STORES.find((s) => s.id === a.storeId).name}<p className="muted small">${a.detail}</p></div>
            </li>`)}</ul>`
          : html`<p className="empty">Nenhum alerta aberto. A rotina de monitoramento roda ao abrir a demonstração.</p>`}
      <//>
    </div>

    <div className="tiles">
      <${Tile} label="Conversão" value=${pct(queue.conversion)} delta=${deltaOf(queue.conversion, queuePrev.conversion, prevLabel)} formula=${m.METRICS.conversion.formula} detail=${`${int(queue.converted)} de ${int(queue.attended)} atendimentos`} />
      <${Tile} label="Descontos" value=${brl(cur.discounts)} formula=${m.METRICS.discounts.formula} detail=${`${pct(cur.gross ? cur.discounts / cur.gross : null)} do bruto`} />
      <${Tile} label="Cancelamentos e devoluções" value=${`${int(cur.cancelled.count)} · ${int(cur.returned.count)}`} detail=${`${brl(cur.cancelled.cents)} cancelados · ${brl(cur.returned.cents)} devolvidos`} formula="Vendas canceladas no próprio dia e vendas devolvidas depois; ambas ficam fora do faturamento líquido." />
      <${Tile} label="Lucro líquido" value="Não calculado" tone="muted" formula=${m.METRICS.netProfit.formula} detail="Faltam despesas cadastradas" />
    </div>

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
  </div>`;
}
