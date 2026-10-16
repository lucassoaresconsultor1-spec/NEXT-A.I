// Pixel-art drawing for the virtual office, in "art pixels" (1 unit = 1 buffer pixel).
// Characters are templates recolored per agent; nothing is loaded from the network.

const FRONT = [
  "....hhhh....",
  "...hhhhhh...",
  "..hhhhhhhh..",
  "..hssssssh..",
  "..sesssses..",
  "..ssssssss..",
  "...ssssss...",
  "....ssss....",
  "..tttttttt..",
  ".stttttttts.",
  ".stttttttts.",
  ".s.tttttt.s.",
  "...pppppp...",
  "...pp..pp...",
  "...pp..pp...",
  "...kk..kk...",
];
const BACK = [
  "....hhhh....",
  "...hhhhhh...",
  "..hhhhhhhh..",
  "..hhhhhhhh..",
  "..hhhhhhhh..",
  "...hhhhhh...",
  "....ssss....",
  "..tttttttt..",
  ".tttttttttt.",
  ".tttttttttt.",
];

const GREYS = new Map();
/** Desaturated version of a color (unavailable or stale agents). */
export function grey(hex) {
  if (!GREYS.has(hex)) {
    const n = parseInt(hex.slice(1), 16);
    const l = Math.round(0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255));
    const v = Math.round(l * 0.6 + 150 * 0.4);
    GREYS.set(hex, `rgb(${v},${v},${v})`);
  }
  return GREYS.get(hex);
}

export const rect = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

function drawTemplate(ctx, rows, x, y, colors, muted) {
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    for (let c = 0; c < row.length; c += 1) {
      const key = row[c];
      if (key === ".") continue;
      const color = colors[key];
      if (color) rect(ctx, x + c, y + r, 1, 1, muted ? grey(color) : color);
    }
  }
}

function palette(look) {
  return { h: look.hair, s: look.skin, e: "#1a1a1a", t: look.shirt, p: "#2d3748", k: "#141a24" };
}

/** Standing, facing the viewer. frame 0/1 = breathing. */
export function drawFront(ctx, x, y, look, frame, muted) {
  const bob = frame ? 1 : 0;
  const colors = palette(look);
  drawTemplate(ctx, FRONT.slice(8), x, y + 8, colors, muted);
  drawTemplate(ctx, FRONT.slice(0, 8), x, y + bob, colors, muted);
  const c = (color) => (muted ? grey(color) : color);
  if (look.style === "long") {
    for (let r = 3; r < 9; r += 1) {
      rect(ctx, x + 1, y + r + bob, 1, 1, c(look.hair));
      rect(ctx, x + 10, y + r + bob, 1, 1, c(look.hair));
    }
  }
  if (look.style === "bun") rect(ctx, x + 5, y - 2 + bob, 2, 2, c(look.hair));
  if (look.extra === "glasses") {
    rect(ctx, x + 2, y + 4 + bob, 3, 1, c("#0b0f14"));
    rect(ctx, x + 7, y + 4 + bob, 3, 1, c("#0b0f14"));
    rect(ctx, x + 5, y + 4 + bob, 2, 1, c("#0b0f14"));
  }
  if (look.extra === "headset") {
    rect(ctx, x + 2, y - 1 + bob, 8, 1, c("#374151"));
    rect(ctx, x + 1, y + 3 + bob, 1, 3, c("#374151"));
    rect(ctx, x + 10, y + 3 + bob, 1, 3, c("#374151"));
    rect(ctx, x + 9, y + 6 + bob, 2, 1, c("#374151"));
  }
  if (look.extra === "cap") {
    rect(ctx, x + 2, y + bob, 8, 2, c(look.shirt));
    rect(ctx, x + 2, y + 2 + bob, 10, 1, c(look.shirt));
  }
  if (look.extra === "tie") {
    rect(ctx, x + 5, y + 8, 2, 1, c("#f8fafc"));
    rect(ctx, x + 5, y + 9, 2, 3, c("#7f1d1d"));
  }
}

