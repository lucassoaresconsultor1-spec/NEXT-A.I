// In-page "backend" of the demo: state, viewer permissions, audit and change events.
// Every mutation checks permission and store scope here, never in the view.
import { SALESPEOPLE, STORES } from "./catalog.js";
import { commissionFor, monthsAvailable } from "./metrics.js";
import { generateDemoData } from "./seed.js";

export class DemoError extends Error {}

const SELLER = ["dashboard.seller", "sales.own", "pdv.sell", "inventory.read", "queue.read", "queue.manage", "goals.own", "ai.use", "office.read", "tasks.own"];
const MANAGER = [
  ...SELLER.filter((p) => !p.endsWith(".own") && p !== "dashboard.seller"),
  "dashboard.manager", "sales.read", "pdv.discount.high", "pdv.cancel", "cash.read", "cash.manage", "inventory.manage",
  "goals.read", "commissions.read", "reports.read", "alerts.read", "tasks.manage", "audit.read", "recommendations.approve",
];
const OWNER = [...MANAGER, "dashboard.executive", "reports.network", "commissions.approve", "office.manage", "office.costs"];

export const VIEWERS = [
  { id: "owner", name: "Helena Duarte", title: "Proprietária", scopeLabel: "Todas as lojas", storeIds: STORES.map((s) => s.id), sellerId: null, permissions: new Set(OWNER) },
  { id: "manager", name: "Marcos Lima", title: "Gerente de loja", scopeLabel: "Loja Centro", storeIds: ["s1"], sellerId: null, permissions: new Set(MANAGER) },
  { id: "seller", name: "Ana Souza", title: "Vendedora", scopeLabel: "Loja Centro", storeIds: ["s1"], sellerId: "p-ana", permissions: new Set(SELLER) },
];

export const AUDIT_LABELS = {
  "demo.seeded": "Dados fictícios gerados",
  "sale.completed": "Venda finalizada",
  "sale.cancelled": "Venda cancelada",
  "sale.suspended": "Venda suspensa",
  "cash.opened": "Caixa aberto",
  "cash.closed": "Caixa fechado",
  "cash.movement": "Movimentação de caixa",
  "stock.movement": "Movimentação de estoque",
  "stock.transfer_requested": "Transferência solicitada",
  "stock.transfer_received": "Transferência recebida",
  "queue.arrival": "Chegada registrada",
  "queue.called": "Cliente chamado",
  "queue.closed": "Atendimento encerrado",
  "task.created": "Tarefa criada",
  "task.updated": "Tarefa atualizada",
  "recommendation.approved": "Recomendação aprovada",
  "recommendation.rejected": "Recomendação rejeitada",
  "agent.toggled": "Agente habilitado/desabilitado",
  "commission.approved": "Comissão aprovada",
  "run.cancelled": "Execução cancelada",
  "alert.resolved": "Alerta resolvido",
};

export function createStore(now = Date.now()) {
  const data = generateDemoData(now);
  const state = {
    ...data,
    viewerId: "owner",
    audit: [],
    tasks: [],
    alerts: [],
    runs: [],
    recommendations: [],
    reports: [],
    transfers: [],
    suspended: [],
    finalized: new Map(),
    agentsEnabled: {},
    online: true,
    snapshot: null,
    commissionStatements: [],
    flash: null,
    version: 0,
  };
  const [oldest, previous] = monthsAvailable(state);
  for (const person of SALESPEOPLE) {
    state.commissionStatements.push(
      { id: `com-${person.id}-${oldest}`, sellerId: person.id, month: oldest, status: "paga", amountCents: commissionFor(state, person.id, oldest), ruleVersion: 1 },
      { id: `com-${person.id}-${previous}`, sellerId: person.id, month: previous, status: "apurada", amountCents: commissionFor(state, person.id, previous), ruleVersion: 1 },
    );
  }
  const listeners = new Set();
  const store = {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => state.version,
    commit() {
      state.version += 1;
      for (const listener of listeners) listener();
    },
    viewer: () => VIEWERS.find((v) => v.id === state.viewerId),
    can: (permission) => store.viewer().permissions.has(permission),
    scope() {
      const viewer = store.viewer();
      return { storeIds: viewer.storeIds, sellerId: viewer.sellerId ?? undefined };
    },
    /** Out-of-scope records are reported as "not found", like the real product. */
    assertStore(storeId) {
      if (!store.viewer().storeIds.includes(storeId)) throw new DemoError("Loja não encontrada no seu acesso.");
    },
    assertCan(permission, message = "Seu perfil não tem permissão para esta ação.") {
      if (!store.can(permission)) throw new DemoError(message);
    },
    audit(action, entity, details = {}) {
      state.audit.unshift({ id: `aud-${state.audit.length + 1}`, at: Date.now(), actor: store.viewer().name, action, entity, details });
    },
    notify(message, tone = "success") {
      state.flash = { id: Date.now(), message, tone };
      store.commit();
    },
    setViewer(id) {
      state.viewerId = id;
      store.commit();
    },
  };
  state.audit.push({ id: "aud-0", at: now, actor: "Sistema da demo", action: "demo.seeded", entity: "demonstração", details: { semente: data.meta.seed, desde: data.meta.firstDay } });
  return store;
}
