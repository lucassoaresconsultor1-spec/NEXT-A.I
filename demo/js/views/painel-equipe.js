// Store manager and salesperson panels. A salesperson only ever sees their own numbers
// (the ranking shows a position, never colleagues' values).
import { SALESPEOPLE, STORES } from "../catalog.js";
import { addDays, brl, dayKey, dayStart, daysInMonth, int, monthLabel, pct, shortDay, minutesLabel } from "../lib.js";
import * as m from "../metrics.js";
import { store } from "../app-store.js";
import { DotProgress, LineChart } from "../charts.js";
import { todaySession } from "../pdv-ops.js";
import { Badge, brlCompact, Card, DataTable, html, PageHeader, SEVERITY, Tile, useNow } from "../ui.js";
import { AssistantCard, Delta, HeroCard, MiniStats, reais } from "./widgets.js";

const COMMISSION_STATUS = { estimada: "Estimada", apurada: "Apurada (aguarda aprovação)", aprovada: "Aprovada", paga: "Paga" };
const COMMISSION_TONE = { estimada: "info", apurada: "attention", aprovada: "positive", paga: "neutral" };

export function ManagerPanel() {
  const now = useNow(15_000);
  const { state } = store;
  const storeId = store.viewer().storeIds[0];
  const shop = STORES.find((s) => s.id === storeId);
  const scope = { storeIds: [storeId] };
  const today = m.periodRange("hoje", now);
  const cur = m.salesSummary(state, today, scope);
  const prev = m.salesSummary(state, today.previous, scope);
  const queue = m.queueMetrics(state, today, scope);
  const goal = m.goalProgress(state, now, storeId);
  const waiting = state.attendances.filter((a) => a.storeId === storeId && a.status === "aguardando").length;
  const session = todaySession(state, storeId, now);
  const stock = m.stockRows(state, storeId, now).filter((r) => r.status === "ruptura" || r.status === "critico");
  const month = m.periodRange("mes", now);
  const team = m.bySeller(state, month, scope).map((x) => ({ ...x, today: m.salesSummary(state, today, { storeIds: [storeId], sellerId: x.person.id }), g: m.goalProgress(state, now, storeId, x.person.id) }));
  const alerts = state.alerts.filter((a) => a.storeId === storeId && a.status === "aberto");
  const tasks = state.tasks.filter((t) => t.storeId === storeId && t.status !== "concluida");

  return html`<div className="view">
    <${PageHeader} title=${`Painel da loja · ${shop.name}`} subtitle=${`Hoje até agora · comparação com ontem até o mesmo horário · gerente ${store.viewer().name}`} />
    <div className="grid grid--hero">
      <${HeroCard}
        label="Vendas do dia"
        value=${reais(cur.net)}
        delta=${html`<${Delta} current=${cur.net} previous=${prev.net} label="ontem até o mesmo horário" />`}
        note=${`${int(cur.count)} vendas · ${m.METRICS.net.formula}`}
        actions=${[{ href: "#pdv", label: "Abrir PDV", kind: "light" }, { href: "#fila", label: "Fila", kind: "dark" }]}
      />
      <${MiniStats}
        title="Hoje na loja"
        items=${[
          { icon: "metas", label: "Meta diária", value: pct(cur.net / goal.dailyTarget, 0), delta: html`<span className="mini-stat__note">de ${brlCompact(goal.dailyTarget)}</span>` },
          { icon: "caixa", label: "Ticket médio", value: cur.ticket ? brl(cur.ticket) : "—", delta: html`<${Delta} current=${cur.ticket} previous=${prev.ticket} label="ontem" />` },
          { icon: "fila", label: "Conversão", value: pct(queue.conversion), delta: html`<span className="mini-stat__note">${int(queue.converted)} de ${int(queue.attended)}</span>` },
        ]}
      />
      <${AssistantCard} questions=${["Como estão as vendas hoje?", "Quais vendedores precisam de acompanhamento?", "Onde o tempo de espera aumentou?"]} />
    </div>
    <div className="tiles">
      <${Tile} label="Meta do mês" value=${pct(goal.progress)} detail=${`Ritmo necessário ${brl(goal.pace)}/dia`} formula=${`${m.METRICS.goal.formula} ${m.METRICS.pace.formula}`} />
      <${Tile} label="Fila agora" value=${`${waiting} aguardando`} detail=${`Espera média hoje ${minutesLabel(queue.avgWait)}`} formula=${m.METRICS.wait.formula} />
      <${Tile} label="Caixa" value=${session ? (session.status === "aberto" ? "Aberto" : "Fechado") : "Não aberto"} detail=${session ? `Esperado na gaveta ${brl(m.cashExpected(state, session))}` : "Abra o caixa no módulo Caixa"} />
      <${Tile} label="Estoque crítico" value=${`${stock.length} itens`} tone=${stock.length ? "attention" : undefined} detail=${stock.slice(0, 2).map((r) => `${r.product.name} ${r.product.variant}`).join(", ") || "Nenhum"} />
    </div>
    <div className="grid grid--2-1">
      <${Card} title="Desempenho da equipe" subtitle="Hoje e mês atual">
        <${DataTable}
          numeric=${[1, 2, 3, 4]}
          columns=${["Vendedor", "Hoje", "Mês", "Meta", "Conversão"]}
          rows=${team.map((x) => [x.person.name, brl(x.today.net), brl(x.net), x.g ? pct(x.g.progress, 0) : "—", pct(x.queue.conversion)])}
        />
        <p className="muted small">Cancelamentos hoje: ${int(cur.cancelled.count)} · devoluções: ${int(cur.returned.count)}.</p>
      <//>
      <${Card} title="Alertas e tarefas da loja" actions=${html`<a className="link" href="#alertas">Abrir</a>`}>
        ${alerts.length + tasks.length === 0 ? html`<p className="empty">Nada pendente.</p>` : null}
        <ul className="alert-list">
          ${alerts.map((a) => html`<li key=${a.id}><${Badge} tone=${SEVERITY[a.severity].tone}>${SEVERITY[a.severity].label}<//><div><strong>${a.rule}</strong><p className="muted small">${a.detail}</p></div></li>`)}
          ${tasks.map((t) => html`<li key=${t.id}><${Badge} tone="info">Tarefa<//><div><strong>${t.title}</strong><p className="muted small">Prazo ${t.due.split("-").reverse().join("/")} · ${t.assignee}</p></div></li>`)}
        </ul>
      <//>
    </div>
  </div>`;
}

export function SellerPanel({ viewer }) {
  const now = useNow(15_000);
  const { state } = store;
  const person = SALESPEOPLE.find((p) => p.id === viewer.sellerId);
  const own = { storeIds: [person.storeId], sellerId: person.id };
  const today = m.salesSummary(state, m.periodRange("hoje", now), own);
  const monthWindow = m.periodRange("mes", now);
  const month = m.salesSummary(state, monthWindow, own);
  const queue = m.queueMetrics(state, monthWindow, own);
  const goal = m.goalProgress(state, now, person.storeId, person.id);
  const key = dayKey(now);
  const weekday = (new Date(dayStart(key) + 12 * 3600_000).getUTCDay() + 6) % 7;
  const weekStart = dayStart(addDays(key, -weekday));
  const week = m.salesSummary(state, { from: weekStart, to: now }, own);
  const weekTarget = Math.round((goal.targetCents * 7) / daysInMonth(state.meta.currentMonth));
  const daily = m.dailyNet(state, 30, own, now);
  const teammates = m.bySeller(state, monthWindow, { storeIds: [person.storeId] }).sort((a, b) => b.net - a.net);
  const position = teammates.findIndex((x) => x.person.id === person.id) + 1;
  const statements = [
    { month: state.meta.currentMonth, status: "estimada", amountCents: m.commissionFor(state, person.id, state.meta.currentMonth), ruleVersion: 2 },
    ...state.commissionStatements.filter((c) => c.sellerId === person.id).sort((a, b) => b.month.localeCompare(a.month)),
  ];
  const rule = state.commissionRules.at(-1);

  return html`<div className="view">
    <${PageHeader} title=${`Meu painel · ${person.name}`} subtitle=${`${STORES.find((s) => s.id === person.storeId).name} · somente os seus números`} />
    <div className="grid grid--hero">
      <${HeroCard}
        label="Minhas vendas hoje"
        value=${reais(today.net)}
        note=${`${int(today.count)} vendas · meta do dia ${brl(goal.dailyTarget)}`}
        actions=${[{ href: "#pdv", label: "Abrir PDV", kind: "light" }, { href: "#fila", label: "Fila", kind: "dark" }]}
      />
      <${MiniStats}
        title="Minhas metas"
        items=${[
          { icon: "metas", label: "Semana", value: pct(week.net / weekTarget, 0), delta: html`<span className="mini-stat__note">${brlCompact(week.net)} de ${brlCompact(weekTarget)}</span>` },
          { icon: "relatorios", label: "Mês", value: pct(goal.progress), delta: html`<span className="mini-stat__note">ritmo ${brlCompact(goal.pace)}/dia</span>` },
          { icon: "fila", label: "Conversão (mês)", value: pct(queue.conversion), delta: html`<span className="mini-stat__note">${int(queue.converted)} vendas</span>` },
        ]}
      />
      <${AssistantCard} questions=${["Como estão as vendas hoje?", "Qual a política de descontos?", "Qual a política de trocas?"]} />
    </div>
    <div className="tiles">
      <${Tile} label="Ticket médio (mês)" value=${month.ticket ? brl(month.ticket) : "—"} detail=${`${month.itemsPerSale ? month.itemsPerSale.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} itens por venda`} formula=${m.METRICS.ticket.formula} />
      <${Tile} label="Atendimentos (mês)" value=${int(queue.attended)} detail=${`${int(queue.converted)} com venda`} />
      <${Tile} label="Posição na loja" value=${`${position}º de ${teammates.length}`} detail="Faturamento líquido do mês; política da empresa mostra só a posição" />
    </div>
    <div className="grid grid--2-1">
      <${Card} title="Meu histórico" subtitle="Faturamento líquido por dia, 30 dias">
        <${LineChart} title="Meu faturamento líquido por dia" points=${daily.map((d) => ({ label: shortDay(d.key), value: d.value }))} format=${brl} axisFormat=${brlCompact} height=${180} />
        <div className="goal-inline"><span>Meta do mês · ${pct(goal.progress)}</span><${DotProgress} value=${goal.progress} label=${`Meta do mês: ${pct(goal.progress)} atingido`} /></div>
      <//>
      <${Card} title="Minhas comissões" subtitle=${`Regra vigente v${rule.version}: ${rule.label}`}>
        <ul className="commission-list">
          ${statements.map((c) => html`<li key=${c.month}>
            <span>${monthLabel(c.month)}</span>
            <strong className="num">${brl(c.amountCents)}</strong>
            <${Badge} tone=${COMMISSION_TONE[c.status]}>${COMMISSION_STATUS[c.status]}<//>
          </li>`)}
        </ul>
        <p className="muted small">Estimada muda até o fechamento; apurada aguarda aprovação; aprovada e paga ficam congeladas. Devoluções saem da base.</p>
      <//>
    </div>
  </div>`;
}
