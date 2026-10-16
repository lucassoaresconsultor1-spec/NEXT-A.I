// Canvas engine of the virtual office, isolated with an explicit lifecycle:
// createOffice() starts one render loop and its listeners; destroy() releases all.
// It only draws what getView() returns; it never queries data per character.
import { doorPoint, drawBoards, drawDeskWithScreen, drawStatic, FONT, LABELS, MAP_H, MAP_W, ROOMS, seatAt, standAt } from "./office-rooms.js";
import { drawBack, drawBubble, drawFront, rect, screenPainter } from "./sprites.js";

const SEATED = new Set(["analisando", "executando", "gerando_relatorio"]);
const ZOOMS = [1, 1.5, 2, 3];

export function createOffice(canvas, { getView, onSelect }) {
  const ctx = canvas.getContext("2d");
  const buffer = document.createElement("canvas");
  buffer.width = MAP_W;
  buffer.height = MAP_H;
  const bctx = buffer.getContext("2d");
  const staticLayer = document.createElement("canvas");
  staticLayer.width = MAP_W;
  staticLayer.height = MAP_H;
  drawStatic(staticLayer.getContext("2d"));
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const camera = { zoom: 0, x: 0, y: 0, base: 1, cssW: 0, cssH: 0 };
  let raf = 0;
  let last = 0;
  let drag = null;
  let boxes = [];

  const scale = () => camera.base * ZOOMS[camera.zoom];
  const clamp = () => {
    const vw = camera.cssW / scale();
    const vh = camera.cssH / scale();
    camera.x = vw >= MAP_W ? (MAP_W - vw) / 2 : Math.min(Math.max(camera.x, 0), MAP_W - vw);
    camera.y = vh >= MAP_H ? (MAP_H - vh) / 2 : Math.min(Math.max(camera.y, 0), MAP_H - vh);
  };
  const layout = () => {
    const width = canvas.parentElement.clientWidth;
    camera.base = Math.max(width / MAP_W, 1.3);
    camera.cssW = width;
    camera.cssH = Math.round(Math.min(MAP_H * camera.base, Math.max(window.innerHeight * 0.72, 320)));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = `${camera.cssH}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(camera.cssH * dpr);
    clamp();
    render(performance.now());
  };

  function render(t) {
    const view = getView();
    const reduced = motion.matches;
    const { snapshot, stale, selectedId, filter } = view;
    bctx.drawImage(staticLayer, 0, 0);
    const active = new Set(snapshot.connections.map((c) => snapshot.agents.find((a) => a.id === c.to)?.room));
    drawBoards(bctx, view.info, stale ? new Set() : active, t, reduced);
    bctx.font = FONT;
    bctx.textBaseline = "top";
    ROOMS.forEach((room, i) => {
      bctx.fillStyle = "#062f28";
      bctx.fillText(`${room.n} ${LABELS[i]}`, room.x + 3, room.y + room.h - 10);
    });
    if (!stale) drawConnections(bctx, snapshot, t, reduced);
    boxes = [];
    for (const agent of snapshot.agents) {
      const room = ROOMS[agent.room - 1];
      const state = stale ? "desatualizado" : agent.state;
      const muted = state === "indisponivel" || state === "desatualizado";
      const dim = filter && filter !== agent.state;
      bctx.globalAlpha = dim ? 0.35 : 1;
      drawDeskWithScreen(bctx, room, screenPainter(bctx, stale ? "indisponivel" : agent.state, t, reduced, agent.room));
      const frame = reduced ? 0 : Math.floor((t + agent.room * 170) / (SEATED.has(state) ? 180 : 700)) % 2;
      const pos = SEATED.has(state) ? seatAt(room) : standAt(room);
      if (SEATED.has(state)) drawBack(bctx, pos.x, pos.y, agent.look, frame, muted);
      else drawFront(bctx, pos.x, pos.y, agent.look, frame, muted);
      drawBubble(bctx, pos.x + 1, pos.y - 13, state === "disponivel" ? null : state, t, reduced);
      const label = agent.name.toUpperCase();
      const width = Math.ceil(bctx.measureText(label).width) + 4;
      const lx = Math.round(pos.x + 6 - width / 2);
      const ly = pos.y + (SEATED.has(state) ? 14 : 17);
      rect(bctx, lx, ly, width, 9, agent.id === selectedId ? "#9fe870" : "#062f28");
      bctx.fillStyle = agent.id === selectedId ? "#062f28" : "#ffffff";
      bctx.fillText(label, lx + 2, ly + 1);
      if (agent.id === selectedId) {
        bctx.strokeStyle = "#9fe870";
        bctx.lineWidth = 1;
        bctx.strokeRect(pos.x - 3.5, pos.y - 15.5, 19, 42);
      }
      bctx.globalAlpha = 1;
      boxes.push({ id: agent.id, x: pos.x - 4, y: pos.y - 14, w: 20, h: 44, room });
    }
    ctx.imageSmoothingEnabled = false;
    const s = scale();
    ctx.fillStyle = "#062f28";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer, camera.x, camera.y, camera.cssW / s, camera.cssH / s, 0, 0, canvas.width, canvas.height);
  }

  function drawConnections(c, snapshot, t, reduced) {
    const central = ROOMS[0];
    for (const link of snapshot.connections) {
      const target = ROOMS[snapshot.agents.find((a) => a.id === link.to).room - 1];
      const from = { x: central.desk.x + 15, y: central.desk.y + 20 };
      const a = doorPoint(central);
      const b = doorPoint(target);
      const to = { x: target.desk.x + 15, y: target.desk.y + 20 };
      const path = [from, { x: a.x, y: from.y }, a, { x: a.x, y: 150 }, { x: b.x, y: 150 }, b, { x: b.x, y: to.y }, to];
      let offset = reduced ? 0 : (t / 40) % 6;
      for (let i = 0; i < path.length - 1; i += 1) {
        const p = path[i];
        const q = path[i + 1];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        for (let d = offset; d < len; d += 6) {
          const x = Math.round(p.x + ((q.x - p.x) * d) / len);
          const y = Math.round(p.y + ((q.y - p.y) * d) / len);
          rect(c, x, y, 2, 2, "#9fe870");
        }
        offset = (offset + 6 - (len % 6)) % 6;
      }
    }
  }

  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    if (t - last < (motion.matches ? 500 : 50)) return;
    last = t;
    render(t);
  };

  const toMap = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: camera.x + (event.clientX - box.left) / scale(), y: camera.y + (event.clientY - box.top) / scale() };
  };
  const hit = (p) => {
    const agent = boxes.find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (agent) return agent.id;
    return boxes.find((b) => p.x >= b.room.x && p.x <= b.room.x + b.room.w && p.y >= b.room.y && p.y <= b.room.y + b.room.h)?.id ?? null;
  };
  const onDown = (event) => {
    drag = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y, moved: false };
    canvas.setPointerCapture(event.pointerId);
  };
  const onMove = (event) => {
    if (!drag) {
      canvas.style.cursor = hit(toMap(event)) ? "pointer" : "grab";
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    camera.x = drag.cx - dx / scale();
    camera.y = drag.cy - dy / scale();
    clamp();
  };
  const onUp = (event) => {
    if (drag && !drag.moved) {
      const id = hit(toMap(event));
      if (id) onSelect(id);
    }
    drag = null;
  };
  const zoomTo = (index, focus) => {
    const s0 = scale();
    const center = focus ?? { x: camera.x + camera.cssW / s0 / 2, y: camera.y + camera.cssH / s0 / 2 };
    camera.zoom = Math.min(Math.max(index, 0), ZOOMS.length - 1);
    camera.x = center.x - camera.cssW / scale() / 2;
    camera.y = center.y - camera.cssH / scale() / 2;
    clamp();
  };
  const onKey = (event) => {
    const step = 24;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      camera.x += moves[event.key][0];
      camera.y += moves[event.key][1];
      clamp();
    } else if (event.key === "+" || event.key === "=") zoomTo(camera.zoom + 1);
    else if (event.key === "-") zoomTo(camera.zoom - 1);
    else return;
    event.preventDefault();
  };

  const resize = new ResizeObserver(layout);
  resize.observe(canvas.parentElement);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("keydown", onKey);
  document.fonts?.load(FONT).then(() => render(performance.now()), () => {});
  layout();
  raf = requestAnimationFrame(loop);

  return {
    zoomIn: () => zoomTo(camera.zoom + 1),
    zoomOut: () => zoomTo(camera.zoom - 1),
    reset: () => zoomTo(0),
    zoomLabel: () => `${Math.round(ZOOMS[camera.zoom] * 100)}%`,
    focus(agentId) {
      const room = ROOMS[(getView().snapshot.agents.find((a) => a.id === agentId)?.room ?? 1) - 1];
      zoomTo(Math.max(camera.zoom, 1), { x: room.x + room.w / 2, y: room.y + room.h / 2 });
    },
    destroy() {
      cancelAnimationFrame(raf);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("keydown", onKey);
      buffer.width = 0;
      staticLayer.width = 0;
    },
  };
}
