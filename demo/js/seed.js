// Generates the FICTITIOUS operating history used by the demo: attendances, sales,
// stock ledger, cash sessions, goals and commission statements. Deterministic for a
// given day (fixed seed), so numbers are reproducible and testable.
import { NO_SALE_REASONS, PRODUCTS, SALESPEOPLE, STORES, STORE_MANAGERS } from "./catalog.js";
import { addDays, createRandom, dayKey, dayStart, daysInMonth, MINUTE_MS, monthKey, previousMonth, spHour } from "./lib.js";

export const SEED = 276; // chosen so the demo shows a mix of stores on, near and off their goals
const BASE_ATTENDANCES = 22;
const WEEKDAY_FACTOR = [0.7, 0.9, 0.95, 1, 1.05, 1.2, 1.45]; // Sunday..Saturday
const HOUR_WEIGHTS = [0.6, 0.9, 1.2, 1.3, 1, 0.8, 0.9, 1.1, 1.3, 1.2, 0.8]; // 09h..19h
const CATEGORY_WEIGHT = { Calçados: 1, Vestuário: 1.3, Acessórios: 0.6 };
// Items deliberately not replenished, so the demo has real stock-outs to detect.
const NO_REPLENISH = new Set(["s2:prod-2", "s4:prod-4", "s1:prod-13"]);
const LOW_DEMAND = new Set(["s3:prod-2", "s3:prod-14"]);
const EXCESS_START = { "s3:prod-2": 26, "s3:prod-14": 18 };
const GOAL_FACTOR = { s1: 1.0, s2: 1.02, s3: 0.97, s4: 1.08 };
const OPENING_FLOAT = 20000;

export function commissionRules(currentMonth) {
  return [
    { version: 1, validFrom: "2026-01-01", label: "3% sobre o faturamento líquido", rates: { default: 0.03 } },
    { version: 2, validFrom: `${currentMonth}-01`, label: "3% sobre o líquido; 5% em Acessórios", rates: { default: 0.03, Acessórios: 0.05 } },
  ];
}

