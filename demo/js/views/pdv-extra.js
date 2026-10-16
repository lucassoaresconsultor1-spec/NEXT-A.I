// Non-fiscal receipt and today's sales (cancellation requires a manager and a reason).
import { PRODUCTS, SALESPEOPLE, STORES } from "../catalog.js";
import { brl, dayKey, dateTime, time } from "../lib.js";
import { store } from "../app-store.js";
import { cancelSale, PAYMENT_METHODS } from "../pdv-ops.js";
import { attempt, Badge, Card, html, useNow, useState } from "../ui.js";

const STATUS = { concluida: ["positive", "Concluída"], cancelada: ["critical", "Cancelada"], devolvida: ["attention", "Devolvida"] };

export function Receipt({ sale, onClose }) {
  const shop = STORES.find((s) => s.id === sale.storeId);
  const seller = SALESPEOPLE.find((p) => p.id === sale.sellerId);
  return html`<section className="receipt" aria-label="Comprovante da venda">
    <header>
      <strong>${shop.name} · Grupo Vitrine Sul</strong>
      <span>DOCUMENTO NÃO FISCAL · DEMONSTRAÇÃO</span>
    </header>
    <p>Venda ${sale.number} · ${dateTime(sale.at)} · vendedor ${seller.name}</p>
    <ul>
      ${sale.items.map((item) => {
        const p = PRODUCTS.find((x) => x.id === item.productId);
        return html`<li key=${item.productId}><span>${item.qty} × ${p.name} ${p.variant}</span><span>${brl(item.qty * item.unitCents)}</span></li>`;
      })}
    </ul>
    <dl>
      <div><dt>Subtotal</dt><dd>${brl(sale.grossCents)}</dd></div>
      ${sale.discountCents ? html`<div><dt>Desconto ${sale.discountPct}%${sale.discountAuthorizedBy ? ` (autorizado por ${sale.discountAuthorizedBy})` : ""}</dt><dd>− ${brl(sale.discountCents)}</dd></div>` : null}
      <div className="receipt__total"><dt>Total</dt><dd>${brl(sale.netCents)}</dd></div>
      ${sale.payments.map((p, i) => html`<div key=${i}><dt>${PAYMENT_METHODS[p.method]}${p.authCode ? ` · NSU ${p.authCode}` : ""}</dt><dd>${brl(p.method === "dinheiro" ? p.receivedCents : p.cents)}</dd></div>`)}
      ${sale.changeCents ? html`<div><dt>Troco</dt><dd>${brl(sale.changeCents)}</dd></div>` : null}
    </dl>
    <p className="small">CPF: ${sale.customerCpf ? "informado" : "não informado"} · NFC-e: integração fiscal pendente</p>
    <p className="small muted">Chave de idempotência: ${sale.attemptKey}. Um segundo clique com a mesma chave devolve esta venda, sem duplicar.</p>
    <button type="button" className="btn btn--ghost btn--small" onClick=${onClose}>Fechar comprovante</button>
  </section>`;
}

export function TodaySales({ storeId }) {
  const { state } = store;
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState("");
  const today = dayKey(useNow(60_000));
  const viewer = store.viewer();
  const sales = state.sales
    .filter((s) => s.storeId === storeId && dayKey(s.at) === today && (!viewer.sellerId || s.sellerId === viewer.sellerId))
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);
  const confirm = (saleId) => {
    if (attempt(store, () => cancelSale(store, saleId, reason), "Venda cancelada e estoque estornado.") !== undefined) {
      setCancelling(null);
      setReason("");
    }
  };
  return html`<${Card} title="Vendas de hoje" subtitle=${viewer.sellerId ? "Somente as suas" : "Últimas 12 da loja"}>
    ${sales.length === 0 ? html`<p className="empty">Nenhuma venda hoje ainda.</p>` : null}
    <ul className="sales-list">
      ${sales.map((s) => html`<li key=${s.id}>
        <div className="sales-list__main">
          <span><strong>${s.number}</strong> · ${time(s.at)} · ${SALESPEOPLE.find((p) => p.id === s.sellerId).name}</span>
          <span className="num">${brl(s.netCents)}</span>
          <${Badge} tone=${STATUS[s.status][0]}>${STATUS[s.status][1]}<//>
          ${s.status === "concluida" && store.can("pdv.cancel") && cancelling !== s.id
            ? html`<button type="button" className="btn btn--ghost btn--small" onClick=${() => setCancelling(s.id)}>Cancelar</button>`
            : null}
        </div>
        ${cancelling === s.id
          ? html`<div className="inline-form">
              <label htmlFor=${`motivo-${s.id}`}>Motivo do cancelamento</label>
              <input id=${`motivo-${s.id}`} value=${reason} onChange=${(e) => setReason(e.target.value)} placeholder="Ex.: erro de digitação" />
              <button type="button" className="btn btn--danger btn--small" onClick=${() => confirm(s.id)}>Confirmar cancelamento</button>
              <button type="button" className="btn btn--ghost btn--small" onClick=${() => setCancelling(null)}>Voltar</button>
            </div>`
          : null}
        ${s.status === "cancelada" ? html`<p className="muted small">Motivo: ${s.cancelReason}</p>` : null}
      </li>`)}
    </ul>
    ${!store.can("pdv.cancel") ? html`<p className="muted small">Cancelamentos exigem perfil de gerente.</p>` : null}
  <//>`;
}