/** Seated with the back to the viewer, typing (frame alternates the arms). */
export function drawBack(ctx, x, y, look, frame, muted) {
  const colors = palette(look);
  drawTemplate(ctx, BACK, x, y, colors, muted);
  const skin = muted ? grey(look.skin) : look.skin;
  const lift = frame ? 1 : 0;
  rect(ctx, x, y + 6 - lift, 1, 2, skin);
  rect(ctx, x + 11, y + 5 + lift, 1, 2, skin);
  if (look.style === "long") rect(ctx, x + 3, y + 6, 6, 2, muted ? grey(look.hair) : look.hair);
  if (look.style === "bun") rect(ctx, x + 5, y - 2, 2, 2, muted ? grey(look.hair) : look.hair);
  if (look.extra === "headset") rect(ctx, x + 2, y - 1, 8, 1, muted ? grey("#374151") : "#374151");
  if (look.extra === "cap") rect(ctx, x + 2, y, 8, 2, muted ? grey(look.shirt) : look.shirt);
  rect(ctx, x + 1, y + 9, 10, 4, "#2a3140");
  rect(ctx, x + 1, y + 9, 10, 1, "#3b4456");
}

/** Desk with a monitor; `screen` draws what the agent is doing on it. */
export function drawDesk(ctx, x, y, screen) {
  rect(ctx, x, y + 6, 30, 9, "#6b4f3a");
  rect(ctx, x, y + 6, 30, 2, "#8a6a4f");
  rect(ctx, x + 1, y + 15, 2, 4, "#4a3628");
  rect(ctx, x + 27, y + 15, 2, 4, "#4a3628");
  rect(ctx, x + 8, y - 4, 14, 10, "#1b2230");
  rect(ctx, x + 9, y - 3, 12, 7, "#0b1220");
  rect(ctx, x + 14, y + 6, 2, 1, "#1b2230");
  rect(ctx, x + 10, y + 8, 10, 2, "#c8ced8");
  screen(x + 9, y - 3, 12, 7);
}

export function drawChair(ctx, x, y) {
  rect(ctx, x, y, 10, 4, "#2a3140");
  rect(ctx, x + 4, y + 4, 2, 2, "#1d2330");
}

export function drawPlant(ctx, x, y) {
  rect(ctx, x + 1, y + 6, 6, 5, "#8a5a3b");
  rect(ctx, x + 1, y + 6, 6, 1, "#a06a46");
  for (const [dx, dy] of [[3, 0], [1, 2], [5, 2], [2, 4], [4, 3], [0, 4], [6, 4], [3, 2]]) rect(ctx, x + dx, y + dy, 2, 2, dy < 2 ? "#4f9d5d" : "#3b7d4a");
}

export function drawShelf(ctx, x, y, w, h, items) {
  rect(ctx, x, y, w, h, "#5a4636");
  for (let row = 0; row < Math.floor(h / 7); row += 1) {
    rect(ctx, x, y + row * 7 + 6, w, 1, "#3e3026");
    for (let i = 0; i < Math.floor((w - 2) / 4); i += 1) {
      const color = items[(row * 7 + i) % items.length];
      rect(ctx, x + 1 + i * 4, y + row * 7 + 1, 3, 5, color);
    }
  }
}

