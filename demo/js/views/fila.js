// Queue ("lista da vez"): arrivals, calls by rotation, outcome per attendance.
import { NO_SALE_REASONS, SALESPEOPLE, STORES } from "../catalog.js";
import { int, minutesLabel, pct, time } from "../lib.js";
import { periodRange, queueMetrics } from "../metrics.js";
import { store } from "../app-store.js";
import { callNext, closeAttendance, registerArrival, sellerRotation } from "../ops.js";
import { AccessDenied, attempt, Badge, Card, Field, html, PageHeader, Tile, useNow, useState } from "../ui.js";

const KIND = { venda: "Venda", troca: "Troca", retirada: "Retirada" };
const sellerName = (id) => SALESPEOPLE.find((p) => p.id === id)?.name ?? "—";

export function Fila() {
  return store.can("queue.read") ? html`<${FilaView} />` : html`<${AccessDenied} what="Fila de atendimento" />`;
}

function FilaView() {
  const now = useNow(1000);
  const viewer = store.viewer();
  const [storeId, setStoreId] = useState(viewer.storeIds[0]);
  const [arrival, setArrival] = useState({ kind: "venda", preferential: false });
  const [pick, setPick] = useState("");
  const [reasons, setReasons] = useState({});
  const { state } = store;
  const today = periodRange("hoje", now);
  const metrics = queueMetrics(state, today, { storeIds: [storeId] });
  const waiting = state.attendances
    .filter((a) => a.storeId === storeId && a.status === "aguardando")
    .sort((a, b) => Number(b.preferential) - Number(a.preferential) || a.arrivedAt - b.arrivedAt);
  const active = state.attendances.filter((a) => a.storeId === storeId && a.status === "em_atendimento");
  const closed = state.attendances
    .filter((a) => a.storeId === storeId && a.endedAt && a.endedAt >= today.from && a.status !== "em_atendimento")
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 10);
  const rotation = sellerRotation(state, storeId);
  const minutes = (from) => minutesLabel((now - from) / 60_000);

  return html`<div className="view">
    <${PageHeader}
      title="Fila de atendimento"
      subtitle="Preferencial primeiro (Lei 10.048/2000); depois ordem de chegada, para o vendedor livre há mais tempo"
      actions=${viewer.storeIds.length > 1
        ? html`<label className="inline-field">Loja <select value=${storeId} onChange=${(e) => setStoreId(e.target.value)}>${STORES.filter((s) => viewer.storeIds.includes(s.id)).map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}</select></label>`
        : null}
    />
    <div className="tiles tiles--4">
      <${Tile} label="Chegadas hoje" value=${int(metrics.arrivals)} />
      <${Tile} label="Espera média" value=${minutesLabel(metrics.avgWait)} detail=${`Máxima ${minutesLabel(metrics.maxWait)}`} />
      <${Tile} label="Desistências" value=${int(metrics.abandoned)} detail=${pct(metrics.abandonment)} />
      <${Tile} label="Conversão" value=${pct(metrics.conversion)} detail=${`${int(metrics.converted)} de ${int(metrics.attended)}`} />
    </div>
    <div className="grid grid--3">
      <${Card} title=${`Aguardando (${waiting.length})`}>
        <div className="form-grid form-grid--inline">
          <${Field} label="Tipo" id="fila-tipo"><select id="fila-tipo" value=${arrival.kind} onChange=${(e) => setArrival({ ...arrival, kind: e.target.value })}>${Object.entries(KIND).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
          <label className="check"><input type="checkbox" checked=${arrival.preferential} onChange=${(e) => setArrival({ ...arrival, preferential: e.target.checked })} /> Preferencial</label>
          <button type="button" className="btn btn--secondary" onClick=${() => { const a = attempt(store, () => registerArrival(store, storeId, arrival)); if (a) store.notify(`Chegada registrada: senha ${a.number}.`); }}>Registrar chegada</button>
        </div>
        ${waiting.length === 0 ? html`<p className="empty">Ninguém aguardando.</p>` : null}
        <ul className="queue">
          ${waiting.map((a) => html`<li key=${a.id}>
            <strong className="queue__number">${a.number}</strong>
            <span>${KIND[a.kind]} ${a.preferential ? html`<${Badge} tone="info">Preferencial<//>` : null}<small className="block muted">chegou ${time(a.arrivedAt)} · espera ${minutes(a.arrivedAt)}</small></span>
            <button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => closeAttendance(store, a.id, { outcome: "desistencia" }), `${a.number} registrado como desistência.`)}>Desistiu</button>
          </li>`)}
        </ul>
        <div className="form-grid form-grid--inline">
          <${Field} label="Vendedor" id="fila-vend"><select id="fila-vend" value=${pick} onChange=${(e) => setPick(e.target.value)}><option value="">Lista da vez</option>${rotation.filter((r) => !r.busy).map((r) => html`<option key=${r.person.id} value=${r.person.id}>${r.person.name}</option>`)}</select><//>
          <button type="button" className="btn btn--primary" disabled=${waiting.length === 0} onClick=${() => { const a = attempt(store, () => callNext(store, storeId, pick || undefined)); if (a) { store.notify(`${a.number} chamado para ${sellerName(a.sellerId)}.`); setPick(""); } }}>Chamar próximo</button>
        </div>
      <//>
      <${Card} title=${`Em atendimento (${active.length})`}>
        ${active.length === 0 ? html`<p className="empty">Nenhum atendimento em andamento.</p>` : null}
        <ul className="queue">
          ${active.map((a) => html`<li key=${a.id} className="queue__active">
            <strong className="queue__number">${a.number}</strong>
            <span>${sellerName(a.sellerId)} · ${KIND[a.kind]}<small className="block muted">há ${minutes(a.calledAt)}</small></span>
            <div className="queue__close">
              <a className="btn btn--secondary btn--small" href="#pdv">Vender no PDV</a>
              <select aria-label=${`Motivo sem venda para ${a.number}`} value=${reasons[a.id] ?? ""} onChange=${(e) => setReasons({ ...reasons, [a.id]: e.target.value })}>
                <option value="">Motivo sem venda…</option>
                ${[...NO_SALE_REASONS, "Troca realizada", "Retirada de pedido"].map((r) => html`<option key=${r}>${r}</option>`)}
              </select>
              <button type="button" className="btn btn--ghost btn--small" onClick=${() => attempt(store, () => closeAttendance(store, a.id, { outcome: "sem_venda", reason: reasons[a.id] }), `${a.number} encerrado sem venda.`)}>Encerrar</button>
            </div>
          </li>`)}
        </ul>
        <p className="muted small">A venda é vinculada ao atendimento no PDV (campo “Atendimento da fila”), o que evita contar a conversão duas vezes.</p>
      <//>
      <${Card} title="Lista da vez">
        <ol className="rotation">
          ${rotation.map((r) => html`<li key=${r.person.id}>
            <span>${r.person.name}<small className="block muted">${r.person.specialty}</small></span>
            <${Badge} tone=${r.busy ? "attention" : "positive"}>${r.busy ? "Atendendo" : "Livre"}<//>
          </li>`)}
        </ol>
        <h3 className="subhead">Motivos sem venda hoje</h3>
        ${metrics.lostReasons.length ? html`<ul className="plain">${metrics.lostReasons.map(([r, n]) => html`<li key=${r}><span>${r}</span><strong className="num">${n}</strong></li>`)}</ul>` : html`<p className="empty">Nenhum ainda.</p>`}
      <//>
    </div>
    <${Card} title="Encerrados hoje" subtitle="Últimos 10">
      <ul className="plain">
        ${closed.map((a) => html`<li key=${a.id}>
          <span><strong>${a.number}</strong> · ${time(a.endedAt)} · ${a.status === "desistencia" ? "Desistência" : sellerName(a.sellerId)}</span>
          ${a.status === "desistencia" ? html`<${Badge} tone="critical">Desistiu<//>` : a.outcome === "venda" ? html`<${Badge} tone="positive">Venda<//>` : html`<${Badge} tone="neutral">${a.reason}<//>`}
        </li>`)}
      </ul>
    <//>
  </div>`;
}
