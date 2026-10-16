// Deterministic indicators. Dashboards, reports and agents all call these same
// functions, so one indicator has one value everywhere (no number comes from text).
import { PRODUCTS, SALESPEOPLE, STORES } from "./catalog.js";
import { addDays, DAY_MS, dayKey, dayStart, daysInMonth, monthKey, previousMonth, ratio, sum } from "./lib.js";

export const METRICS = {
  gross: { label: "Faturamento bruto", formula: "Soma de preço × quantidade dos itens das vendas concluídas, antes de descontos." },
  discounts: { label: "Descontos", formula: "Soma dos descontos concedidos nas vendas concluídas." },
  net: { label: "Faturamento líquido", formula: "Faturamento bruto − descontos das vendas concluídas. Vendas canceladas e devolvidas ficam fora." },
  count: { label: "Vendas", formula: "Quantidade de vendas concluídas no período." },
  ticket: { label: "Ticket médio", formula: "Faturamento líquido ÷ vendas concluídas." },
  itemsPerSale: { label: "Itens por venda", formula: "Peças vendidas ÷ vendas concluídas." },
  margin: { label: "Margem bruta", formula: "(Faturamento líquido − custo das mercadorias vendidas) ÷ faturamento líquido. Custo = custo unitário cadastrado × quantidade." },
  conversion: { label: "Conversão", formula: "Atendimentos de venda encerrados com venda ÷ atendimentos de venda encerrados. Trocas, retiradas e desistências ficam fora do denominador." },
  wait: { label: "Espera média", formula: "Média de (chamada − chegada) dos clientes chamados no período." },
  abandonment: { label: "Desistências", formula: "Clientes que saíram da fila antes de serem chamados ÷ chegadas." },
  goal: { label: "Atingimento da meta", formula: "Faturamento líquido do mês até agora ÷ meta mensal." },
  pace: { label: "Ritmo necessário", formula: "(Meta − realizado) ÷ dias restantes do mês, contando hoje." },
  netProfit: { label: "Lucro líquido", formula: "Exige despesas operacionais cadastradas. A demo não tem despesas, então o indicador não é calculado." },
};
export const SOURCE = "Dados fictícios da demonstração: vendas do PDV, atendimentos da fila, livro de estoque e caixas.";

export const PERIODS = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  mes: "Mês atual",
  mes_anterior: "Mês anterior",
  "30d": "Últimos 30 dias",
};

/** Period and the comparable previous window ("same hour yesterday", "same days last month"). */
export function periodRange(period, now) {
  const today = dayKey(now);
  const todayStart = dayStart(today);
  const elapsed = now - todayStart;
  const month = monthKey(now);
  const monthStart = dayStart(`${month}-01`);
  const lastMonth = previousMonth(month);
  const lastMonthStart = dayStart(`${lastMonth}-01`);
  switch (period) {
    case "ontem":
      return range("Ontem", todayStart - DAY_MS, todayStart, todayStart - 2 * DAY_MS, todayStart - DAY_MS, "anteontem");
    case "7d":
      return range("Últimos 7 dias", todayStart - 6 * DAY_MS, now, todayStart - 13 * DAY_MS, todayStart - 7 * DAY_MS + elapsed, "os 7 dias anteriores");
    case "30d":
      return range("Últimos 30 dias", todayStart - 29 * DAY_MS, now, todayStart - 59 * DAY_MS, todayStart - 30 * DAY_MS + elapsed, "os 30 dias anteriores");
    case "mes": {
      const window = Math.min(now - monthStart, daysInMonth(lastMonth) * DAY_MS);
      return range("Mês atual", monthStart, now, lastMonthStart, lastMonthStart + window, "o mesmo intervalo do mês anterior");
    }
    case "mes_anterior": {
      const before = previousMonth(lastMonth);
      return range("Mês anterior", lastMonthStart, monthStart, dayStart(`${before}-01`), lastMonthStart, "o mês antes dele");
    }
    default:
      return range("Hoje", todayStart, now, todayStart - DAY_MS, todayStart - DAY_MS + elapsed, "ontem até o mesmo horário");
  }
}
function range(label, from, to, prevFrom, prevTo, previousLabel) {
  return { label, from, to, previous: { from: prevFrom, to: prevTo, label: previousLabel } };
}

/** scope = { storeIds: [...], sellerId?: string } — always applied before any number is computed. */
export const inScope = (scope, storeId, sellerId) => scope.storeIds.includes(storeId) && (!scope.sellerId || scope.sellerId === sellerId);

export function salesIn(state, { from, to }, scope) {
  return state.sales.filter((sale) => sale.at >= from && sale.at < to && inScope(scope, sale.storeId, sale.sellerId));
}

