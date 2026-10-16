// Backend tools the agents may call. Each one checks permission and scope, computes
// with the deterministic metrics and returns facts, hypotheses and recommendations
// separately. No tool runs free-form queries; no number comes from generated text.
import { PRODUCTS, PROCEDURES, STORES, SUPPLIERS } from "./catalog.js";
import { brl, int, minutesLabel, normalize, pct, ratio, shortDay, spHour, sum } from "./lib.js";
import * as m from "./metrics.js";

const storeName = (id) => STORES.find((s) => s.id === id).name;
const productName = (id) => {
  const p = PRODUCTS.find((x) => x.id === id);
  return `${p.name} ${p.variant}`;
};
const signed = (v) => (v === null ? "sem base de comparação" : `${v >= 0 ? "+" : ""}${pct(v)}`);
const blocked = (reason) => ({ blocked: true, reason });
const STOCK_LABELS = { ruptura: "Ruptura", critico: "Abaixo do mínimo", excesso: "Excesso" };
const result = (fields) => ({ facts: [], hypotheses: [], recommendations: [], limitations: [], ...fields });

export const TOOLS = {
  get_sales_summary: {
    label: "Resumo de vendas",
    run({ state, scope, now, params, can }) {
      if (!can("sales.read") && !can("sales.own")) return blocked("Seu perfil não consulta vendas.");
      const window = m.periodRange(params.period, now);
      const cur = m.salesSummary(state, window, scope);
      const prev = m.salesSummary(state, window.previous, scope);
      const change = m.variation(cur.net, prev.net);
      const r = result({ filters: [window.label, `comparado com ${window.previous.label}`] });
      if (cur.count === 0) {
        r.facts.push(`Nenhuma venda concluída em ${window.label.toLowerCase()} no seu acesso.`);
        r.limitations.push("Sem vendas no período, não há ticket médio nem margem para calcular.");
        return r;
      }
      r.facts.push(`Faturamento líquido de ${brl(cur.net)} em ${int(cur.count)} vendas (ticket médio ${brl(cur.ticket)}).`);
      r.facts.push(`Variação contra ${window.previous.label}: ${signed(change)} (${brl(prev.net)}).`);
      r.facts.push(`Descontos de ${brl(cur.discounts)}; margem bruta de ${pct(cur.margin)}; ${cur.cancelled.count} cancelamento(s).`);
      if (change !== null && change < -0.1) {
        r.hypotheses.push("A queda pode vir de menos atendimentos ou de conversão menor; os dados de fila ajudam a separar as duas causas.");
        r.recommendations.push({ text: "Pedir ao Especialista de Atendimento a conversão do mesmo período." });
      }
      if (params.period === "hoje") r.limitations.push("O dia ainda está em andamento; a comparação usa ontem até o mesmo horário.");
      if (scope.storeIds.length > 1 && !scope.sellerId) {
        r.table = {
          columns: ["Loja", "Líquido", "Vendas", "Ticket", "Margem"],
          rows: m.byStore(state, window, scope).map((s) => [s.store.name, brl(s.net), int(s.count), s.ticket ? brl(s.ticket) : "—", pct(s.margin)]),
        };
      }
      r.data = { current: cur, previous: prev, change, window };
      return r;
    },
  },

  compare_store_performance: {
    label: "Comparação entre lojas",
    run({ state, scope, now, params, can }) {
      if (!can("reports.network") || scope.storeIds.length < 2) return blocked("Comparar lojas exige acesso à rede; seu perfil vê apenas a própria loja.");
      const window = m.periodRange(params.period, now);
      const rows = m.byStore(state, window, scope).map((s) => {
        const prev = m.salesSummary(state, window.previous, { storeIds: [s.store.id] });
        const queue = m.queueMetrics(state, window, { storeIds: [s.store.id] });
        return { ...s, change: m.variation(s.net, prev.net), conversion: queue.conversion };
      });
      const ranked = [...rows].sort((a, b) => b.net - a.net);
      const r = result({ filters: [window.label, `variação contra ${window.previous.label}`] });
      r.facts.push(`Maior faturamento: ${ranked[0].store.name} (${brl(ranked[0].net)}). Menor: ${ranked.at(-1).store.name} (${brl(ranked.at(-1).net)}).`);
      const worst = [...rows].filter((x) => x.change !== null).sort((a, b) => a.change - b.change)[0];
      if (worst && worst.change < 0) r.facts.push(`Maior queda: ${worst.store.name}, ${signed(worst.change)}.`);
      r.table = {
        columns: ["Loja", "Líquido", "Variação", "Ticket", "Conversão", "Margem"],
        rows: ranked.map((s) => [s.store.name, brl(s.net), signed(s.change), s.ticket ? brl(s.ticket) : "—", pct(s.conversion), pct(s.margin)]),
      };
      r.data = { rows };
      return r;
    },
  },

  get_goal_status: {
    label: "Metas do mês",
    run({ state, scope, now, can }) {
      if (!can("goals.read") && !can("goals.own")) return blocked("Seu perfil não consulta metas.");
      const targets = scope.sellerId
        ? [{ label: "Sua meta", storeId: scope.storeIds[0], sellerId: scope.sellerId }]
        : STORES.filter((s) => scope.storeIds.includes(s.id)).map((s) => ({ label: s.name, storeId: s.id }));
      const rows = targets.map((t) => ({ ...t, g: m.goalProgress(state, now, t.storeId, t.sellerId) })).filter((t) => t.g);
      const r = result({ filters: ["Mês atual", "projeção linear pelo ritmo do mês"] });
      const behind = rows.filter((t) => t.g.projectionRatio < 0.95);
      if (behind.length === 0) r.facts.push("Todas as metas do seu acesso estão no ritmo para serem atingidas.");
      for (const t of behind) {
        r.facts.push(`${t.label}: ${pct(t.g.progress)} da meta com ${pct(t.g.expected, 0)} do mês decorrido; projeção de ${pct(t.g.projectionRatio, 0)}.`);
        r.recommendations.push({ text: `${t.label}: vender ${brl(t.g.pace)} por dia até o fim do mês para atingir ${brl(t.g.targetCents)}.` });
      }
      if (behind.length) r.hypotheses.push("Ritmo abaixo do esperado costuma combinar menos fluxo e conversão menor; vale cruzar com a fila.");
      r.limitations.push("Projeção linear: não considera sazonalidade de fim de mês nem campanhas.");
      r.table = {
        columns: ["Escopo", "Meta", "Realizado", "Atingido", "Projeção", "Ritmo/dia"],
        rows: rows.map((t) => [t.label, brl(t.g.targetCents), brl(t.g.achieved), pct(t.g.progress), pct(t.g.projectionRatio, 0), t.g.pace !== null ? brl(t.g.pace) : "—"]),
      };
      r.data = { rows, behind };
      return r;
    },
  },

  get_salesperson_metrics: {
    label: "Desempenho de vendedores",
    run({ state, scope, now, params, can }) {
      if (!can("sales.read") && !can("sales.own")) return blocked("Seu perfil não consulta vendedores.");
      const window = m.periodRange(params.period ?? "mes", now);
      const rows = m.bySeller(state, window, scope).map((s) => ({ ...s, g: m.goalProgress(state, now, s.person.storeId, s.person.id) }));
      const r = result({ filters: [window.label, scope.sellerId ? "somente seus números" : "vendedores do seu acesso"] });
      for (const storeId of scope.storeIds) {
        const team = rows.filter((x) => x.person.storeId === storeId);
        const avg = ratio(sum(team, (x) => x.queue.converted), sum(team, (x) => x.queue.attended));
        for (const x of team) {
          if (scope.sellerId || avg === null || x.queue.conversion === null) continue;
          if (x.queue.conversion < avg - 0.08) {
            r.facts.push(`${x.person.name} (${storeName(storeId)}): conversão de ${pct(x.queue.conversion)} contra ${pct(avg)} da equipe.`);
            r.recommendations.push({ text: `Acompanhar ${x.person.name}: revisar atendimentos sem venda e motivos registrados.`, approval: { type: "task", title: `Acompanhamento de ${x.person.name}`, storeId, assignee: "Gerente da loja" } });
          }
        }
      }
      if (scope.sellerId) {
        const me = rows[0];
        r.facts.push(`Você vendeu ${brl(me.net)} em ${int(me.count)} vendas; conversão de ${pct(me.queue.conversion)}.`);
      } else if (r.facts.length === 0) r.facts.push("Nenhum vendedor com conversão muito abaixo da própria equipe.");
      r.limitations.push("Conversão compara pessoas da mesma loja; lojas com fluxo diferente não são comparadas entre si.");
      r.table = {
        columns: ["Vendedor", "Loja", "Líquido", "Vendas", "Conversão", "Meta"],
        rows: rows.map((x) => [x.person.name, storeName(x.person.storeId), brl(x.net), int(x.count), pct(x.queue.conversion), x.g ? pct(x.g.progress) : "—"]),
      };
      return r;
    },
  },

  get_inventory_alerts: {
    label: "Alertas de estoque",
    run({ state, scope, now, can }) {
      if (!can("inventory.read")) return blocked("Seu perfil não consulta estoque.");
      const { alerts, transfers } = m.inventoryAlerts(state, scope, now);
      const r = result({ filters: ["Saldo atual pelo livro de movimentações", "giro dos últimos 30 dias"] });
      const count = (status) => alerts.filter((a) => a.status === status).length;
      r.facts.push(`${count("ruptura")} item(ns) em ruptura, ${count("critico")} abaixo do mínimo e ${count("excesso")} com excesso.`);
      for (const t of transfers.slice(0, 3)) {
        r.recommendations.push({
          text: `Transferir ${t.qty} un. de ${productName(t.productId)} da ${storeName(t.fromStoreId)} para a ${storeName(t.toStoreId)}.`,
          approval: { type: "transfer", ...t },
        });
      }
      const covered = new Set(transfers.map((t) => `${t.toStoreId}:${t.productId}`));
      for (const a of alerts.filter((x) => x.status !== "excesso" && !covered.has(`${x.storeId}:${x.product.id}`)).slice(0, 3)) {
        r.recommendations.push({ text: `Repor ${productName(a.product.id)} na ${storeName(a.storeId)} com ${SUPPLIERS[a.product.brand]}: ${a.product.minStock * 3 - a.balance} un.` });
      }
      if (count("ruptura")) r.hypotheses.push("Rupturas aparecem nos motivos de não conversão como numeração indisponível.");
      r.limitations.push("Sem pedidos de compra em aberto na demo: a reposição sugerida não desconta mercadoria a caminho.");
      r.table = {
        columns: ["Produto", "Loja", "Saldo", "Mínimo", "Vendas 30d", "Situação"],
        rows: alerts.slice(0, 12).map((a) => [productName(a.product.id), storeName(a.storeId), int(a.balance), int(a.product.minStock), int(a.sold30), STOCK_LABELS[a.status]]),
      };
      return r;
    },
  },

  get_queue_metrics: {
    label: "Indicadores da fila",
    run({ state, scope, now, params, can }) {
      if (!can("queue.read")) return blocked("Seu perfil não consulta a fila.");
      const window = m.periodRange(params.period ?? "7d", now);
      const rows = STORES.filter((s) => scope.storeIds.includes(s.id)).map((s) => {
        const own = { storeIds: [s.id] };
        const cur = m.queueMetrics(state, window, own);
        const prev = m.queueMetrics(state, window.previous, own);
        return { store: s, cur, prev, change: cur.avgWait !== null && prev.avgWait ? (cur.avgWait - prev.avgWait) / prev.avgWait : null, peak: peakHour(state, s.id, window) };
      });
      const r = result({ filters: [window.label, `comparado com ${window.previous.label}`] });
      const worse = rows.filter((x) => x.change !== null && x.change > 0.2).sort((a, b) => b.change - a.change);
      if (worse.length === 0) r.facts.push("O tempo de espera não aumentou mais de 20% em nenhuma loja do seu acesso.");
      for (const x of worse) {
        r.facts.push(`${x.store.name}: espera média de ${minutesLabel(x.cur.avgWait)} (antes ${minutesLabel(x.prev.avgWait)}); ${int(x.cur.abandoned)} desistência(s).`);
        if (x.peak) r.recommendations.push({ text: `Reforçar a escala da ${x.store.name} por volta das ${x.peak}h, horário com maior espera no período.` });
      }
      if (worse.length) r.hypotheses.push("Espera maior com o mesmo número de vendedores indica fluxo acima da capacidade nos picos.");
      r.table = {
        columns: ["Loja", "Chegadas", "Espera média", "Desistências", "Conversão"],
        rows: rows.map((x) => [x.store.name, int(x.cur.arrivals), minutesLabel(x.cur.avgWait), pct(x.cur.abandonment), pct(x.cur.conversion)]),
      };
      return r;
    },
  },

  get_cash_register_status: {
    label: "Situação dos caixas",
    run({ state, scope, now, can }) {
      if (!can("cash.read")) return blocked("Seu perfil não consulta caixas.");
      const rows = m.cashStatus(state, scope, now);
      const r = result({ filters: ["Hoje e últimos 7 dias", "divergência acima de R$ 5,00"] });
      const open = rows.filter((x) => x.current?.status === "aberto").length;
      r.facts.push(`${open} de ${rows.length} caixa(s) aberto(s) hoje.`);
      for (const x of rows) {
        for (const p of x.pending) {
          r.facts.push(`${x.store.name}: fechamento de ${shortDay(p.day)} pendente.`);
          r.recommendations.push({ text: `Fechar o caixa de ${shortDay(p.day)} da ${x.store.name} informando o valor contado.` });
        }
        for (const d of x.divergent) {
          r.facts.push(`${x.store.name}: divergência de ${brl(d.diff)} no fechamento de ${shortDay(d.session.day)}.`);
          r.recommendations.push({ text: `Justificar a divergência de ${brl(d.diff)} da ${x.store.name}.`, approval: { type: "task", title: `Justificar divergência de caixa (${x.store.name})`, storeId: x.store.id, assignee: "Gerente da loja" } });
        }
      }
      const cancelled = m.salesIn(state, { from: now - 7 * 86_400_000, to: now }, scope).filter((s) => s.status === "cancelada");
      r.facts.push(`${cancelled.length} venda(s) cancelada(s) nos últimos 7 dias.`);
      return r;
    },
  },

  get_financial_summary: {
    label: "Resumo financeiro",
    run({ state, scope, now, params, can }) {
      if (!can("reports.read")) return blocked("Seu perfil não consulta indicadores financeiros.");
      const window = m.periodRange(params.period ?? "mes", now);
      const sales = m.salesIn(state, window, scope).filter((s) => s.status === "concluida");
      const s = m.summarize(sales);
      const r = result({ filters: [window.label, "vendas concluídas"] });
      r.facts.push(`Faturamento líquido ${brl(s.net)}; custo das mercadorias ${brl(s.cost)}; margem bruta ${pct(s.margin)}.`);
      const mix = ["credito", "debito", "pix", "dinheiro"].map((method) => [method, sum(sales, (x) => sum(x.payments.filter((p) => p.method === method), (p) => p.cents))]);
      const total = sum(mix, (x) => x[1]);
      r.facts.push(`Recebido por meio: ${mix.map(([method, cents]) => `${method} ${pct(ratio(cents, total), 0)}`).join(", ")}.`);
      if (ratio(s.discounts, s.gross) > 0.04) r.recommendations.push({ text: `Descontos somam ${pct(ratio(s.discounts, s.gross))} do bruto; revisar a política de descontos.` });
      r.limitations.push(m.METRICS.netProfit.formula);
      r.limitations.push("Recebimento por cartão é o valor vendido; taxas e prazos da adquirente não estão cadastrados.");
      return r;
    },
  },

  search_company_procedures: {
    label: "Busca em procedimentos",
    run({ params }) {
      const words = normalize(params.query).split(/\W+/).filter((w) => w.length > 3);
      const scored = PROCEDURES.map((doc) => ({ doc, score: words.filter((w) => normalize(`${doc.title} ${doc.text}`).includes(w)).length })).filter((x) => x.score > 0);
      const r = result({ filters: ["Base de procedimentos da empresa (fictícia)"] });
      if (scored.length === 0) {
        r.facts.push("Não encontrei procedimento sobre isso na base da empresa.");
        r.limitations.push("A resposta só usa documentos cadastrados; não completo lacunas com suposições.");
        return r;
      }
      const best = scored.sort((a, b) => b.score - a.score).slice(0, 2);
      for (const { doc } of best) r.facts.push(`${doc.title}: ${doc.text}`);
      r.sources = best.map(({ doc }) => `${doc.title} (atualizado em ${doc.updated.split("-").reverse().join("/")})`);
      return r;
    },
  },
};

function peakHour(state, storeId, window) {
  const byHour = new Map();
  for (const a of state.attendances) {
    if (a.storeId !== storeId || a.calledAt === null || a.arrivedAt < window.from || a.arrivedAt >= window.to) continue;
    const h = Math.floor(spHour(a.arrivedAt));
    const row = byHour.get(h) ?? { total: 0, n: 0 };
    row.total += a.calledAt - a.arrivedAt;
    row.n += 1;
    byHour.set(h, row);
  }
  const best = [...byHour.entries()].filter(([, v]) => v.n >= 3).sort((a, b) => b[1].total / b[1].n - a[1].total / a[1].n)[0];
  return best ? best[0] : null;
}

