// Virtual office page: map + list view over ONE snapshot of real run records.
// When the (simulated) connection drops, the last snapshot stays and is marked stale.
import { AGENTS, officeSnapshot, STATE_HINTS, STATE_LABELS } from "../agents.js";
import { ORGANIZATION, STORES } from "../catalog.js";
import { timeSeconds } from "../lib.js";
import * as m from "../metrics.js";
import { store } from "../app-store.js";
import { createOffice } from "../office.js";
import { runMonitoring } from "../orchestrator.js";
import { AccessDenied, attempt, html, PageHeader, Tile, useEffect, useRef, useState } from "../ui.js";
import { AgentPanel, AgentList, ActivityLog, STATE_TONE } from "./escritorio-painel.js";

function boardsInfo(state, scope, now) {
  const goals = STORES.filter((s) => scope.storeIds.includes(s.id)).map((s) => {
    const g = m.goalProgress(state, now, s.id);
    return { progress: g.progress, projection: g.projectionRatio };
  });
  const called = state.attendances.filter((a) => scope.storeIds.includes(a.storeId) && a.calledAt).sort((a, b) => b.calledAt - a.calledAt)[0];
  return {
    goals,
    lastCalled: called?.number ?? null,
    waiting: state.attendances.filter((a) => scope.storeIds.includes(a.storeId) && a.status === "aguardando").length,
    stockAlerts: m.inventoryAlerts(state, scope, now).alerts.filter((a) => a.status !== "excesso").length,
    openAlerts: state.alerts.filter((a) => a.status === "aberto" && scope.storeIds.includes(a.storeId)).length,
  };
}

const takeFeed = () => ({ snapshot: officeSnapshot(store.state, Date.now()), info: boardsInfo(store.state, store.scope(), Date.now()) });

