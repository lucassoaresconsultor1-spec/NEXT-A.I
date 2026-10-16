// Stock, queue, task, commission and agent operations of the demo backend.
import { PRODUCTS, SALESPEOPLE, STORES } from "./catalog.js";
import { dayKey } from "./lib.js";
import { stockBalance } from "./metrics.js";
import { DemoError } from "./store.js";

const productLabel = (id) => {
  const p = PRODUCTS.find((x) => x.id === id);
  return `${p.name} ${p.variant}`;
};
const storeName = (id) => STORES.find((s) => s.id === id).name;

export const MOVEMENT_LABELS = {
  entrada: "Entrada",
  saida_venda: "Saída por venda",
  estorno_venda: "Estorno de venda",
  devolucao: "Devolução",
  perda: "Perda",
  ajuste: "Ajuste de inventário",
  transferencia_saida: "Transferência (saída)",
  transferencia_entrada: "Transferência (entrada)",
};

/** Manual stock movement. The balance is never edited: only ledger entries are added. */
export function stockMovement(store, { storeId, productId, type, qty, reason }) {
  store.assertCan("inventory.manage", "Movimentar estoque exige perfil de gerente.");
  store.assertStore(storeId);
  if (!PRODUCTS.some((p) => p.id === productId)) throw new DemoError("Produto não encontrado.");
  if (!["entrada", "perda", "ajuste"].includes(type)) throw new DemoError("Tipo de movimentação inválido.");
  if (!Number.isInteger(qty) || qty === 0) throw new DemoError("Informe uma quantidade inteira diferente de zero.");
  if (!reason?.trim()) throw new DemoError("Informe o motivo da movimentação.");
  const signed = type === "entrada" ? Math.abs(qty) : type === "perda" ? -Math.abs(qty) : qty;
  if (stockBalance(store.state, storeId, productId) + signed < 0) throw new DemoError("O saldo não pode ficar negativo.");
  store.state.movements.push({ id: `mov-demo-${store.state.movements.length + 1}`, storeId, productId, type, qty: signed, at: Date.now(), reason: reason.trim(), source: "demo" });
  store.audit("stock.movement", productLabel(productId), { loja: storeName(storeId), tipo: MOVEMENT_LABELS[type], quantidade: signed, motivo: reason.trim() });
  store.commit();
}

/** A transfer request does not move stock; receiving it does (two ledger entries). */
export function requestTransfer(store, { productId, fromStoreId, toStoreId, qty, origin }) {
  store.assertCan("inventory.manage", "Solicitar transferência exige perfil de gerente.");
  store.assertStore(toStoreId);
  if (fromStoreId === toStoreId) throw new DemoError("Escolha lojas diferentes.");
  if (!Number.isInteger(qty) || qty < 1) throw new DemoError("Quantidade inválida.");
  const transfer = { id: `tr-${store.state.transfers.length + 1}`, productId, fromStoreId, toStoreId, qty, status: "solicitada", requestedAt: Date.now(), requestedBy: store.viewer().name, origin: origin ?? "manual" };
  store.state.transfers.unshift(transfer);
  store.audit("stock.transfer_requested", productLabel(productId), { de: storeName(fromStoreId), para: storeName(toStoreId), quantidade: qty });
  store.commit();
  return transfer;
}

export function receiveTransfer(store, transferId) {
  store.assertCan("inventory.manage");
  const transfer = store.state.transfers.find((t) => t.id === transferId);
  if (!transfer) throw new DemoError("Transferência não encontrada.");
  store.assertStore(transfer.toStoreId);
  if (transfer.status !== "solicitada") throw new DemoError("Esta transferência já foi recebida.");
  if (stockBalance(store.state, transfer.fromStoreId, transfer.productId) < transfer.qty) throw new DemoError("A loja de origem não tem saldo suficiente.");
  const now = Date.now();
  const base = { productId: transfer.productId, at: now, reason: `Transferência ${transfer.id}`, source: "demo" };
  store.state.movements.push(
    { id: `mov-demo-${store.state.movements.length + 1}`, ...base, storeId: transfer.fromStoreId, type: "transferencia_saida", qty: -transfer.qty },
    { id: `mov-demo-${store.state.movements.length + 2}`, ...base, storeId: transfer.toStoreId, type: "transferencia_entrada", qty: transfer.qty },
  );
  Object.assign(transfer, { status: "recebida", receivedAt: now });
  store.audit("stock.transfer_received", productLabel(transfer.productId), { de: storeName(transfer.fromStoreId), para: storeName(transfer.toStoreId), quantidade: transfer.qty });
  store.commit();
}