export function summarize(sales) {
  const done = sales.filter((sale) => sale.status === "concluida");
  const gross = sum(done, (s) => s.grossCents);
  const discounts = sum(done, (s) => s.discountCents);
  const net = gross - discounts;
  const items = sum(done, (s) => sum(s.items, (i) => i.qty));
  const cost = sum(done, (s) => sum(s.items, (i) => i.qty * i.costCents));
  const cancelled = sales.filter((sale) => sale.status === "cancelada");
  const returned = sales.filter((sale) => sale.status === "devolvida");
  return {
    gross,
    discounts,
    net,
    count: done.length,
    ticket: done.length ? Math.round(net / done.length) : null,
    items,
    itemsPerSale: ratio(items, done.length),
    cost,
    margin: ratio(net - cost, net),
    cancelled: { count: cancelled.length, cents: sum(cancelled, (s) => s.netCents) },
    returned: { count: returned.length, cents: sum(returned, (s) => s.netCents) },
  };
}

export const salesSummary = (state, window, scope) => summarize(salesIn(state, window, scope));

export function variation(current, previous) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function byStore(state, window, scope) {
  return STORES.filter((store) => scope.storeIds.includes(store.id)).map((store) => ({
    store,
    ...salesSummary(state, window, { ...scope, storeIds: [store.id] }),
  }));
}

export function bySeller(state, window, scope) {
  return SALESPEOPLE.filter((person) => inScope(scope, person.storeId, person.id)).map((person) => {
    const own = { storeIds: [person.storeId], sellerId: person.id };
    return { person, ...salesSummary(state, window, own), queue: queueMetrics(state, window, own) };
  });
}

export function byCategory(state, window, scope) {
  const rows = new Map();
  for (const sale of salesIn(state, window, scope)) {
    if (sale.status !== "concluida") continue;
    const factor = sale.grossCents ? sale.netCents / sale.grossCents : 0;
    for (const item of sale.items) {
      const row = rows.get(item.category) ?? { category: item.category, qty: 0, net: 0, cost: 0 };
      row.qty += item.qty;
      row.net += Math.round(item.qty * item.unitCents * factor);
      row.cost += item.qty * item.costCents;
      rows.set(item.category, row);
    }
  }
  return [...rows.values()].map((row) => ({ ...row, margin: ratio(row.net - row.cost, row.net) })).sort((a, b) => b.net - a.net);
}

/** Net revenue per calendar day (São Paulo), oldest first. */
export function dailyNet(state, days, scope, now) {
  const today = dayKey(now);
  const keys = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const totals = new Map(keys.map((key) => [key, 0]));
  for (const sale of state.sales) {
    if (sale.status !== "concluida" || !inScope(scope, sale.storeId, sale.sellerId)) continue;
    const key = dayKey(sale.at);
    if (totals.has(key)) totals.set(key, totals.get(key) + sale.netCents);
  }
  return keys.map((key) => ({ key, value: totals.get(key) }));
}

export function queueMetrics(state, { from, to }, scope) {
  const list = state.attendances.filter((a) => a.arrivedAt >= from && a.arrivedAt < to && scope.storeIds.includes(a.storeId) && (!scope.sellerId || a.sellerId === scope.sellerId));
  const called = list.filter((a) => a.calledAt !== null);
  const waits = called.map((a) => (a.calledAt - a.arrivedAt) / 60_000);
  const closedSales = list.filter((a) => a.kind === "venda" && a.status === "encerrado");
  const converted = closedSales.filter((a) => a.outcome === "venda").length;
  const abandoned = scope.sellerId ? 0 : list.filter((a) => a.status === "desistencia").length;
  const lost = closedSales.filter((a) => a.outcome === "sem_venda");
  const reasons = new Map();
  for (const a of lost) reasons.set(a.reason, (reasons.get(a.reason) ?? 0) + 1);
  return {
    arrivals: list.length,
    attended: closedSales.length,
    converted,
    conversion: ratio(converted, closedSales.length),
    avgWait: waits.length ? sum(waits, (w) => w) / waits.length : null,
    maxWait: waits.length ? Math.max(...waits) : null,
    abandoned,
    abandonment: scope.sellerId ? null : ratio(abandoned, list.length),
    lostReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
  };
}

export function goalFor(state, month, storeId, sellerId) {
  return state.goals.find((g) => g.month === month && g.storeId === storeId && (sellerId ? g.sellerId === sellerId : g.scope === "store")) ?? null;
}

/** Month-to-date progress, linear projection and the daily pace still needed. */
export function goalProgress(state, now, storeId, sellerId) {
  const month = monthKey(now);
  const goal = goalFor(state, month, storeId, sellerId);
  if (!goal) return null;
  const monthStart = dayStart(`${month}-01`);
  const achieved = salesSummary(state, { from: monthStart, to: now }, { storeIds: [storeId], sellerId }).net;
  const total = daysInMonth(month);
  const elapsedDays = Math.max((now - monthStart) / DAY_MS, 0.5);
  const remainingDays = total - Math.floor((now - monthStart) / DAY_MS);
  const projection = Math.round((achieved / elapsedDays) * total);
  return {
    targetCents: goal.targetCents,
    achieved,
    progress: ratio(achieved, goal.targetCents),
    expected: Math.min(elapsedDays / total, 1),
    projection,
    projectionRatio: ratio(projection, goal.targetCents),
    remaining: Math.max(goal.targetCents - achieved, 0),
    remainingDays,
    pace: remainingDays > 0 ? Math.ceil(Math.max(goal.targetCents - achieved, 0) / remainingDays) : null,
    dailyTarget: Math.round(goal.targetCents / total),
  };
}

