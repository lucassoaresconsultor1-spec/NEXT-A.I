// Map layout and room furniture of the virtual office (top-down, pixel art).
// Boards that show numbers (goals, queue, alerts) read the same snapshot as the page.
import { drawChair, drawDesk, drawPlant, drawShelf, rect } from "./sprites.js";

export const MAP_W = 480;
export const MAP_H = 300;
export const ROOMS = Array.from({ length: 8 }, (_, i) => {
  const top = i < 4;
  const x = 6 + (i % 4) * 118;
  const y = top ? 8 : 172;
  return { n: i + 1, x, y, w: 114, h: 120, top, doorX: x + 47, desk: { x: x + 40, y: y + 52 } };
});
export const LABELS = ["CENTRAL", "BI", "COMERCIAL", "ESTOQUE", "FINANCEIRO", "ATENDIMENTO", "OPERAÇÕES", "CONHECIMENTO"];
const FLOORS = [["#c7d0de", "#bfc9d8"], ["#cdd5e0", "#c4cddb"], ["#d3d2cc", "#cbcac3"], ["#cfc8bb", "#c6bfb1"], ["#d0d5d9", "#c8cdd2"], ["#cbd3e0", "#c2cbd9"], ["#c9cdd4", "#c0c5cc"], ["#d4cfc4", "#ccc6ba"]];
export const FONT = '8px "Silkscreen", monospace';

/** Character anchor points: standing beside the desk, or seated at it. */
export const standAt = (room) => ({ x: room.desk.x + 33, y: room.desk.y + 2 });
export const seatAt = (room) => ({ x: room.desk.x + 9, y: room.desk.y + 13 });
export const doorPoint = (room) => ({ x: room.doorX + 10, y: room.top ? room.y + room.h + 2 : room.y - 2 });

/** Static layer: floors, walls, furniture. Drawn once into an offscreen buffer. */
export function drawStatic(ctx) {
  rect(ctx, 0, 0, MAP_W, MAP_H, "#252d3b");
  // Corridor: navy carpet with a runner.
  rect(ctx, 6, 132, MAP_W - 12, 36, "#1c2944");
  rect(ctx, 6, 147, MAP_W - 12, 6, "#22335a");
  for (let x = 10; x < MAP_W - 12; x += 16) rect(ctx, x, 149, 8, 2, "#2c4372");
  for (const x of [20, 128, 246, 364, 452]) drawPlant(ctx, x, 134);
  rect(ctx, 236, 134, 8, 12, "#dbe7f3");
  rect(ctx, 237, 135, 6, 4, "#6fb3e8");
  ROOMS.forEach((room, i) => {
    const [a, b] = FLOORS[i];
    for (let ty = room.y + 16; ty < room.y + room.h; ty += 8) {
      for (let tx = room.x; tx < room.x + room.w; tx += 8) rect(ctx, tx, ty, 8, 8, ((tx - room.x) / 8 + (ty - room.y) / 8) % 2 ? a : b);
    }
    // Back wall face with a baseboard (3/4 view).
    rect(ctx, room.x, room.y, room.w, 16, "#e4e9f0");
    rect(ctx, room.x, room.y + 14, room.w, 2, "#9aa6b8");
    // Door into the corridor.
    const doorY = room.top ? room.y + room.h : room.y - 4;
    rect(ctx, room.doorX, doorY, 20, 4, a);
    if (!room.top) rect(ctx, room.doorX, room.y, 20, 16, a);
    drawChair(ctx, room.desk.x + 10, room.desk.y + 21);
    drawPlant(ctx, room.x + room.w - 12, room.y + room.h - 14);
    FURNITURE[i](ctx, room);
  });
}