/** "Lista da vez": free salespeople, longest idle first. */
export function sellerRotation(state, storeId) {
  const busy = new Set(state.attendances.filter((a) => a.storeId === storeId && a.status === "em_atendimento").map((a) => a.sellerId));
  const lastEnd = (id) => Math.max(0, ...state.attendances.filter((a) => a.sellerId === id && a.endedAt).map((a) => a.endedAt));
  return SALESPEOPLE.filter((p) => p.storeId === storeId)
    .map((person) => ({ person, busy: busy.has(person.id), idleSince: lastEnd(person.id) }))
    .sort((a, b) => Number(a.busy) - Number(b.busy) || a.idleSince - b.idleSince);
}

export function registerArrival(store, storeId, { kind, preferential }) {
  store.assertCan("queue.manage");
  store.assertStore(storeId);
  if (!["venda", "troca", "retirada"].includes(kind)) throw new DemoError("Tipo de atendimento inválido.");
  const today = dayKey(Date.now());
  const todays = store.state.attendances.filter((a) => a.storeId === storeId && dayKey(a.arrivedAt) === today);
  const number = `A-${String(todays.length + 1).padStart(3, "0")}`;
  const attendance = { id: `att-demo-${store.state.attendances.length + 1}`, storeId, number, kind, preferential: Boolean(preferential), arrivedAt: Date.now(), calledAt: null, endedAt: null, sellerId: null, status: "aguardando", outcome: null, reason: null, saleId: null, source: "demo" };
  store.state.attendances.push(attendance);
  store.audit("queue.arrival", `Atendimento ${number}`, { tipo: kind, preferencial: attendance.preferential });
  store.commit();
  return attendance;
}

/** Calls the next customer: preferential first (Lei 10.048/2000), then arrival order. */
export function callNext(store, storeId, sellerId) {
  store.assertCan("queue.manage");
  store.assertStore(storeId);
  const waiting = store.state.attendances
    .filter((a) => a.storeId === storeId && a.status === "aguardando")
    .sort((a, b) => Number(b.preferential) - Number(a.preferential) || a.arrivedAt - b.arrivedAt);
  if (waiting.length === 0) throw new DemoError("Ninguém aguardando na fila.");
  const rotation = sellerRotation(store.state, storeId);
  const chosen = sellerId ? rotation.find((r) => r.person.id === sellerId) : rotation.find((r) => !r.busy);
  if (!chosen || chosen.busy) throw new DemoError("Nenhum vendedor livre no momento.");
  const attendance = waiting[0];
  Object.assign(attendance, { status: "em_atendimento", calledAt: Date.now(), sellerId: chosen.person.id });
  store.audit("queue.called", `Atendimento ${attendance.number}`, { vendedor: chosen.person.name, ordem: sellerId ? "manual" : "lista da vez" });
  store.commit();
  return attendance;
}

export function closeAttendance(store, attendanceId, { outcome, reason }) {
  store.assertCan("queue.manage");
  const attendance = store.state.attendances.find((a) => a.id === attendanceId);
  if (!attendance) throw new DemoError("Atendimento não encontrado.");
  store.assertStore(attendance.storeId);
  if (outcome === "desistencia") {
    if (attendance.status !== "aguardando") throw new DemoError("Só quem ainda aguarda pode desistir.");
    Object.assign(attendance, { status: "desistencia", endedAt: Date.now() });
  } else {
    if (attendance.status !== "em_atendimento") throw new DemoError("O atendimento não está em andamento.");
    if (outcome !== "sem_venda") throw new DemoError("Vendas são vinculadas ao finalizar no PDV.");
    if (!reason) throw new DemoError("Informe o motivo da não conversão.");
    Object.assign(attendance, { status: "encerrado", outcome: "sem_venda", reason, endedAt: Date.now() });
  }
  store.audit("queue.closed", `Atendimento ${attendance.number}`, { resultado: outcome, motivo: reason ?? "—" });
  store.commit();
}