export function stockBalance(state, storeId, productId) {
  return sum(state.movements.filter((m) => m.storeId === storeId && m.productId === productId), (m) => m.qty);
}

/** Stock position per product of one store: balance from the ledger, 30-day sales, coverage and status. */
export function stockRows(state, storeId, now) {
  const balances = new Map();
  const sold = new Map();
  const since = now - 30 * DAY_MS;
  for (const m of state.movements) {
    if (m.storeId !== storeId) continue;
    balances.set(m.productId, (balances.get(m.productId) ?? 0) + m.qty);
    if (m.type === "saida_venda" && m.at >= since) sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.qty);
  }
  return PRODUCTS.map((product) => {
    const balance = balances.get(product.id) ?? 0;
    const sold30 = sold.get(product.id) ?? 0;
    const coverage = sold30 > 0 ? balance / (sold30 / 30) : null;
    const status =
      balance <= 0 ? "ruptura" : balance < product.minStock ? "critico" : (coverage === null || coverage > 120) && balance > product.minStock * 3 ? "excesso" : "ok";
    return { product, balance, sold30, coverage, status };
  });
}

/** Stock-outs, low and excess stock in scope, plus transfers between stores of the same scope. */
export function inventoryAlerts(state, scope, now) {
  const rowsByStore = new Map(scope.storeIds.map((id) => [id, stockRows(state, id, now)]));
  const alerts = [];
  const transfers = [];
  for (const [storeId, rows] of rowsByStore) {
    for (const row of rows) {
      if (row.status === "ok") continue;
      alerts.push({ storeId, ...row });
      if (row.status === "excesso") continue;
      const need = row.product.minStock * 2 - row.balance;
      // Source = the store with the largest spare above twice its own minimum.
      const source = [...rowsByStore]
        .filter(([otherId]) => otherId !== storeId)
        .map(([otherId, otherRows]) => ({ otherId, spare: otherRows.find((r) => r.product.id === row.product.id).balance - row.product.minStock * 2 }))
        .sort((a, b) => b.spare - a.spare)[0];
      if (source && source.spare > 0) transfers.push({ productId: row.product.id, fromStoreId: source.otherId, toStoreId: storeId, qty: Math.min(source.spare, need) });
    }
  }
  const weight = { ruptura: 0, critico: 1, excesso: 2 };
  return { alerts: alerts.sort((a, b) => weight[a.status] - weight[b.status]), transfers };
}

/** Cash expected in the drawer: opening float + cash sales (not cancelled) + supplies − withdrawals. */
export function cashExpected(state, session) {
  const cash = state.sales.filter(
    (sale) => sale.storeId === session.storeId && dayKey(sale.at) === session.day && sale.status !== "cancelada" && sale.at >= session.openedAt,
  );
  const cashIn = sum(cash, (sale) => sum(sale.payments.filter((p) => p.method === "dinheiro"), (p) => p.cents));
  const moves = sum(session.movements, (m) => (m.type === "suprimento" ? m.cents : -m.cents));
  return session.openingCents + cashIn + moves;
}

export function cashStatus(state, scope, now) {
  const today = dayKey(now);
  const yesterday = addDays(today, -1);
  return STORES.filter((store) => scope.storeIds.includes(store.id)).map((store) => {
    const sessions = state.cashSessions.filter((s) => s.storeId === store.id);
    const current = sessions.find((s) => s.day === today) ?? null;
    const pending = sessions.filter((s) => s.status === "fechamento_pendente");
    const divergent = sessions
      .filter((s) => s.status === "fechado" && s.day >= addDays(today, -7))
      .map((s) => ({ session: s, diff: s.countedCents - cashExpected(state, s) }))
      .filter((d) => Math.abs(d.diff) > 500);
    return { store, current, expected: current ? cashExpected(state, current) : null, pending, divergent, yesterday };
  });
}

export function commissionFor(state, sellerId, month) {
  const rules = [...state.commissionRules].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  let cents = 0;
  for (const sale of state.sales) {
    if (sale.sellerId !== sellerId || sale.status !== "concluida" || monthKey(sale.at) !== month) continue;
    const rule = rules.find((r) => r.validFrom <= dayKey(sale.at));
    if (!rule) continue;
    const factor = sale.grossCents ? sale.netCents / sale.grossCents : 0;
    for (const item of sale.items) cents += item.qty * item.unitCents * factor * (rule.rates[item.category] ?? rule.rates.default);
  }
  return Math.round(cents);
}

export function ledger(state, storeId, productId) {
  let balance = 0;
  return state.movements
    .filter((m) => m.storeId === storeId && m.productId === productId)
    .sort((a, b) => a.at - b.at)
    .map((m) => ({ ...m, balance: (balance += m.qty) }));
}

export const monthsAvailable = (state) => {
  const current = state.meta.currentMonth;
  return [previousMonth(previousMonth(current)), previousMonth(current), current];
};