/** Single feed for the page: one snapshot per tick, never one query per character. */
function useOfficeFeed(online) {
  const [feed, setFeed] = useState(takeFeed);
  useEffect(() => {
    if (!online) return undefined;
    const refresh = () => setFeed(takeFeed());
    refresh();
    const unsubscribe = store.subscribe(refresh);
    const id = setInterval(refresh, 1000);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, [online]);
  return feed;
}

export function Escritorio() {
  return store.can("office.read") ? html`<${EscritorioView} />` : html`<${AccessDenied} what="Escritório virtual" />`;
}

function EscritorioView() {
  const [online, setOnline] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [mode, setMode] = useState("mapa");
  const [selectedId, setSelectedId] = useState("central");
  const [filter, setFilter] = useState("");
  const [zoomLabel, setZoomLabel] = useState("100%");
  const feed = useOfficeFeed(online && !reconnecting);
  const stale = !online || reconnecting;
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const viewRef = useRef(null);
  // The canvas loop reads the latest view through this ref, synced after each render.
  useEffect(() => {
    viewRef.current = { snapshot: feed.snapshot, info: feed.info, stale, selectedId, filter };
  });
  const { counters, agents } = feed.snapshot;
  const selected = agents.find((a) => a.id === selectedId);

  useEffect(() => {
    if (mode !== "mapa" || !canvasRef.current) return undefined;
    const engine = createOffice(canvasRef.current, { getView: () => viewRef.current, onSelect: setSelectedId });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [mode]);

  const toggleConnection = () => {
    if (online) setOnline(false);
    else {
      setOnline(true);
      setReconnecting(true);
      setTimeout(() => setReconnecting(false), 1500);
    }
  };
  const zoom = (fn) => {
    engineRef.current?.[fn]();
    setZoomLabel(engineRef.current?.zoomLabel() ?? "100%");
  };
  const select = (id) => {
    setSelectedId(id);
    if (mode === "mapa") {
      engineRef.current?.focus(id);
      setZoomLabel(engineRef.current?.zoomLabel() ?? "100%");
    }
  };

  return html`<div className="view office-view">
    <${PageHeader}
      title="Escritório virtual de IA"
      subtitle=${`${ORGANIZATION.name} · cada personagem é um agente real da plataforma; estados vêm das execuções registradas`}
      actions=${store.can("tasks.manage") ? html`<button type="button" className="btn btn--secondary" onClick=${() => attempt(store, () => runMonitoring(store), "Rotina iniciada: veja o coordenador delegar aos especialistas.")}>Executar rotina de monitoramento</button>` : null}
    />
    <div className="tiles tiles--7">
      <${Tile} label="Agentes habilitados" value=${`${counters.enabled} de ${agents.length}`} />
      <${Tile} label="Disponíveis" value=${counters.available} />
      <${Tile} label="Em execução" value=${counters.running} />
      <${Tile} label="Etapas concluídas" value=${counters.completed} />
      <${Tile} label="Aguardando aprovação" value=${counters.awaiting} tone=${counters.awaiting ? "attention" : undefined} />
      <${Tile} label="Etapas com erro" value=${counters.errors} tone=${counters.errors ? "critical" : undefined} />
      <${Tile} label="Custo estimado de IA" value=${store.can("office.costs") ? "Não se aplica" : "Restrito"} detail=${store.can("office.costs") ? "Nenhum modelo é chamado na demonstração" : "Visível só para o proprietário"} />
    </div>
    <div className="office-toolbar">
      <div className="segmented" role="group" aria-label="Visualização">
        ${["mapa", "lista"].map((k) => html`<button key=${k} type="button" aria-pressed=${mode === k} className=${mode === k ? "is-active" : ""} onClick=${() => setMode(k)}>${k === "mapa" ? "Mapa 2D" : "Lista"}</button>`)}
      </div>
      ${mode === "mapa"
        ? html`<div className="zoom" role="group" aria-label="Zoom do mapa">
            <button type="button" className="btn btn--ghost btn--small" aria-label="Diminuir zoom" onClick=${() => zoom("zoomOut")}>−</button>
            <span className="zoom__label" aria-live="polite">${zoomLabel}</span>
            <button type="button" className="btn btn--ghost btn--small" aria-label="Aumentar zoom" onClick=${() => zoom("zoomIn")}>+</button>
            <button type="button" className="btn btn--ghost btn--small" onClick=${() => zoom("reset")}>Ajustar</button>
          </div>`
        : null}
      <label className="inline-field">Destacar <select value=${filter} onChange=${(e) => setFilter(e.target.value)}><option value="">Todos os estados</option>${Object.entries(STATE_LABELS).filter(([k]) => k !== "desatualizado").map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></label>
      <div className=${`connection ${stale ? "connection--off" : ""}`} role="status">
        <span aria-hidden="true" className="connection__dot"></span>
        ${reconnecting ? "Reconectando…" : online ? `Conectado · atualizado às ${timeSeconds(feed.snapshot.takenAt)}` : `Sem conexão · último estado de ${timeSeconds(feed.snapshot.takenAt)}`}
      </div>
      <button type="button" className="btn btn--ghost btn--small" onClick=${toggleConnection} title="Controle da demonstração">${online ? "Simular queda de conexão" : "Reconectar"}</button>
    </div>
    ${stale ? html`<div className="notice notice--attention" role="status">Sem conexão com o servidor. Os personagens aparecem desatualizados e nenhum estado novo é inventado até a reconexão.</div>` : null}
    <div className="office-layout">
      <div className="office-main">
        ${mode === "mapa"
          ? html`<div className="office-canvas">
              <canvas ref=${canvasRef} tabIndex="0" role="img" aria-label=${`Mapa do escritório com ${agents.length} agentes. ${agents.map((a) => `${a.name}, ${a.title}: ${STATE_LABELS[stale ? "desatualizado" : a.state]}`).join(". ")}.`} aria-describedby="office-help"></canvas>
              <p id="office-help" className="muted small">Clique num personagem ou sala para ver o agente. Com o mapa em foco: setas movem, + e − ajustam o zoom. A lista abaixo tem os mesmos dados.</p>
            </div>`
          : html`<${AgentList} agents=${agents} stale=${stale} selectedId=${selectedId} onSelect=${select} />`}
        <div className="agent-chips" role="listbox" aria-label="Agentes">
          ${agents.map((a) => {
            const st = stale ? "desatualizado" : a.state;
            return html`<button key=${a.id} type="button" role="option" aria-selected=${a.id === selectedId} className=${`agent-chip ${a.id === selectedId ? "is-active" : ""}`} onClick=${() => select(a.id)}>
              <span className=${`agent-chip__dot agent-chip__dot--${STATE_TONE[st]}`} aria-hidden="true"></span>
              <span><strong>${a.name}</strong><small>${STATE_LABELS[st]}</small></span>
            </button>`;
          })}
        </div>
        <${ActivityLog} />
      </div>
      ${selected ? html`<${AgentPanel} agent=${selected} stale=${stale} hint=${STATE_HINTS[stale ? "desatualizado" : selected.state]} />` : null}
    </div>
    <p className="muted small">${AGENTS.length} agentes · etapas têm duração mínima de 0,9 s na demonstração para a animação ser acompanhada.</p>
  </div>`;
}