export function generateDemoData(now = Date.now(), seed = SEED) {
  const random = createRandom(seed);
  const today = dayKey(now);
  const currentMonth = monthKey(now);
  const firstMonth = previousMonth(previousMonth(currentMonth));
  const firstDay = `${firstMonth}-01`;
  const sales = [];
  const attendances = [];
  const movements = [];
  const cashSessions = [];
  const balances = new Map();
  const returnsByDay = new Map();
  let saleSeq = 0;
  const storeSeq = new Map();
  let movementSeq = 0;

  const move = (fields) => {
    const key = `${fields.storeId}:${fields.productId}`;
    balances.set(key, (balances.get(key) ?? 0) + fields.qty);
    movements.push({ id: `mov-${++movementSeq}`, source: "seed", ...fields });
  };
  const productWeight = (store, product) =>
    CATEGORY_WEIGHT[product.category] * Math.sqrt(40000 / product.priceCents) * (LOW_DEMAND.has(`${store.id}:${product.id}`) ? 0.15 : 1);

  for (let key = firstDay, d = 0; key <= today; key = addDays(key, 1), d += 1) {
    const start = dayStart(key);
    const weekday = new Date(start + 12 * 3600_000).getUTCDay();
    const isToday = key === today;
    const daysAgo = Math.round((dayStart(today) - start) / 86_400_000);

    for (const store of STORES) {
      const sellers = SALESPEOPLE.filter((person) => person.storeId === store.id);
      for (const product of PRODUCTS) {
        const stockKey = `${store.id}:${product.id}`;
        if (d === 0) {
          const qty = EXCESS_START[stockKey] ?? product.minStock * 4 + random.int(0, 3);
          move({ storeId: store.id, productId: product.id, type: "entrada", qty, at: start + 8 * 3600_000, reason: "Saldo inicial" });
        } else if ((weekday === 1 || weekday === 4) && !NO_REPLENISH.has(stockKey)) {
          const balance = balances.get(stockKey) ?? 0;
          if (balance < product.minStock * 2) {
            move({ storeId: store.id, productId: product.id, type: "entrada", qty: product.minStock * 5 - balance, at: start + 8.5 * 3600_000, reason: "Recebimento de mercadoria" });
          }
        }
      }
      if (d > 0 && random.chance(0.12)) {
        const product = random.pick(PRODUCTS);
        if ((balances.get(`${store.id}:${product.id}`) ?? 0) > 0) {
          move({ storeId: store.id, productId: product.id, type: "perda", qty: -1, at: start + 8.75 * 3600_000, reason: "Avaria" });
        }
      }
      for (const sale of returnsByDay.get(`${key}:${store.id}`) ?? []) {
        sale.status = "devolvida";
        sale.returnedAt = start + 9.1 * 3600_000;
        for (const item of sale.items) {
          move({ storeId: store.id, productId: item.productId, type: "devolucao", qty: item.qty, at: sale.returnedAt, reason: `Devolução da venda ${sale.number}`, saleId: sale.id });
        }
      }
      if (isToday && spHour(now) < 9) continue;

      const trend = store.id === "s4" && daysAgo < 15 ? 0.88 : store.id === "s3" && daysAgo < 20 ? 1.1 : 1;
      const count = Math.round(BASE_ATTENDANCES * store.factor * WEEKDAY_FACTOR[weekday] * trend * random.between(0.85, 1.15));
      const arrivals = [];
      for (let i = 0; i < count; i += 1) {
        const hour = 9 + random.weighted(HOUR_WEIGHTS.map((_, h) => h), (h) => HOUR_WEIGHTS[h]);
        arrivals.push(start + hour * 3600_000 + random.int(0, 59) * MINUTE_MS + random.int(0, 59) * 1000);
      }
      arrivals.sort((a, b) => a - b);
      const freeAt = new Map(sellers.map((seller) => [seller.id, 0]));
      let ticket = 0;
      let rotation = 0;

      for (const arrivedAt of arrivals) {
        if (isToday && arrivedAt > now) break;
        ticket += 1;
        const hour = spHour(arrivedAt);
        const preferential = random.chance(0.08);
        const busy = (hour >= 12 && hour < 13.5) || (hour >= 17.5 && hour < 19);
        const slower = store.id === "s2" && daysAgo < 7 ? 5 : 0;
        const wait = preferential ? random.between(0.5, 3) : store.wait + (weekday === 6 ? 4 : 0) + (busy ? 3 : 0) + slower + random.between(0, 4);
        const calledAt = arrivedAt + Math.round(wait * MINUTE_MS);
        const kind = random.weighted(["venda", "troca", "retirada"], (k) => ({ venda: 0.88, troca: 0.09, retirada: 0.03 })[k]);
        const attendance = {
          id: `att-${store.id}-${key}-${ticket}`,
          storeId: store.id,
          number: `A-${String(ticket).padStart(3, "0")}`,
          kind,
          preferential,
          arrivedAt,
          calledAt: null,
          endedAt: null,
          sellerId: null,
          status: "aguardando",
          outcome: null,
          reason: null,
          saleId: null,
          source: "seed",
        };
        attendances.push(attendance);
        if (wait > 14 && random.chance(0.35)) {
          attendance.status = "desistencia";
          attendance.endedAt = arrivedAt + Math.round(random.between(10, 14) * MINUTE_MS);
          if (isToday && attendance.endedAt > now) {
            attendance.status = "aguardando";
            attendance.endedAt = null;
          }
          continue;
        }
        if (isToday && calledAt > now) continue;
        const ordered = [...sellers].sort((a, b) => freeAt.get(a.id) - freeAt.get(b.id));
        const seller = ordered.find((person) => freeAt.get(person.id) <= calledAt) ?? sellers[rotation++ % sellers.length];
        const endedAt = calledAt + Math.round(random.between(6, 24) * MINUTE_MS);
        freeAt.set(seller.id, endedAt);
        Object.assign(attendance, { calledAt, sellerId: seller.id, status: "em_atendimento" });
        if (isToday && endedAt > now) continue;
        attendance.endedAt = endedAt;
        attendance.status = "encerrado";
        if (kind !== "venda" || !random.chance(seller.skill * (store.id === "s4" && daysAgo < 15 ? 0.9 : 1))) {
          attendance.outcome = "sem_venda";
          attendance.reason = kind === "venda" ? random.pick(NO_SALE_REASONS.slice(1)) : kind === "troca" ? "Troca realizada" : "Retirada de pedido";
          continue;
        }
        const items = [];
        const itemCount = random.weighted([1, 2, 3], (n) => ({ 1: 0.6, 2: 0.3, 3: 0.1 })[n]);
        for (let i = 0; i < itemCount; i += 1) {
          const product = random.weighted(PRODUCTS, (p) => productWeight(store, p));
          const available = balances.get(`${store.id}:${product.id}`) ?? 0;
          const already = items.find((item) => item.productId === product.id);
          if (available - (already?.qty ?? 0) <= 0) continue;
          if (already) already.qty += 1;
          else items.push({ productId: product.id, qty: 1, unitCents: product.priceCents, costCents: product.costCents, category: product.category });
        }
        if (items.length === 0) {
          attendance.outcome = "sem_venda";
          attendance.reason = NO_SALE_REASONS[0];
          continue;
        }
        const grossCents = items.reduce((acc, item) => acc + item.qty * item.unitCents, 0);
        const roll = random.next();
        const discountPct = roll < 0.03 ? random.int(12, 15) : roll < 0.3 ? random.int(5, 10) : 0;
        const discountCents = Math.round((grossCents * discountPct) / 100);
        const netCents = grossCents - discountCents;
        const method = random.weighted(["credito", "debito", "pix", "dinheiro"], (m) => ({ credito: 0.42, debito: 0.2, pix: 0.28, dinheiro: 0.1 })[m]);
        const payment = { method, cents: netCents, installments: method === "credito" ? random.int(1, 3) : 1 };
        if (method === "dinheiro") payment.receivedCents = Math.ceil(netCents / 1000) * 1000;
        saleSeq += 1;
        storeSeq.set(store.id, (storeSeq.get(store.id) ?? 0) + 1);
        const sale = {
          id: `sale-${saleSeq}`,
          number: `${store.code}-${String(storeSeq.get(store.id)).padStart(6, "0")}`,
          storeId: store.id,
          sellerId: seller.id,
          attendanceId: attendance.id,
          at: endedAt,
          items,
          grossCents,
          discountPct,
          discountCents,
          netCents,
          payments: [payment],
          discountAuthorizedBy: discountPct > 10 ? STORE_MANAGERS[store.id] : null,
          status: "concluida",
          source: "seed",
        };
        sales.push(sale);
        attendance.outcome = "venda";
        attendance.saleId = sale.id;
        for (const item of items) {
          move({ storeId: store.id, productId: item.productId, type: "saida_venda", qty: -item.qty, at: endedAt, reason: `Venda ${sale.number}`, saleId: sale.id });
        }
        if (random.chance(0.02) && (!isToday || endedAt + 4 * MINUTE_MS <= now)) {
          sale.status = "cancelada";
          sale.cancelledAt = endedAt + 4 * MINUTE_MS;
          sale.cancelReason = random.pick(["Erro de digitação", "Cliente desistiu no caixa", "Pagamento recusado pela maquininha"]);
          for (const item of items) {
            move({ storeId: store.id, productId: item.productId, type: "estorno_venda", qty: item.qty, at: sale.cancelledAt, reason: `Cancelamento da venda ${sale.number}`, saleId: sale.id });
          }
        } else if (daysAgo > 3 && random.chance(0.012)) {
          const returnKey = `${addDays(key, 2)}:${store.id}`;
          returnsByDay.set(returnKey, [...(returnsByDay.get(returnKey) ?? []), sale]);
        }
      }
      cashSessions.push(cashSession(store, key, start, { isToday, daysAgo, now }, sales));
    }
  }

  return {
    meta: { seed, generatedAt: now, firstDay, today, currentMonth },
    sales,
    attendances,
    movements,
    cashSessions,
    goals: buildGoals(sales, firstMonth, currentMonth),
    commissionRules: commissionRules(currentMonth),
  };
}

