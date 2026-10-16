// PDV and cash operations of the demo backend. Payments are NOT processed: cash is
// counted locally, card is recorded with the authorization code from an external
// terminal, and PIX stays unavailable until a provider is integrated.
import { PRODUCTS, SALESPEOPLE, STORES } from "./catalog.js";
import { dayKey, isValidCpf, sum } from "./lib.js";
import { cashExpected, stockBalance } from "./metrics.js";
import { DemoError } from "./store.js";

export const PAYMENT_METHODS = {
  dinheiro: "Dinheiro",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  pix: "PIX",
};
export const MAX_DISCOUNT = 10;
export const MAX_AUTHORIZED_DISCOUNT = 15;

export const todaySession = (state, storeId, now = Date.now()) =>
  state.cashSessions.find((s) => s.storeId === storeId && s.day === dayKey(now)) ?? null;

/** Totals of a cart draft, in integer cents. */
export function draftTotals(draft) {
  const lines = draft.items.map((item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    return { ...item, product, totalCents: product.priceCents * item.qty };
  });
  const grossCents = sum(lines, (l) => l.totalCents);
  const discountCents = Math.round((grossCents * (draft.discountPct || 0)) / 100);
  const netCents = grossCents - discountCents;
  const paidCents = sum(draft.payments, (p) => (p.method === "dinheiro" ? p.receivedCents : p.cents));
  const cashPart = sum(draft.payments.filter((p) => p.method === "dinheiro"), (p) => p.receivedCents);
  const otherPart = paidCents - cashPart;
  const changeCents = Math.max(paidCents - netCents, 0);
  return { lines, grossCents, discountCents, netCents, paidCents, changeCents, cashPart, otherPart, missingCents: Math.max(netCents - paidCents, 0) };
}

/**
 * Finalizes a sale atomically: validation, sale, stock movements, attendance link and
 * audit. The attempt key makes a repeated click return the same sale (idempotency).
 */
