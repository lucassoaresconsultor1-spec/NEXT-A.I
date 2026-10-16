// Assertion-based self-check of the demo engine (no browser). Run: node demo/selfcheck.mjs
import assert from "node:assert/strict";
import { PRODUCTS, STORES } from "./js/catalog.js";
import { agentState, officeSnapshot } from "./js/agents.js";
import { isValidCpf, ean13, parseCents } from "./js/lib.js";
import * as m from "./js/metrics.js";
import { decideRecommendation, planQuestion, ask, runMonitoring, setStepDelay, toggleAgent } from "./js/orchestrator.js";
import { finalizeSale, openCash, todaySession } from "./js/pdv-ops.js";
import { createStore } from "./js/store.js";
import { TOOLS } from "./js/tools.js";

setStepDelay(0);
// Fixed instant: a Friday afternoon in São Paulo, so history and "today" are reproducible.
const NOW = Date.parse("2026-10-16T18:30:00Z");
const realNow = Date.now;
Date.now = () => NOW;

const store = createStore(NOW);
const { state } = store;
const all = { storeIds: STORES.map((s) => s.id) };

// Helpers
assert.equal(ean13("200000000001").length, 13);
assert.ok(isValidCpf("529.982.247-25") && !isValidCpf("111.111.111-11") && !isValidCpf("529.982.247-24"));
assert.equal(parseCents("1.234,56"), 123456);
assert.equal(parseCents("12.5"), 1250);
assert.equal(parseCents("abc"), null);

// Fictitious history is large enough and the ledger never goes negative.
assert.ok(state.sales.length > 2000, `poucas vendas: ${state.sales.length}`);
for (const shop of STORES) for (const p of PRODUCTS) assert.ok(m.stockBalance(state, shop.id, p.id) >= 0, `saldo negativo ${shop.id} ${p.id}`);

// One indicator, one value: totals by store and the daily chart match the summary.
const month = m.periodRange("mes", NOW);
const total = m.salesSummary(state, month, all);
assert.equal(total.net, total.gross - total.discounts);
assert.equal(m.byStore(state, month, all).reduce((a, s) => a + s.net, 0), total.net);
const last30 = m.periodRange("30d", NOW);
assert.equal(m.dailyNet(state, 30, all, NOW).reduce((a, d) => a + d.value, 0), m.salesSummary(state, last30, all).net);
assert.equal(m.bySeller(state, month, all).reduce((a, s) => a + s.net, 0), total.net);

// Planted situations exist: stock-out, pending cash close, cash divergence.
const inv = m.inventoryAlerts(state, all, NOW);
assert.ok(inv.alerts.some((a) => a.status === "ruptura"), "sem ruptura");
assert.ok(inv.transfers.length > 0, "sem transferência sugerida");
const cash = m.cashStatus(state, all, NOW);
assert.ok(cash.find((c) => c.store.id === "s2").pending.length === 1);
assert.equal(cash.find((c) => c.store.id === "s4").divergent[0].diff, -1240);

// Seller scope only sees own numbers.
store.setViewer("seller");
const own = m.salesSummary(state, month, store.scope());
assert.ok(own.count > 0 && own.count < total.count);
assert.ok(m.salesIn(state, month, store.scope()).every((s) => s.sellerId === "p-ana"));
assert.throws(() => openCash(store, "s1", 20000), /gerente/);

