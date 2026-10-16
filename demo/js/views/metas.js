// Goals and commissions: store and salesperson goals, versioned commission rules,
// statements estimated → calculated → approved → paid (closed ones are frozen).
import { SALESPEOPLE, STORES } from "../catalog.js";
import { brl, int, monthLabel, pct } from "../lib.js";
import * as m from "../metrics.js";
import { store } from "../app-store.js";
import { approveCommission } from "../ops.js";
import { AccessDenied, attempt, Badge, Card, DataTable, html, PageHeader, Progress, useNow } from "../ui.js";

const STATUS = { estimada: ["info", "Estimada"], apurada: ["attention", "Apurada"], aprovada: ["positive", "Aprovada"], paga: ["neutral", "Paga"] };

export function Metas() {
  return store.can("goals.read") || store.can("goals.own") ? html`<${MetasView} />` : html`<${AccessDenied} what="Metas e comissões" />`;
}

function MetasView() {
  const now = useNow(30_000);
  const { state } = store;
  const scope = store.scope();
  const month = state.meta.currentMonth;
  const window = m.periodRange("mes", now);
  const shops = scope.sellerId ? [] : STORES.filter((s) => scope.storeIds.includes(s.id)).map((s) => ({ shop: s, g: m.goalProgress(state, now, s.id) }));
  const people = SALESPEOPLE.filter((p) => m.inScope(scope, p.storeId, p.id)).map((p) => {
    const own = { storeIds: [p.storeId], sellerId: p.id };
    return { p, g: m.goalProgress(state, now, p.storeId, p.id), s: m.salesSummary(state, window, own), q: m.queueMetrics(state, window, own), est: m.commissionFor(state, p.id, month) };
  });
  const statements = state.commissionStatements.filter((c) => people.some((x) => x.p.id === c.sellerId)).sort((a, b) => b.month.localeCompare(a.month));
  const canApprove = store.can("commissions.approve");

  return html`<div className="view">
    <${PageHeader} title="Metas e comissões" subtitle=${`${monthLabel(month)} · metas fictícias definidas pela média histórica de cada loja`} />
    ${shops.length
      ? html`<${Card} title="Metas das lojas" subtitle=${m.METRICS.goal.formula}>
          <div className="goal-rows">
            ${shops.map(({ shop, g }) => html`<div key=${shop.id} className="goal-row">
              <div className="goal-row__head">
                <strong>${shop.name}</strong>
                <span className="num">${brl(g.achieved)} de ${brl(g.targetCents)}</span>
                <${Badge} tone=${g.projectionRatio >= 1 ? "positive" : g.projectionRatio >= 0.9 ? "attention" : "critical"}>${g.projectionRatio >= 1 ? "No ritmo" : g.projectionRatio >= 0.9 ? "Atenção" : "Em risco"} · projeção ${pct(g.projectionRatio, 0)}<//>
              </div>
              <${Progress} value=${g.progress} marker=${g.expected} tone=${g.projectionRatio >= 1 ? "positive" : g.projectionRatio >= 0.9 ? "attention" : "critical"} label=${`${shop.name}: ${pct(g.progress)} da meta`} />
              <p className="muted small">${pct(g.progress)} atingido · esperado até hoje ${pct(g.expected, 0)} · ritmo necessário ${brl(g.pace)}/dia em ${g.remainingDays} dia(s)</p>
            </div>`)}
          </div>
        <//>`
      : null}
    <${Card} title=${scope.sellerId ? "Minha meta" : "Vendedores"} subtitle="Mês atual; comissão estimada pela regra vigente">
      <${DataTable}
        numeric=${[2, 3, 4, 5, 6, 7, 8]}
        columns=${["Vendedor", "Loja", "Meta", "Realizado", "Atingido", "Ritmo/dia", "Ticket", "Conversão", "Comissão estimada"]}
        rows=${people.map(({ p, g, s, q, est }) => [p.name, STORES.find((x) => x.id === p.storeId).name, brl(g.targetCents), brl(g.achieved), pct(g.progress), brl(g.pace), s.ticket ? brl(s.ticket) : "—", pct(q.conversion), brl(est)])}
      />
    <//>
    <div className="grid grid--2-1">
      <${Card} title="Apurações de comissão" subtitle="Valores congelados após apuração; aprovação registrada na auditoria">
        <${DataTable}
          numeric=${[2]}
          columns=${["Vendedor", "Mês", "Valor", "Regra", "Situação", ""]}
          rows=${statements.map((c) => [
            SALESPEOPLE.find((p) => p.id === c.sellerId).name,
            monthLabel(c.month),
            brl(c.amountCents),
            `v${c.ruleVersion}`,
            html`<${Badge} tone=${STATUS[c.status][0]}>${STATUS[c.status][1]}<//>${c.approvedBy ? html`<small className="block muted">por ${c.approvedBy}</small>` : null}`,
            c.status === "apurada" && canApprove ? html`<button type="button" className="btn btn--secondary btn--small" onClick=${() => attempt(store, () => approveCommission(store, c.id), "Comissão aprovada.")}>Aprovar</button>` : "",
          ])}
        />
        ${!canApprove ? html`<p className="muted small">Aprovar apurações exige perfil de proprietário.</p>` : null}
      <//>
      <${Card} title="Regras de comissão" subtitle="Versionadas: uma regra nova não altera meses fechados">
        <ul className="plain">
          ${[...state.commissionRules].reverse().map((r) => html`<li key=${r.version}>
            <span><strong>v${r.version}</strong> · ${r.label}<small className="block muted">vigente desde ${r.validFrom.split("-").reverse().join("/")}</small></span>
            ${r.version === state.commissionRules.length ? html`<${Badge} tone="positive">Vigente<//>` : html`<${Badge} tone="neutral">Histórica<//>`}
          </li>`)}
        </ul>
        <p className="muted small">Base: faturamento líquido do item (preço × quantidade, com o desconto da venda rateado). Vendas canceladas ou devolvidas ficam fora. ${int(people.length)} vendedor(es) no seu acesso.</p>
      <//>
    </div>
  </div>`;
}