export const PRIORITIES = { alta: "Alta", media: "Média", baixa: "Baixa" };
export const TASK_STATUS = { aberta: "Aberta", andamento: "Em andamento", concluida: "Concluída" };

export function createTask(store, { title, description, assignee, due, priority, origin, storeId }) {
  store.assertCan("tasks.manage", "Criar tarefas exige perfil de gestão.");
  if (storeId) store.assertStore(storeId);
  if (!title?.trim()) throw new DemoError("Informe o título da tarefa.");
  if (!assignee?.trim()) throw new DemoError("Informe o responsável.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due ?? "")) throw new DemoError("Informe o prazo.");
  if (!PRIORITIES[priority]) throw new DemoError("Prioridade inválida.");
  const task = {
    id: `task-${store.state.tasks.length + 1}`,
    title: title.trim(),
    description: description?.trim() ?? "",
    assignee: assignee.trim(),
    due,
    priority,
    storeId: storeId ?? null,
    origin: origin ?? "manual",
    status: "aberta",
    createdAt: Date.now(),
    history: [{ at: Date.now(), by: store.viewer().name, text: "Tarefa criada" }],
  };
  store.state.tasks.unshift(task);
  store.audit("task.created", task.title, { responsável: task.assignee, prazo: due, prioridade: PRIORITIES[priority] });
  store.commit();
  return task;
}

export function updateTask(store, taskId, status, note) {
  const task = store.state.tasks.find((t) => t.id === taskId);
  if (!task) throw new DemoError("Tarefa não encontrada.");
  if (!store.can("tasks.manage") && task.assignee !== store.viewer().name) throw new DemoError("Você só altera tarefas atribuídas a você.");
  if (!TASK_STATUS[status]) throw new DemoError("Situação inválida.");
  task.status = status;
  task.history.push({ at: Date.now(), by: store.viewer().name, text: note?.trim() ? `${TASK_STATUS[status]}: ${note.trim()}` : TASK_STATUS[status] });
  store.audit("task.updated", task.title, { situação: TASK_STATUS[status] });
  store.commit();
}

export function approveCommission(store, statementId) {
  store.assertCan("commissions.approve", "Aprovar comissões exige perfil de proprietário.");
  const statement = store.state.commissionStatements.find((c) => c.id === statementId);
  if (!statement) throw new DemoError("Apuração não encontrada.");
  if (statement.status !== "apurada") throw new DemoError("Só apurações pendentes podem ser aprovadas.");
  Object.assign(statement, { status: "aprovada", approvedAt: Date.now(), approvedBy: store.viewer().name });
  const person = SALESPEOPLE.find((p) => p.id === statement.sellerId);
  store.audit("commission.approved", `Comissão ${person.name} ${statement.month}`, { valor: statement.amountCents });
  store.commit();
}

export function resolveAlert(store, alertId, note) {
  store.assertCan("tasks.manage", "Resolver alertas exige perfil de gestão.");
  const alert = store.state.alerts.find((a) => a.id === alertId);
  if (!alert) throw new DemoError("Alerta não encontrado.");
  store.assertStore(alert.storeId);
  if (alert.status !== "aberto") throw new DemoError("Este alerta já foi resolvido.");
  Object.assign(alert, { status: "resolvido", resolvedAt: Date.now(), resolvedBy: store.viewer().name, note: note?.trim() || null });
  store.audit("alert.resolved", `Alerta ${alert.rule}`, { situação: "resolvido", loja: storeName(alert.storeId) });
  store.commit();
}