// PDV: discount authorization, PIX pending, idempotency and stock ledger.
const product = PRODUCTS.find((p) => m.stockBalance(state, "s1", p.id) > 2);
const before = m.stockBalance(state, "s1", product.id);
const draft = (extra) => ({ storeId: "s1", sellerId: "p-ana", items: [{ productId: product.id, qty: 1 }], discountPct: 0, payments: [], ...extra });
assert.ok(todaySession(state, "s1", NOW)?.status === "aberto");
assert.throws(() => finalizeSale(store, draft({ discountPct: 12, payments: [{ method: "dinheiro", receivedCents: product.priceCents }] }), "k0"), /autorização do gerente/);
assert.throws(() => finalizeSale(store, draft({ payments: [{ method: "pix", cents: product.priceCents }] }), "k1"), /PIX/);
assert.throws(() => finalizeSale(store, draft({ payments: [{ method: "credito", cents: product.priceCents }] }), "k2"), /NSU/);
const pay = [{ method: "dinheiro", receivedCents: Math.ceil(product.priceCents / 5000) * 5000 }];
const sale = finalizeSale(store, draft({ payments: pay }), "attempt-1");
const again = finalizeSale(store, draft({ payments: pay }), "attempt-1");
assert.equal(again.id, sale.id);
assert.equal(state.sales.filter((s) => s.attemptKey === "attempt-1").length, 1);
assert.equal(m.stockBalance(state, "s1", product.id), before - 1);
assert.equal(sale.payments[0].cents + 0, sale.netCents);

// Tools respect permissions and scope.
store.setViewer("manager");
const ctxFor = (viewer) => ({ state, scope: { storeIds: viewer.storeIds, sellerId: viewer.sellerId ?? undefined }, can: (p) => viewer.permissions.has(p), now: NOW, params: { period: "mes" } });
assert.ok(TOOLS.compare_store_performance.run(ctxFor(store.viewer())).blocked);
assert.ok(!TOOLS.get_sales_summary.run(ctxFor(store.viewer())).blocked);

// Routing of the suggested questions.
const routes = {
  "Como estão as vendas hoje?": ["get_sales_summary"],
  "Quais lojas estão abaixo da meta?": ["get_goal_status"],
  "Compare o faturamento deste mês com o anterior.": ["get_sales_summary"],
  "Quais produtos correm risco de ruptura?": ["get_inventory_alerts"],
  "Quais vendedores precisam de acompanhamento?": ["get_salesperson_metrics"],
  "Onde o tempo de espera aumentou?": ["get_queue_metrics"],
  "Qual a política de descontos?": ["search_company_procedures"],
};
for (const [question, tools] of Object.entries(routes)) assert.deepEqual(planQuestion(question).steps.map((s) => s.tool), tools, question);
assert.equal(planQuestion("Compare o faturamento deste mês com o anterior.").period, "mes");
assert.equal(planQuestion("Gere o relatório executivo da semana.").kind, "relatorio");

// Runs: monitoring creates alerts; a question gets an answer; approval creates a transfer.
store.setViewer("owner");
await runMonitoring(store).done;
for (const rule of ["Caixa pendente", "Divergência de caixa", "Ruptura de estoque"]) assert.ok(state.alerts.some((a) => a.rule === rule), rule);
const alertCount = state.alerts.length;
await runMonitoring(store).done;
assert.equal(state.alerts.length, alertCount, "alertas duplicados");
const { run } = ask(store, "Gere o relatório executivo da semana.");
await new Promise((r) => setTimeout(r, 0));
const finished = await (async () => { while (run.status === "em_execucao") await new Promise((r) => setTimeout(r, 0)); return run; })();
assert.ok(finished.answer.reportId && state.reports.length === 1);
const pending = state.recommendations.find((r) => r.status === "pendente" && r.approval.type === "transfer");
assert.ok(pending, "sem recomendação pendente");
assert.equal(agentState(state, "estoque", NOW), "aguardando_aprovacao");
decideRecommendation(store, pending.id, true);
assert.equal(state.transfers.length, 1);

// Disabled agent shows as unavailable and its step is blocked.
toggleAgent(store, "financeiro");
assert.equal(agentState(state, "financeiro", NOW), "indisponivel");
const snap = officeSnapshot(state, NOW);
assert.equal(snap.agents.length, 8);
assert.equal(snap.counters.enabled, 7);

Date.now = realNow;
console.log(`ok: ${state.sales.length} vendas, ${state.attendances.length} atendimentos, ${state.movements.length} movimentações, ${state.alerts.length} alertas`);