export function drawBubble(ctx, x, y, kind, t, reduced) {
  const tone = { analisando: "#1f5bd1", executando: "#1f5bd1", gerando_relatorio: "#1f5bd1", aguardando_aprovacao: "#a35a00", concluido: "#18794e", erro: "#c22b2b", indisponivel: "#6b768a", desatualizado: "#6b768a" }[kind];
  if (!tone) return;
  rect(ctx, x, y, 11, 9, tone);
  rect(ctx, x + 1, y + 1, 9, 7, "#ffffff");
  rect(ctx, x + 4, y + 9, 3, 1, tone);
  rect(ctx, x + 5, y + 10, 1, 1, tone);
  const px = (dx, dy, w = 1, h = 1) => rect(ctx, x + dx, y + dy, w, h, tone);
  if (kind === "analisando") {
    const step = reduced ? 3 : Math.floor(t / 300) % 4;
    for (let i = 0; i < 3; i += 1) if (i < step || reduced) px(2 + i * 3, 4, 1, 1);
  } else if (kind === "executando") {
    // Delegation icon: a hub with spokes, pulsing while coordinating.
    const pulse = !reduced && Math.floor(t / 400) % 2 === 1;
    px(5, 2, 1, 5);
    px(3, 4, 5, 1);
    if (pulse) {
      px(2, 2, 1, 1);
      px(8, 2, 1, 1);
      px(2, 6, 1, 1);
      px(8, 6, 1, 1);
    }
  } else if (kind === "gerando_relatorio") {
    px(3, 2, 5, 1);
    px(3, 4, 5, 1);
    px(3, 6, reduced ? 5 : 1 + (Math.floor(t / 250) % 5), 1);
  } else if (kind === "aguardando_aprovacao") {
    for (const [dx, dy] of [[4, 2], [5, 2], [6, 2], [6, 3], [5, 4], [5, 6]]) px(dx, dy);
  } else if (kind === "concluido") {
    for (const [dx, dy] of [[2, 4], [3, 5], [4, 6], [5, 5], [6, 4], [7, 3], [8, 2]]) px(dx, dy);
  } else if (kind === "erro") {
    px(5, 2, 1, 3);
    px(5, 6, 1, 1);
  } else if (kind === "indisponivel") {
    px(3, 4, 5, 1);
  } else if (kind === "desatualizado") {
    px(4, 2, 3, 1);
    px(3, 3, 1, 3);
    px(7, 3, 1, 3);
    px(4, 6, 3, 1);
    px(5, 3, 1, 2);
    px(6, 4, 1, 1);
  }
}

/** Monitor content per state: animated only while the agent really works. */
export function screenPainter(ctx, state, t, reduced, room) {
  return (x, y, w, h) => {
    if (state === "indisponivel") {
      rect(ctx, x, y, w, h, "#05080f");
      return;
    }
    if (state === "erro") {
      rect(ctx, x, y, w, h, "#5c1414");
      rect(ctx, x + 5, y + 1, 2, 3, "#ff8a8a");
      rect(ctx, x + 5, y + 5, 2, 1, "#ff8a8a");
      return;
    }
    if (state === "aguardando_aprovacao") {
      rect(ctx, x, y, w, h, "#2a1c05");
      if (reduced || Math.floor(t / 500) % 2) rect(ctx, x + 5, y + 2, 2, 3, "#f5b342");
      return;
    }
    if (state === "gerando_relatorio") {
      rect(ctx, x, y, w, h, "#e9eef7");
      const lines = reduced ? 3 : 1 + (Math.floor(t / 300) % 3);
      for (let i = 0; i < lines; i += 1) rect(ctx, x + 2, y + 1 + i * 2, w - 4 - (i % 2) * 3, 1, "#1f5bd1");
      return;
    }
    const working = state === "analisando" || state === "executando";
    rect(ctx, x, y, w, h, working ? "#0d2a5c" : "#0b1220");
    for (let i = 0; i < 5; i += 1) {
      const base = [3, 5, 2, 6, 4][(i + room) % 5];
      const height = working && !reduced ? 1 + Math.round(((Math.sin(t / 220 + i * 1.3 + room) + 1) / 2) * (h - 2)) : working ? base : Math.min(base, 2);
      rect(ctx, x + 1 + i * 2, y + h - height, 1, height, working ? "#5fb3ff" : "#24406e");
    }
  };
}
