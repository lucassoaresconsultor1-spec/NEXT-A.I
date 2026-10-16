// Cash register: open, withdrawals/supplies with justification, close with counted amount.
import { STORES } from "../catalog.js";
import { brl, date, parseCents, time } from "../lib.js";
import { cashExpected } from "../metrics.js";
import { store } from "../app-store.js";
import { cashMovement, closeCash, openCash, todaySession } from "../pdv-ops.js";
import { AccessDenied, attempt, Badge, Card, DataTable, Field, html, PageHeader, useState } from "../ui.js";

const STATUS = { aberto: ["positive", "Aberto"], fechado: ["neutral", "Fechado"], fechamento_pendente: ["critical", "Fechamento pendente"] };

export function Caixa() {
  return store.can("cash.read") ? html`<${CaixaView} />` : html`<${AccessDenied} what="Caixa" />`;
}

function CaixaView() {
  const viewer = store.viewer();
  const [storeId, setStoreId] = useState(viewer.storeIds[0]);
  const [form, setForm] = useState({ opening: "200,00", type: "sangria", amount: "", reason: "", counted: "", justification: "" });
  const { state } = store;
  const session = todaySession(state, storeId);
  const pending = state.cashSessions.filter((s) => s.storeId === storeId && s.status === "fechamento_pendente");
  const history = state.cashSessions.filter((s) => s.storeId === storeId).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 8);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const canManage = store.can("cash.manage");

  const close = (s) => {
    const diff = attempt(store, () => closeCash(store, s.id, parseCents(form.counted) ?? -1, form.justification));
    if (diff !== undefined) {
      store.notify(diff === 0 ? "Caixa fechado sem divergência." : `Caixa fechado com divergência de ${brl(diff)}.`, diff === 0 ? "success" : "attention");
      setForm({ ...form, counted: "", justification: "" });
    }
  };
  // Plain function (not a component) so inputs keep focus between renders.
  const closeForm = (s) => html`<div className="form-grid">
    <p className="muted small">Esperado na gaveta: <strong>${brl(cashExpected(state, s))}</strong> (fundo + vendas em dinheiro + suprimentos − sangrias)</p>
    <${Field} label="Valor contado" id=${`contado-${s.id}`}><input id=${`contado-${s.id}`} inputMode="decimal" value=${form.counted} onChange=${set("counted")} placeholder="0,00" /><//>
    <${Field} label="Justificativa (obrigatória se a diferença passar de R$ 5,00)" id=${`just-${s.id}`}><input id=${`just-${s.id}`} value=${form.justification} onChange=${set("justification")} /><//>
    <button type="button" className="btn btn--primary" disabled=${!canManage} onClick=${() => close(s)}>Fechar caixa de ${date(s.openedAt)}</button>
  </div>`;

  return html`<div className="view">
    <${PageHeader}
      title="Caixa"
      subtitle="Abertura, sangria, suprimento e fechamento com conferência"
      actions=${viewer.storeIds.length > 1
        ? html`<label className="inline-field">Loja <select value=${storeId} onChange=${(e) => setStoreId(e.target.value)}>${STORES.filter((s) => viewer.storeIds.includes(s.id)).map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}</select></label>`
        : null}
    />
    ${!canManage ? html`<div className="notice notice--info" role="status">Seu perfil consulta o caixa, mas abrir, movimentar e fechar exige gerente.</div>` : null}
    ${pending.map((s) => html`<${Card} key=${s.id} title=${`Fechamento pendente de ${date(s.openedAt)}`} className="card--critical">
      <p>O caixa deste dia não foi fechado. Conte o dinheiro guardado e registre o valor.</p>
      ${closeForm(s)}
    <//>`)}
    <div className="grid grid--2">
      <${Card} title="Caixa de hoje" actions=${session ? html`<${Badge} tone=${STATUS[session.status][0]}>${STATUS[session.status][1]}<//>` : null}>
        ${!session
          ? html`<div className="form-grid">
              <${Field} label="Fundo de troco" id="cx-fundo"><input id="cx-fundo" inputMode="decimal" value=${form.opening} onChange=${set("opening")} /><//>
              <button type="button" className="btn btn--primary" disabled=${!canManage} onClick=${() => attempt(store, () => openCash(store, storeId, parseCents(form.opening) ?? -1), "Caixa aberto.")}>Abrir caixa</button>
            </div>`
          : html`<dl className="totals">
              <div><dt>Aberto às</dt><dd>${time(session.openedAt)}</dd></div>
              <div><dt>Fundo de troco</dt><dd>${brl(session.openingCents)}</dd></div>
              <div className="totals__main"><dt>Esperado na gaveta</dt><dd>${brl(cashExpected(state, session))}</dd></div>
              ${session.status === "fechado" ? html`<div><dt>Contado</dt><dd>${brl(session.countedCents)}</dd></div>` : null}
            </dl>`}
        ${session?.status === "aberto" ? closeForm(session) : null}
      <//>
      <${Card} title="Sangria e suprimento">
        <div className="form-grid">
          <${Field} label="Tipo" id="cx-tipo"><select id="cx-tipo" value=${form.type} onChange=${set("type")}><option value="sangria">Sangria (retirada)</option><option value="suprimento">Suprimento (reforço)</option></select><//>
          <${Field} label="Valor" id="cx-valor"><input id="cx-valor" inputMode="decimal" value=${form.amount} onChange=${set("amount")} placeholder="0,00" /><//>
          <${Field} label="Justificativa" id="cx-motivo"><input id="cx-motivo" value=${form.reason} onChange=${set("reason")} placeholder="Ex.: sangria para o cofre" /><//>
          <button type="button" className="btn btn--secondary" disabled=${!canManage || session?.status !== "aberto"}
            onClick=${() => { if (attempt(store, () => cashMovement(store, storeId, form.type, parseCents(form.amount) ?? -1, form.reason), "Movimentação registrada.")) setForm({ ...form, amount: "", reason: "" }); }}>Registrar</button>
        </div>
        <${DataTable}
          caption="Movimentações de hoje"
          empty="Nenhuma movimentação hoje."
          numeric=${[2]}
          columns=${["Hora", "Tipo", "Valor", "Justificativa"]}
          rows=${(session?.movements ?? []).map((mv) => [time(mv.at), mv.type === "sangria" ? "Sangria" : "Suprimento", brl(mv.cents), mv.reason])}
        />
      <//>
    </div>
    <${Card} title="Histórico de fechamentos" subtitle="Últimos 8 dias">
      <${DataTable}
        numeric=${[2, 3, 4]}
        columns=${["Dia", "Situação", "Esperado", "Contado", "Divergência", "Justificativa"]}
        rows=${history.map((s) => {
          const expected = cashExpected(state, s);
          const diff = s.countedCents === null ? null : s.countedCents - expected;
          return [date(s.openedAt), html`<${Badge} tone=${STATUS[s.status][0]}>${STATUS[s.status][1]}<//>`, brl(expected), s.countedCents === null ? "—" : brl(s.countedCents),
            diff === null ? "—" : diff === 0 ? "—" : html`<span className=${Math.abs(diff) > 500 ? "text-critical" : ""}>${brl(diff)}</span>`, s.justification ?? "—"];
        })}
      />
    <//>
  </div>`;
}
