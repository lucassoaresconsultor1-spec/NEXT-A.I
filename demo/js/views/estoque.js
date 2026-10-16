// Stock by store, computed from the movement ledger; movements and transfers are audited.
import { CATEGORIES, PRODUCTS, STORES } from "../catalog.js";
import { dateTime, decimal, int, normalize } from "../lib.js";
import { ledger, stockRows } from "../metrics.js";
import { store } from "../app-store.js";
import { MOVEMENT_LABELS, receiveTransfer, requestTransfer, stockMovement } from "../ops.js";
import { AccessDenied, attempt, Badge, Card, DataTable, Field, html, PageHeader, useNow, useState } from "../ui.js";

export const STOCK_STATUS = { ruptura: ["critical", "Ruptura"], critico: ["attention", "Abaixo do mínimo"], excesso: ["info", "Excesso"], ok: ["positive", "Normal"] };
const storeName = (id) => STORES.find((s) => s.id === id).name;
const productName = (id) => {
  const p = PRODUCTS.find((x) => x.id === id);
  return `${p.name} ${p.variant}`;
};

export function Estoque() {
  return store.can("inventory.read") ? html`<${EstoqueView} />` : html`<${AccessDenied} what="Estoque" />`;
}

function EstoqueView() {
  const now = useNow(60_000);
  const viewer = store.viewer();
  const [storeId, setStoreId] = useState(viewer.storeIds[0]);
  const [filter, setFilter] = useState({ q: "", category: "", status: "" });
  const [selected, setSelected] = useState(null);
  const [move, setMove] = useState({ type: "entrada", qty: "", reason: "" });
  const [transfer, setTransfer] = useState({ productId: PRODUCTS[0].id, fromStoreId: STORES.find((s) => s.id !== viewer.storeIds[0]).id, qty: "1" });
  const { state } = store;
  const canManage = store.can("inventory.manage");
  const rows = stockRows(state, storeId, now).filter(
    (r) =>
      (!filter.category || r.product.category === filter.category) &&
      (!filter.status || r.status === filter.status) &&
      (!filter.q || normalize(`${r.product.sku} ${r.product.name} ${r.product.ean}`).includes(normalize(filter.q))),
  );
  const book = selected ? ledger(state, storeId, selected).reverse().slice(0, 15) : [];
  const transfers = state.transfers.filter((t) => viewer.storeIds.includes(t.toStoreId) || viewer.storeIds.includes(t.fromStoreId));
  const submitMove = () => {
    const qty = Number(move.qty);
    if (attempt(store, () => stockMovement(store, { storeId, productId: selected, type: move.type, qty, reason: move.reason }), "Movimentação lançada no livro de estoque.")) setMove({ ...move, qty: "", reason: "" });
  };

  return html`<div className="view">
    <${PageHeader}
      title="Estoque"
      subtitle="Saldo = soma das movimentações do livro; nunca é editado diretamente"
      actions=${viewer.storeIds.length > 1
        ? html`<label className="inline-field">Loja <select value=${storeId} onChange=${(e) => { setStoreId(e.target.value); setSelected(null); }}>${STORES.filter((s) => viewer.storeIds.includes(s.id)).map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}</select></label>`
        : null}
    />
    <div className="filters">
      <${Field} label="Buscar" id="est-busca"><input id="est-busca" value=${filter.q} placeholder="SKU, nome ou código" onChange=${(e) => setFilter({ ...filter, q: e.target.value })} /><//>
      <${Field} label="Categoria" id="est-cat"><select id="est-cat" value=${filter.category} onChange=${(e) => setFilter({ ...filter, category: e.target.value })}><option value="">Todas</option>${CATEGORIES.map((c) => html`<option key=${c}>${c}</option>`)}</select><//>
      <${Field} label="Situação" id="est-sit"><select id="est-sit" value=${filter.status} onChange=${(e) => setFilter({ ...filter, status: e.target.value })}><option value="">Todas</option>${Object.entries(STOCK_STATUS).map(([k, v]) => html`<option key=${k} value=${k}>${v[1]}</option>`)}</select><//>
    </div>
    <div className="grid grid--2-1">
      <${Card} title=${`Posição de estoque · ${storeName(storeId)}`} subtitle=${`${rows.length} itens`}>
        <${DataTable}
          numeric=${[2, 3, 4, 5]}
          empty="Nenhum item com esses filtros."
          columns=${["SKU", "Produto", "Saldo", "Mínimo", "Vendas 30d", "Cobertura", "Situação", ""]}
          rows=${rows.map((r) => [
            r.product.sku,
            html`${r.product.name} ${r.product.variant}<small className="block muted">${r.product.brand} · ${r.product.category}</small>`,
            int(r.balance),
            int(r.product.minStock),
            int(r.sold30),
            r.coverage === null ? "sem giro" : `${decimal(r.coverage, 0)} dias`,
            html`<${Badge} tone=${STOCK_STATUS[r.status][0]}>${STOCK_STATUS[r.status][1]}<//>`,
            html`<button type="button" className="btn btn--ghost btn--small" aria-pressed=${selected === r.product.id} onClick=${() => setSelected(r.product.id)}>Livro</button>`,
          ])}
        />
        <p className="muted small">Cobertura = saldo ÷ média diária de vendas dos últimos 30 dias. Excesso: cobertura acima de 120 dias e saldo maior que 3× o mínimo.</p>
      <//>
      <div className="stack">
        <${Card} title=${selected ? `Livro · ${productName(selected)}` : "Livro de movimentações"} subtitle=${selected ? "Últimas 15, mais recente primeiro" : null}>
          ${!selected ? html`<p className="empty">Escolha “Livro” em um item para ver as movimentações e o saldo após cada uma.</p>` : null}
          ${selected
            ? html`<${DataTable} numeric=${[2, 3]} columns=${["Quando", "Tipo", "Qtd.", "Saldo", "Motivo"]} rows=${book.map((mv) => [dateTime(mv.at), MOVEMENT_LABELS[mv.type], mv.qty > 0 ? `+${mv.qty}` : mv.qty, mv.balance, mv.reason])} />`
            : null}
          ${selected && canManage
            ? html`<div className="form-grid">
                <${Field} label="Tipo" id="mv-tipo"><select id="mv-tipo" value=${move.type} onChange=${(e) => setMove({ ...move, type: e.target.value })}><option value="entrada">Entrada (recebimento)</option><option value="perda">Perda</option><option value="ajuste">Ajuste de inventário (±)</option></select><//>
                <${Field} label="Quantidade" id="mv-qtd"><input id="mv-qtd" type="number" step="1" value=${move.qty} onChange=${(e) => setMove({ ...move, qty: e.target.value })} /><//>
                <${Field} label="Motivo" id="mv-motivo"><input id="mv-motivo" value=${move.reason} onChange=${(e) => setMove({ ...move, reason: e.target.value })} placeholder="Ex.: NF 1234 conferida" /><//>
                <button type="button" className="btn btn--primary" onClick=${submitMove}>Lançar no livro</button>
              </div>`
            : null}
          ${selected && !canManage ? html`<p className="muted small">Movimentar estoque exige perfil de gerente.</p>` : null}
        <//>
        <${Card} title="Transferências entre lojas">
          ${canManage
            ? html`<div className="form-grid">
                <${Field} label="Produto" id="tr-prod"><select id="tr-prod" value=${transfer.productId} onChange=${(e) => setTransfer({ ...transfer, productId: e.target.value })}>${PRODUCTS.map((p) => html`<option key=${p.id} value=${p.id}>${p.sku} · ${p.name} ${p.variant}</option>`)}</select><//>
                <${Field} label=${`De (para ${storeName(storeId)})`} id="tr-de"><select id="tr-de" value=${transfer.fromStoreId} onChange=${(e) => setTransfer({ ...transfer, fromStoreId: e.target.value })}>${STORES.filter((s) => s.id !== storeId).map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}</select><//>
                <${Field} label="Quantidade" id="tr-qtd"><input id="tr-qtd" type="number" min="1" step="1" value=${transfer.qty} onChange=${(e) => setTransfer({ ...transfer, qty: e.target.value })} /><//>
                <button type="button" className="btn btn--secondary" onClick=${() => attempt(store, () => requestTransfer(store, { ...transfer, toStoreId: storeId, qty: Number(transfer.qty) }), "Transferência solicitada.")}>Solicitar</button>
              </div>`
            : null}
          <${DataTable}
            empty="Nenhuma transferência ainda. Aprovar uma recomendação do Especialista de Estoque cria uma aqui."
            columns=${["Produto", "De → para", "Qtd.", "Situação", ""]}
            rows=${transfers.map((t) => [
              productName(t.productId),
              `${storeName(t.fromStoreId)} → ${storeName(t.toStoreId)}`,
              t.qty,
              html`<${Badge} tone=${t.status === "recebida" ? "positive" : "attention"}>${t.status === "recebida" ? "Recebida" : "Solicitada"}<//>`,
              t.status === "solicitada" && canManage && viewer.storeIds.includes(t.toStoreId)
                ? html`<button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => receiveTransfer(store, t.id), "Transferência recebida: saída e entrada lançadas.")}>Receber</button>`
                : "",
            ])}
          />
        <//>
      </div>
    </div>
  </div>`;
}