function cashSession(store, key, start, { isToday, daysAgo, now }, sales) {
  const cash = sales.filter(
    (sale) => sale.storeId === store.id && dayKey(sale.at) === key && sale.status !== "cancelada" && sale.payments.some((p) => p.method === "dinheiro"),
  );
  const cashIn = (until) => cash.filter((sale) => sale.at < until).reduce((acc, sale) => acc + sale.netCents, 0);
  const movements = [];
  const afternoon = start + 15 * 3600_000;
  const before = OPENING_FLOAT + cashIn(afternoon);
  if (before > 50000 && (!isToday || now > afternoon)) {
    movements.push({ type: "sangria", cents: before - 10000, at: afternoon, reason: "Sangria para o cofre" });
  }
  const expectedCents = OPENING_FLOAT + cashIn(Infinity) - movements.reduce((acc, m) => acc + m.cents, 0);
  const session = {
    id: `cash-${store.id}-${key}`,
    storeId: store.id,
    day: key,
    operator: `Caixa ${store.code}`,
    openedAt: start + 9 * 3600_000,
    openingCents: OPENING_FLOAT,
    movements,
    status: "fechado",
    closedAt: start + 20.25 * 3600_000,
    countedCents: expectedCents,
    source: "seed",
  };
  if (isToday) Object.assign(session, { status: "aberto", closedAt: null, countedCents: null });
  else if (daysAgo === 1 && store.id === "s2") Object.assign(session, { status: "fechamento_pendente", closedAt: null, countedCents: null });
  else if (daysAgo === 1 && store.id === "s4") session.countedCents = expectedCents - 1240;
  return session;
}

/** Monthly goals per store and salesperson, from the store's own average (fictitious targets). */
function buildGoals(sales, firstMonth, currentMonth) {
  const goals = [];
  const months = [firstMonth, previousMonth(currentMonth), currentMonth];
  for (const store of STORES) {
    const done = sales.filter((sale) => sale.storeId === store.id && sale.status === "concluida" && monthKey(sale.at) !== currentMonth);
    const days = new Set(done.map((sale) => dayKey(sale.at))).size || 1;
    const daily = done.reduce((acc, sale) => acc + sale.netCents, 0) / days;
    const sellers = SALESPEOPLE.filter((person) => person.storeId === store.id);
    const totalSkill = sellers.reduce((acc, person) => acc + person.skill, 0);
    for (const month of months) {
      const target = Math.round((daily * daysInMonth(month) * GOAL_FACTOR[store.id]) / 10000) * 10000;
      goals.push({ id: `goal-${store.id}-${month}`, scope: "store", storeId: store.id, month, targetCents: target });
      for (const seller of sellers) {
        goals.push({
          id: `goal-${seller.id}-${month}`,
          scope: "seller",
          storeId: store.id,
          sellerId: seller.id,
          month,
          targetCents: Math.round((target * (seller.skill / totalSkill)) / 10000) * 10000,
        });
      }
    }
  }
  return goals;
}