const FURNITURE = [
  (ctx, r) => {
    for (const [dx, dy] of [[0, 0], [16, 0], [0, 12], [16, 12]]) rect(ctx, r.x + 10 + dx, r.y + 78 + dy, 8, 4, "#2a3140");
    rect(ctx, r.x + 8, r.y + 84, 28, 6, "#7a5c45");
  },
  (ctx, r) => {
    rect(ctx, r.x + 8, r.y + 3, 22, 10, "#ffffff");
    for (const [i, h] of [[0, 4], [1, 7], [2, 5], [3, 8]]) rect(ctx, r.x + 11 + i * 5, r.y + 12 - h, 3, h, "#2a78d6");
    rect(ctx, r.x + 84, r.y + 3, 22, 10, "#ffffff");
    for (let i = 0; i < 9; i += 1) rect(ctx, r.x + 86 + i * 2, r.y + 10 - Math.round(Math.abs(Math.sin(i / 1.7)) * 5), 2, 1, "#eb6834");
    rect(ctx, r.x + 8, r.y + 86, 30, 18, "#9fb3d1");
  },
  (ctx, r) => {
    rect(ctx, r.x + 86, r.y + 74, 18, 10, "#5a4636");
    rect(ctx, r.x + 92, r.y + 68, 6, 6, "#d4a017");
  },
  (ctx, r) => {
    drawShelf(ctx, r.x + 4, r.y + 20, 12, 70, ["#b07a4a", "#c58c55", "#9c6a3e"]);
    drawShelf(ctx, r.x + r.w - 16, r.y + 20, 12, 56, ["#b07a4a", "#c58c55", "#9c6a3e"]);
    for (const [dx, dy] of [[24, 92], [34, 96], [28, 86]]) {
      rect(ctx, r.x + dx, r.y + dy, 9, 8, "#b07a4a");
      rect(ctx, r.x + dx, r.y + dy + 3, 9, 1, "#8a5d36");
    }
  },
  (ctx, r) => {
    for (let i = 0; i < 3; i += 1) {
      rect(ctx, r.x + 6 + i * 11, r.y + 18, 10, 22, "#8c96a8");
      rect(ctx, r.x + 8 + i * 11, r.y + 24, 6, 1, "#5c6678");
      rect(ctx, r.x + 8 + i * 11, r.y + 32, 6, 1, "#5c6678");
    }
    rect(ctx, r.x + 84, r.y + 80, 16, 14, "#3a4352");
    rect(ctx, r.x + 90, r.y + 85, 4, 4, "#c8ced8");
  },
  (ctx, r) => {
    rect(ctx, r.x + 74, r.y + 90, 30, 10, "#3f5f8f");
    rect(ctx, r.x + 74, r.y + 88, 30, 3, "#4f72a8");
  },
  (ctx, r) => {
    rect(ctx, r.x + 10, r.y + 80, 22, 12, "#5a4636");
  },
  (ctx, r) => {
    drawShelf(ctx, r.x + 4, r.y + 1, 50, 14, ["#1f5bd1", "#c2410c", "#18794e", "#7c3aed", "#a35a00", "#0e7490"]);
    drawShelf(ctx, r.x + 60, r.y + 1, 50, 14, ["#334155", "#be123c", "#0f766e", "#1d4ed8", "#a16207"]);
    rect(ctx, r.x + 12, r.y + 84, 14, 12, "#7f1d1d");
    rect(ctx, r.x + 14, r.y + 86, 10, 8, "#9b2c2c");
    rect(ctx, r.x + 32, r.y + 78, 2, 18, "#4b5563");
    rect(ctx, r.x + 29, r.y + 76, 8, 3, "#f5d76e");
  },
];

/** Per-frame boards with live data from the snapshot. */
export function drawBoards(ctx, info, active, t, reduced) {
  const [central, , comercial, estoque, , atendimento, operacoes] = ROOMS;
  // Central: agent network; spokes light up only for real delegations.
  rect(ctx, central.x + 30, central.y + 2, 54, 12, "#0f1d33");
  const hub = { x: central.x + 57, y: central.y + 8 };
  for (let i = 0; i < 7; i += 1) {
    const node = { x: central.x + 34 + i * 7.5, y: central.y + (i % 2 ? 4 : 11) };
    const on = active.has(i + 2);
    ctx.strokeStyle = on ? "#5fb3ff" : "#2c4372";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hub.x + 0.5, hub.y + 0.5);
    ctx.lineTo(Math.round(node.x) + 0.5, node.y + 0.5);
    ctx.stroke();
    rect(ctx, Math.round(node.x) - 1, node.y - 1, 3, 3, on ? "#9fd3ff" : "#3d5a8a");
  }
  rect(ctx, hub.x - 1, hub.y - 1, 3, 3, "#ffffff");
  // Comercial: one bar per store goal (progress), colored by projection.
  rect(ctx, comercial.x + 30, comercial.y + 2, 54, 12, "#ffffff");
  info.goals.slice(0, 4).forEach((g, i) => {
    rect(ctx, comercial.x + 33, comercial.y + 4 + i * 2.5, 48, 1, "#e2e8f0");
    rect(ctx, comercial.x + 33, comercial.y + 4 + i * 2.5, Math.max(1, Math.round(48 * Math.min(g.progress, 1))), 1, g.projection >= 1 ? "#18794e" : g.projection >= 0.9 ? "#a35a00" : "#c22b2b");
  });
  // Estoque: red tags on shelves, one per stock alert (capped).
  for (let i = 0; i < Math.min(info.stockAlerts, 8); i += 1) rect(ctx, estoque.x + 6 + (i % 2) * 4, estoque.y + 22 + Math.floor(i / 2) * 7, 2, 2, "#e34948");
  // Atendimento: queue panel with the real last called number and waiting count.
  rect(ctx, atendimento.x + 18, atendimento.y + 1, 78, 13, "#0b1220");
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#7ee0a1";
  ctx.fillText(info.lastCalled ?? "---", atendimento.x + 21, atendimento.y + 3);
  const waiting = `FILA ${info.waiting}`;
  ctx.fillStyle = info.waiting > 3 && (reduced || Math.floor(t / 600) % 2) ? "#f5b342" : "#c9d3e3";
  ctx.fillText(waiting, atendimento.x + 93 - Math.ceil(ctx.measureText(waiting).width), atendimento.y + 3);
  // Operações: monitoring wall, one red screen per open alert (capped).
  for (let i = 0; i < 6; i += 1) {
    const x = operacoes.x + 30 + (i % 3) * 18;
    const y = operacoes.y + 2 + Math.floor(i / 3) * 6;
    rect(ctx, x, y, 16, 5, "#1b2230");
    rect(ctx, x + 1, y + 1, 14, 3, i < info.openAlerts ? "#7f1d1d" : "#14532d");
  }
}

export function drawDeskWithScreen(ctx, room, screen) {
  drawDesk(ctx, room.desk.x, room.desk.y, screen);
}
