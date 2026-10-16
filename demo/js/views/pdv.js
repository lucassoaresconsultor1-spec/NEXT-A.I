// PDV: keyboard-first sale screen. "/" focuses search, Enter adds, F8 finalizes, F6 suspends.
import { PRODUCTS, SALESPEOPLE, STORES } from "../catalog.js";
import { brl, isValidCpf, normalize, parseCents } from "../lib.js";
import { stockBalance } from "../metrics.js";
import { store } from "../app-store.js";
import { draftTotals, finalizeSale, MAX_DISCOUNT, PAYMENT_METHODS, resumeSale, suspendSale, todaySession } from "../pdv-ops.js";
import { attempt, Badge, Card, Field, html, PageHeader, useEffect, useRef, useState } from "../ui.js";
import { Receipt, TodaySales } from "./pdv-extra.js";

const newKey = () => `tentativa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const emptyDraft = (storeId, sellerId) => ({ storeId, sellerId, items: [], discountPct: 0, customerCpf: "", attendanceId: null, payments: [] });

export function Pdv() {
  const viewer = store.viewer();
  const [storeId, setStoreId] = useState(viewer.storeIds[0]);
  const defaultSeller = viewer.sellerId ?? SALESPEOPLE.find((p) => p.storeId === storeId).id;
  const [draft, setDraft] = useState(() => emptyDraft(storeId, defaultSeller));
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState({ method: "dinheiro", amount: "", authCode: "", installments: 1 });
  const [receipt, setReceipt] = useState(null);
  const keyRef = useRef(newKey());
  const searchRef = useRef(null);
  const { state } = store;
  const session = todaySession(state, storeId);
  const totals = draftTotals(draft);
  const sellers = SALESPEOPLE.filter((p) => p.storeId === storeId && (!viewer.sellerId || p.id === viewer.sellerId));
  const inProgress = state.attendances.filter((a) => a.storeId === storeId && a.status === "em_atendimento" && a.sellerId === draft.sellerId);

  const q = normalize(query.trim());
  const results = q ? PRODUCTS.filter((p) => p.ean === q || normalize(`${p.sku} ${p.name} ${p.variant} ${p.brand}`).includes(q)).slice(0, 8) : [];

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const add = (product) => {
    setDraft((d) => {
      const existing = d.items.find((i) => i.productId === product.id);
      const items = existing ? d.items.map((i) => (i === existing ? { ...i, qty: i.qty + 1 } : i)) : [...d.items, { productId: product.id, qty: 1 }];
      return { ...d, items };
    });
    setQuery("");
    searchRef.current?.focus();
  };
  const setQty = (productId, qty) => update({ items: qty <= 0 ? draft.items.filter((i) => i.productId !== productId) : draft.items.map((i) => (i.productId === productId ? { ...i, qty } : i)) });
  const changeStore = (id) => {
    setStoreId(id);
    setDraft(emptyDraft(id, SALESPEOPLE.find((p) => p.storeId === id).id));
  };
  const reset = () => {
    setDraft(emptyDraft(storeId, defaultSeller));
    setPayment({ method: "dinheiro", amount: "", authCode: "", installments: 1 });
    keyRef.current = newKey();
  };
  const addPayment = () => {
    const cents = payment.amount.trim() ? parseCents(payment.amount) : totals.missingCents;
    if (!cents || cents <= 0) return store.notify("Informe um valor de pagamento válido.", "error");
    if (payment.method === "pix") return store.notify("PIX depende da integração com o provedor de pagamento (pendente).", "error");
    const entry = payment.method === "dinheiro" ? { method: "dinheiro", receivedCents: cents } : { method: payment.method, cents, authCode: payment.authCode.trim(), installments: Number(payment.installments) };
    update({ payments: [...draft.payments, entry] });
    setPayment({ method: payment.method, amount: "", authCode: "", installments: 1 });
  };
  const finalize = () => {
    const sale = attempt(store, () => finalizeSale(store, draft, keyRef.current), "Venda finalizada.");
    if (sale) {
      setReceipt(sale);
      reset();
    }
  };
  const suspend = () => {
    if (attempt(store, () => suspendSale(store, draft), "Venda suspensa.")) reset();
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "F8") {
        event.preventDefault();
        finalize();
      } else if (event.key === "F6") {
        event.preventDefault();
        suspend();
      } else if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cpfInvalid = draft.customerCpf && !isValidCpf(draft.customerCpf);
  return html`<div className="view">
    <${PageHeader}
      title="PDV"
      subtitle="Atalhos: / busca · Enter adiciona · F6 suspende · F8 finaliza"
      actions=${viewer.storeIds.length > 1
        ? html`<label className="inline-field">Loja <select value=${storeId} onChange=${(e) => changeStore(e.target.value)}>${STORES.filter((s) => viewer.storeIds.includes(s.id)).map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}</select></label>`
        : null}
    />
    ${!session || session.status !== "aberto"
      ? html`<div className="notice notice--attention" role="status">O caixa desta loja não está aberto hoje. ${store.can("cash.manage") ? html`<a className="link" href="#caixa">Abrir o caixa</a>` : "Peça ao gerente para abrir o caixa."}</div>`
      : null}
    <div className="pdv">
      <div className="pdv__left">
        <${Card} title="Produtos">
          <div className="field">
            <label htmlFor="pdv-busca">Buscar por nome, SKU ou código de barras</label>
            <input id="pdv-busca" ref=${searchRef} autoFocus autoComplete="off" value=${query} placeholder="Ex.: tênis, CAL-001 ou 2000000000017"
              onChange=${(e) => setQuery(e.target.value)}
              onKeyDown=${(e) => { if (e.key === "Enter" && results[0]) { e.preventDefault(); add(results[0]); } }} />
          </div>
          <ul className="results">
            ${results.map((p) => {
              const balance = stockBalance(state, storeId, p.id);
              return html`<li key=${p.id}><button type="button" className="result" disabled=${balance <= 0} onClick=${() => add(p)}>
                <span><strong>${p.name} ${p.variant}</strong><small>${p.sku} · ${p.ean} · ${p.brand}</small></span>
                <span className="result__side"><strong>${brl(p.priceCents)}</strong><small>${balance > 0 ? `${balance} em estoque` : "Sem estoque"}</small></span>
              </button></li>`;
            })}
          </ul>
          ${q && results.length === 0 ? html`<p className="empty">Nenhum produto encontrado para “${query}”.</p>` : null}
          ${!q ? html`<p className="muted small">Leitores de código de barras funcionam como teclado: leia o código e o Enter adiciona o item.</p>` : null}
        <//>
        <${TodaySales} storeId=${storeId} />
      </div>
      <div className="pdv__right">
        <${Card} title="Venda atual" actions=${draft.items.length ? html`<button type="button" className="btn btn--ghost" onClick=${reset}>Limpar</button>` : null}>
          ${draft.items.length === 0 ? html`<p className="empty">Carrinho vazio. Busque um produto para começar.</p>` : null}
          <ul className="cart">
            ${totals.lines.map((l) => html`<li key=${l.productId}>
              <span className="cart__name">${l.product.name} ${l.product.variant}<small>${brl(l.product.priceCents)} un.</small></span>
              <span className="qty">
                <button type="button" aria-label=${`Diminuir ${l.product.name}`} onClick=${() => setQty(l.productId, l.qty - 1)}>−</button>
                <span aria-live="polite">${l.qty}</span>
                <button type="button" aria-label=${`Aumentar ${l.product.name}`} onClick=${() => setQty(l.productId, l.qty + 1)}>+</button>
              </span>
              <strong className="num">${brl(l.totalCents)}</strong>
            </li>`)}
          </ul>
          <div className="form-grid">
            <${Field} label="Vendedor" id="pdv-vendedor">
              <select id="pdv-vendedor" value=${draft.sellerId} onChange=${(e) => update({ sellerId: e.target.value, attendanceId: null })}>${sellers.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</select>
            <//>
            <${Field} label="Atendimento da fila" id="pdv-atendimento" hint="Vincula a venda ao atendimento para a conversão">
              <select id="pdv-atendimento" value=${draft.attendanceId ?? ""} onChange=${(e) => update({ attendanceId: e.target.value || null })}>
                <option value="">Sem vínculo</option>
                ${inProgress.map((a) => html`<option key=${a.id} value=${a.id}>${a.number}</option>`)}
              </select>
            <//>
            <${Field} label="CPF do cliente (opcional)" id="pdv-cpf" hint=${cpfInvalid ? "CPF inválido" : "Na nota, quando o cliente pedir"}>
              <input id="pdv-cpf" inputMode="numeric" value=${draft.customerCpf} aria-invalid=${Boolean(cpfInvalid)} onChange=${(e) => update({ customerCpf: e.target.value })} />
            <//>
            <${Field} label="Desconto (%)" id="pdv-desconto" hint=${`Até ${MAX_DISCOUNT}% livre; acima exige gerente`}>
              <input id="pdv-desconto" type="number" min="0" max="15" step="1" value=${draft.discountPct} onChange=${(e) => update({ discountPct: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
            <//>
          </div>
          <dl className="totals">
            <div><dt>Subtotal</dt><dd>${brl(totals.grossCents)}</dd></div>
            <div><dt>Desconto</dt><dd>− ${brl(totals.discountCents)}</dd></div>
            <div className="totals__main"><dt>Total</dt><dd>${brl(totals.netCents)}</dd></div>
          </dl>
        <//>
        <${Card} title="Pagamento">
          <div className="form-grid">
            <${Field} label="Forma" id="pdv-forma">
              <select id="pdv-forma" value=${payment.method} onChange=${(e) => setPayment({ ...payment, method: e.target.value })}>
                ${Object.entries(PAYMENT_METHODS).map(([k, v]) => html`<option key=${k} value=${k} disabled=${k === "pix"}>${k === "pix" ? `${v} (integração pendente)` : v}</option>`)}
              </select>
            <//>
            <${Field} label=${payment.method === "dinheiro" ? "Valor recebido" : "Valor"} id="pdv-valor" hint=${`Vazio = restante (${brl(totals.missingCents)})`}>
              <input id="pdv-valor" inputMode="decimal" value=${payment.amount} placeholder="0,00" onChange=${(e) => setPayment({ ...payment, amount: e.target.value })} />
            <//>
            ${payment.method !== "dinheiro"
              ? html`<${Field} label="Autorização (NSU) da maquininha" id="pdv-nsu" hint="Cartão processado na maquininha avulsa; o sistema não aprova pagamentos">
                  <input id="pdv-nsu" inputMode="numeric" value=${payment.authCode} onChange=${(e) => setPayment({ ...payment, authCode: e.target.value })} />
                <//>`
              : null}
          </div>
          <button type="button" className="btn btn--secondary" onClick=${addPayment} disabled=${draft.items.length === 0}>Adicionar pagamento</button>
          <ul className="payments">
            ${draft.payments.map((p, i) => html`<li key=${i}>
              <span>${PAYMENT_METHODS[p.method]}${p.authCode ? ` · NSU ${p.authCode}` : ""}</span>
              <strong className="num">${brl(p.method === "dinheiro" ? p.receivedCents : p.cents)}</strong>
              <button type="button" className="btn btn--ghost btn--small" onClick=${() => update({ payments: draft.payments.filter((_, j) => j !== i) })}>Remover</button>
            </li>`)}
          </ul>
          <dl className="totals">
            <div><dt>Falta pagar</dt><dd>${brl(totals.missingCents)}</dd></div>
            <div><dt>Troco</dt><dd>${brl(totals.changeCents)}</dd></div>
          </dl>
          <div className="actions">
            <button type="button" className="btn btn--primary" onClick=${finalize} disabled=${draft.items.length === 0}>Finalizar venda (F8)</button>
            <button type="button" className="btn btn--secondary" onClick=${suspend} disabled=${draft.items.length === 0}>Suspender (F6)</button>
          </div>
          ${state.suspended.length
            ? html`<div className="suspended"><h3>Vendas suspensas</h3>${state.suspended.map((s) => html`<div key=${s.id} className="suspended__row">
                <span>${s.label} · ${s.draft.items.length} item(ns)</span>
                <button type="button" className="btn btn--ghost btn--small" onClick=${() => { const d = attempt(store, () => resumeSale(store, s.id)); if (d) { setDraft(d); keyRef.current = newKey(); } }}>Retomar</button>
              </div>`)}</div>`
            : null}
          <p className="muted small"><${Badge} tone="info">NFC-e<//> Emissão fiscal depende de provedor, certificado e homologação: integração pendente.</p>
        <//>
        ${receipt ? html`<${Receipt} sale=${receipt} onClose=${() => setReceipt(null)} />` : null}
      </div>
    </div>
  </div>`;
}