export function finalizeSale(store, draft, attemptKey) {
  const { state } = store;
  if (state.finalized.has(attemptKey)) return state.finalized.get(attemptKey);
  store.assertCan("pdv.sell");
  store.assertStore(draft.storeId);
  const now = Date.now();
  const session = todaySession(state, draft.storeId, now);
  if (!session || session.status !== "aberto") throw new DemoError("Abra o caixa da loja antes de vender.");
  if (draft.items.length === 0) throw new DemoError("Adicione ao menos um produto.");
  const seller = SALESPEOPLE.find((p) => p.id === draft.sellerId && p.storeId === draft.storeId);
  if (!seller) throw new DemoError("Selecione o vendedor responsável.");
  if (draft.customerCpf && !isValidCpf(draft.customerCpf)) throw new DemoError("CPF do cliente inválido.");
  for (const item of draft.items) {
    if (!Number.isInteger(item.qty) || item.qty < 1) throw new DemoError("Quantidade inválida.");
    const available = stockBalance(state, draft.storeId, item.productId);
    if (available < item.qty) {
      const product = PRODUCTS.find((p) => p.id === item.productId);
      throw new DemoError(`Saldo insuficiente de ${product.name} ${product.variant}: ${available} em estoque.`);
    }
  }
  const pct = draft.discountPct || 0;
  if (!Number.isInteger(pct) || pct < 0) throw new DemoError("Desconto inválido.");
  if (pct > MAX_AUTHORIZED_DISCOUNT) throw new DemoError(`Descontos acima de ${MAX_AUTHORIZED_DISCOUNT}% exigem aprovação da diretoria.`);
  if (pct > MAX_DISCOUNT && !store.can("pdv.discount.high")) {
    throw new DemoError(`Desconto acima de ${MAX_DISCOUNT}% exige autorização do gerente da loja.`);
  }
  const totals = draftTotals(draft);
  for (const payment of draft.payments) {
    if (payment.method === "pix") throw new DemoError("PIX depende da integração com o provedor de pagamento (pendente).");
    if (payment.method !== "dinheiro" && !/^\d{4,12}$/.test(payment.authCode ?? "")) {
      throw new DemoError("Informe o código de autorização (NSU) impresso pela maquininha.");
    }
  }
  if (totals.missingCents > 0) throw new DemoError("O valor pago não cobre o total da venda.");
  if (totals.otherPart > totals.netCents) throw new DemoError("Pagamentos em cartão não podem passar do total.");
  if (totals.changeCents > totals.cashPart) throw new DemoError("Troco só pode sair do pagamento em dinheiro.");

  const storeInfo = STORES.find((s) => s.id === draft.storeId);
  // Sale numbers are sequential per store.
  const seq = state.sales.filter((s) => s.storeId === draft.storeId).length + 1;
  const sale = {
    id: `sale-demo-${state.sales.length + 1}`,
    number: `${storeInfo.code}-${String(seq).padStart(6, "0")}`,
    storeId: draft.storeId,
    sellerId: seller.id,
    attendanceId: draft.attendanceId ?? null,
    at: now,
    items: totals.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCents: l.product.priceCents, costCents: l.product.costCents, category: l.product.category })),
    grossCents: totals.grossCents,
    discountPct: pct,
    discountCents: totals.discountCents,
    netCents: totals.netCents,
    // Cash enters the drawer net of change; card values are recorded as informed.
    payments: draft.payments.map((p) =>
      p.method === "dinheiro" ? { method: p.method, cents: p.receivedCents - totals.changeCents, receivedCents: p.receivedCents } : { method: p.method, cents: p.cents, authCode: p.authCode, installments: p.installments ?? 1 },
    ),
    changeCents: totals.changeCents,
    customerCpf: draft.customerCpf || null,
    discountAuthorizedBy: pct > MAX_DISCOUNT ? store.viewer().name : null,
    status: "concluida",
    attemptKey,
    source: "demo",
  };
  state.sales.push(sale);
  for (const item of sale.items) {
    state.movements.push({ id: `mov-demo-${state.movements.length + 1}`, storeId: sale.storeId, productId: item.productId, type: "saida_venda", qty: -item.qty, at: now, reason: `Venda ${sale.number}`, saleId: sale.id, source: "demo" });
  }
  if (sale.attendanceId) {
    const attendance = state.attendances.find((a) => a.id === sale.attendanceId);
    if (attendance && attendance.status === "em_atendimento") Object.assign(attendance, { status: "encerrado", outcome: "venda", saleId: sale.id, endedAt: now });
  }
  state.finalized.set(attemptKey, sale);
  store.audit("sale.completed", `Venda ${sale.number}`, { líquido: sale.netCents, itens: sale.items.length, desconto: `${pct}%` });
  store.commit();
  return sale;
}

export function cancelSale(store, saleId, reason) {
  const { state } = store;
  store.assertCan("pdv.cancel", "Cancelar venda exige perfil de gerente.");
  const sale = state.sales.find((s) => s.id === saleId);
  if (!sale) throw new DemoError("Venda não encontrada.");
  store.assertStore(sale.storeId);
  if (sale.status !== "concluida") throw new DemoError("Esta venda já foi cancelada ou devolvida.");
  if (dayKey(sale.at) !== dayKey(Date.now())) throw new DemoError("Só vendas do dia podem ser canceladas; use devolução.");
  if (!reason?.trim()) throw new DemoError("Informe o motivo do cancelamento.");
  const now = Date.now();
  Object.assign(sale, { status: "cancelada", cancelledAt: now, cancelReason: reason.trim() });
  for (const item of sale.items) {
    state.movements.push({ id: `mov-demo-${state.movements.length + 1}`, storeId: sale.storeId, productId: item.productId, type: "estorno_venda", qty: item.qty, at: now, reason: `Cancelamento da venda ${sale.number}`, saleId: sale.id, source: "demo" });
  }
  store.audit("sale.cancelled", `Venda ${sale.number}`, { motivo: sale.cancelReason, valor: sale.netCents });
  store.commit();
}

export function suspendSale(store, draft, label) {
  store.assertCan("pdv.sell");
  if (draft.items.length === 0) throw new DemoError("Carrinho vazio.");
  const entry = { id: `susp-${Date.now()}`, at: Date.now(), label: label || `Venda suspensa ${store.state.suspended.length + 1}`, draft: structuredClone(draft) };
  store.state.suspended.push(entry);
  store.audit("sale.suspended", entry.label, { itens: draft.items.length });
  store.commit();
  return entry;
}

export function resumeSale(store, id) {
  const index = store.state.suspended.findIndex((s) => s.id === id);
  if (index < 0) throw new DemoError("Venda suspensa não encontrada.");
  const [entry] = store.state.suspended.splice(index, 1);
  store.commit();
  return entry.draft;
}

export function openCash(store, storeId, openingCents) {
  store.assertCan("cash.manage", "Abrir caixa exige perfil de gerente.");
  store.assertStore(storeId);
  const now = Date.now();
  if (todaySession(store.state, storeId, now)) throw new DemoError("O caixa de hoje já foi aberto.");
  if (!Number.isInteger(openingCents) || openingCents < 0) throw new DemoError("Informe o fundo de troco.");
  const code = STORES.find((s) => s.id === storeId).code;
  store.state.cashSessions.push({ id: `cash-${storeId}-${dayKey(now)}`, storeId, day: dayKey(now), operator: `Caixa ${code}`, openedAt: now, openingCents, movements: [], status: "aberto", closedAt: null, countedCents: null, source: "demo" });
  store.audit("cash.opened", `Caixa ${code}`, { fundo: openingCents });
  store.commit();
}

export function cashMovement(store, storeId, type, cents, reason) {
  store.assertCan("cash.manage", "Sangria e suprimento exigem perfil de gerente.");
  store.assertStore(storeId);
  const session = todaySession(store.state, storeId);
  if (!session || session.status !== "aberto") throw new DemoError("O caixa não está aberto.");
  if (!Number.isInteger(cents) || cents <= 0) throw new DemoError("Informe um valor maior que zero.");
  if (!reason?.trim()) throw new DemoError("Informe a justificativa.");
  if (type === "sangria" && cents > cashExpected(store.state, session)) throw new DemoError("A sangria não pode passar do dinheiro esperado na gaveta.");
  session.movements.push({ type, cents, at: Date.now(), reason: reason.trim() });
  store.audit("cash.movement", session.operator, { tipo: type, valor: cents, justificativa: reason.trim() });
  store.commit();
}

/** Closes a session (today's, or a pending one from an earlier day) with the counted amount. */
export function closeCash(store, sessionId, countedCents, justification) {
  store.assertCan("cash.manage", "Fechar caixa exige perfil de gerente.");
  const session = store.state.cashSessions.find((s) => s.id === sessionId);
  if (!session) throw new DemoError("Caixa não encontrado.");
  store.assertStore(session.storeId);
  if (!["aberto", "fechamento_pendente"].includes(session.status)) throw new DemoError("Este caixa já está fechado.");
  if (!Number.isInteger(countedCents) || countedCents < 0) throw new DemoError("Informe o valor contado.");
  const diff = countedCents - cashExpected(store.state, session);
  if (Math.abs(diff) > 500 && !justification?.trim()) throw new DemoError("Divergência acima de R$ 5,00 exige justificativa.");
  Object.assign(session, { status: "fechado", closedAt: Date.now(), countedCents, justification: justification?.trim() || null });
  store.audit("cash.closed", session.operator, { dia: session.day, contado: countedCents, divergência: diff });
  store.commit();
  return diff;
}
