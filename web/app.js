/* ATLAS: interface. O motor (estruturas + simulação) roda num Web Worker;
   aqui só desenhamos e conversamos com ele por mensagens.
   Camadas de canvas: bg (quarteirões e ruas) e lbl (rótulos e hospitais) são
   estáticas e só redesenham ao mudar zoom, pan, tema ou malha; dyn (trânsito,
   rotas, carros) e fg (pinos, ambulâncias, seleção) redesenham a cada quadro.
   Todo texto vindo do motor entra no DOM por textContent. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: segue sem lembrar */ } },
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const isNarrow = () => innerWidth <= 760;

/* ------------------------------------------------------------- constantes */
const ROAD_W = 17, UNIT_M = 4, KMH = 40;          // 1 unidade = 4 m; 40 km/h para estimar tempo
const SEV_NAME = ["", "Leve", "Baixa", "Média", "Alta", "Crítica"];
const STATE_TXT = { waiting: "Na fila", assigned: "Ambulância a caminho", transport: "Indo ao hospital" };
const AMB_TXT = { idle: "Livre no hospital", to_scene: "Indo ao chamado", to_hospital: "Levando ao hospital" };

/* ----------------------------------------------------------------- estado */
let MAP = null, S = null, samples = [];
let E = [], cells = [], byName = new Map(), edgeAt = new Map(), nameOrder = new Map();
let level = new Uint8Array(0);                   // 0 livre · 2 lento · 3 intenso (vem do motor)
const view = { k: 1, x: 0, y: 0, fit: 1, touched: false };
const layers = { traffic: true, qt: false, mst: false, comp: false };
let tool = "route", sev = 3, tutorOn = store.get("atlas-tutor") === "1";
let sel = { src: null, dst: null }, route = null;
let hover = null, hiName = null, hiUntil = 0, kbFocus = false;
const carVis = new Map(), ambVis = new Map();
let closedSet = new Set(), lastVersion = -1, tickMs = 300, stateAt = 0;
let staticDirty = true;
let anim = null;                                 // animação da busca (Dijkstra × A*)
let P = {};                                       // paleta do mapa (lida dos tokens CSS)

/* --------------------------------------------------------------- canvases */
const cvs = { bg: $("#bg"), dyn: $("#dyn"), lbl: $("#lbl"), fg: $("#fg") };
const cx = Object.fromEntries(Object.entries(cvs).map(([k, c]) => [k, c.getContext("2d")]));
let CW = 0, CH = 0, DPR = 1;

/* ------------------------------------------------------------------ motor */
let worker = null, host = null, seq = 0;
const pending = new Map();
function onEngine(msg) {
  if (msg.type === "reply") {
    const p = pending.get(msg.id); if (!p) return;
    pending.delete(msg.id);
    msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
  } else if (msg.type === "map") onMap(msg);
  else if (msg.type === "state") onState(msg);
}
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    const msg = { type: "call", id, method, args };
    if (worker) worker.postMessage(msg); else queueMicrotask(() => host(msg));
  });
}
async function startEngine() {
  const booted = await new Promise((resolve) => {
    try {
      const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      const t = setTimeout(() => resolve(null), 4000);
      w.addEventListener("message", function first(ev) {
        if (ev.data && ev.data.type === "boot") { clearTimeout(t); w.removeEventListener("message", first); resolve(w); }
      });
      w.addEventListener("error", (ev) => { ev.preventDefault(); clearTimeout(t); resolve(null); }, { once: true });
    } catch { resolve(null); }
  });
  if (booted) { worker = booted; worker.onmessage = (ev) => onEngine(ev.data); }
  else {   // navegador sem module worker: o mesmo motor roda na página
    const { makeHost } = await import("./engine/host.js");
    host = makeHost((m) => onEngine(m));
  }
  await call("init", { seed: 42, width: 12, height: 8, n_cars: 150, tick_ms: 300 });
}

/* ---------------------------------------------------------------- paleta */
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark" || t === "light") return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function readPalette() {
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue("--" + n).trim();
  P = {};
  for (const n of ["map-land", "map-block", "map-bld", "map-bld-2", "map-park", "map-tree", "map-water", "map-road", "map-casing",
    "map-closed", "map-label", "map-halo", "map-car", "map-car-2", "map-route", "map-route-casing", "map-slow", "map-jam",
    "map-qt", "map-mst", "map-amb", "map-amb-line", "map-hosp", "crit-fill", "accent", "text", "text-2", "text-3", "line",
    "surface", "surface-2", "font", "mono"]) P[n.replace("map-", "")] = g(n);
  for (let i = 1; i <= 5; i++) { P["sev" + i] = g("sev-" + i); P["sevt" + i] = g("sev-" + i + "-t"); }
  staticDirty = true;
}
function applyThemeIcon() {
  const dark = effectiveTheme() === "dark";
  $("#theme-path").setAttribute("d", dark
    ? "M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm-1-5h2v3h-2zm0 17h2v3h-2zM2 11h3v2H2zm17 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1z"
    : "M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z");
  $("#btn-theme").setAttribute("aria-label", dark ? "Mudar para o tema dia" : "Mudar para o tema noite");
}

/* ------------------------------------------------------------- geometria */
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bil(Q, u, v) {
  const a = [Q[0][0] + (Q[1][0] - Q[0][0]) * u, Q[0][1] + (Q[1][1] - Q[0][1]) * u];
  const b = [Q[3][0] + (Q[2][0] - Q[3][0]) * u, Q[3][1] + (Q[2][1] - Q[3][1]) * u];
  return [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v];
}
function prepare() {
  const N = MAP.nodes;
  E = MAP.edges.map((e) => {
    const a = N[e.u], b = N[e.v], dx = b[0] - a[0], dy = b[1] - a[1];
    return { id: e.id, u: e.u, v: e.v, name: e.name, ax: a[0], ay: a[1], bx: b[0], by: b[1],
      len: Math.hypot(dx, dy), ang: Math.atan2(dy, dx), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
  });
  level = new Uint8Array(E.length);
  byName = new Map(); edgeAt = new Map();
  for (const e of E) {
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name).push(e);
    edgeAt.set(e.u + "-" + e.v, e); edgeAt.set(e.v + "-" + e.u, e);
  }
  // prioridade dos rótulos: alterna ruas e avenidas para espalhar pelo mapa
  nameOrder = new Map(); const rows = MAP.rows, cols = MAP.cols;
  for (let i = 0; i < Math.max(rows.length, cols.length); i++) {
    if (i < cols.length) nameOrder.set(cols[i], nameOrder.size);
    if (i < rows.length) nameOrder.set(rows[i], nameOrder.size);
  }
  cells = [];
  const W = MAP.W, H = MAP.H;
  for (let cy = 0; cy < H - 1; cy++) for (let cxx = 0; cxx < W - 1; cxx++) {
    const i = cy * W + cxx, Q0 = [N[i], N[i + 1], N[i + 1 + W], N[i + W]];
    const c = [0, 1].map((k) => Q0.reduce((s, p) => s + p[k], 0) / 4);
    const Q = Q0.map((p) => { const dx = c[0] - p[0], dy = c[1] - p[1], d = Math.hypot(dx, dy) || 1, k = (ROAD_W * 0.8) / d; return [p[0] + dx * k, p[1] + dy * k]; });
    const rng = mulberry(MAP.seed * 131 + cy * 7919 + cxx * 17), r = rng();
    const cell = { Q, type: r < 0.12 ? "park" : r < 0.17 ? "water" : "built", bld: [], trees: [] };
    if (cell.type === "built") {
      const nx = 2 + (rng() < 0.5 ? 1 : 0), ny = 2;
      for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
        if (rng() < 0.16) continue;
        const g = 0.07, u0 = a / nx + g, u1 = (a + 1) / nx - g, v0 = b / ny + g, v1 = (b + 1) / ny - g;
        cell.bld.push({ q: [bil(Q, u0, v0), bil(Q, u1, v0), bil(Q, u1, v1), bil(Q, u0, v1)], tone: rng() < 0.5 ? 0 : 1 });
      }
    } else if (cell.type === "park") {
      for (let t = 0; t < 7; t++) cell.trees.push(bil(Q, 0.15 + rng() * 0.7, 0.15 + rng() * 0.7));
    }
    cells.push(cell);
  }
}

/* ----------------------------------------------------------------- câmera */
const sx = (x) => x * view.k + view.x, sy = (y) => y * view.k + view.y;
function sizeCanvases() {
  const r = cvs.fg.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1); CW = r.width; CH = r.height;
  for (const k in cvs) { cvs[k].width = Math.max(1, Math.round(CW * DPR)); cvs[k].height = Math.max(1, Math.round(CH * DPR)); cx[k].setTransform(DPR, 0, 0, DPR, 0, 0); }
  if (MAP) fitView(false);
  staticDirty = true;
}
function mapInsets() {   // área do mapa que não fica sob os painéis flutuantes
  if (isNarrow()) return { l: 8, r: 8, t: 150, b: (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--peek")) || 148) + 16 };
  return { l: 24, r: 72, t: 24, b: 24 };
}
function fitView(force) {
  const [x0, y0, x1, y1] = MAP.bounds, ins = mapInsets();
  const w = Math.max(100, CW - ins.l - ins.r), hh = Math.max(100, CH - ins.t - ins.b);
  const f = Math.min(w / (x1 - x0), hh / (y1 - y0));
  view.fit = f;
  if (force || !view.touched) {
    // no celular a cidade inteira fica pequena demais para tocar: começa um pouco mais perto
    const k = isNarrow() ? f * 1.4 : f;
    view.k = k; view.x = ins.l + w / 2 - ((x0 + x1) / 2) * k; view.y = ins.t + hh / 2 - ((y0 + y1) / 2) * k;
    if (force) view.touched = false;
  }
  staticDirty = true;
}
function zoomAt(px, py, factor) {
  const k = Math.max(view.fit * 0.6, Math.min(view.fit * 6, view.k * factor)), r = k / view.k;
  view.x = px - (px - view.x) * r; view.y = py - (py - view.y) * r; view.k = k; view.touched = true; staticDirty = true;
}
function panBy(dx, dy) { view.x += dx; view.y += dy; view.touched = true; staticDirty = true; }
function fitTo(x0, y0, x1, y1) {
  const ins = mapInsets(), w = CW - ins.l - ins.r, hh = CH - ins.t - ins.b, pad = 48;
  const k = Math.min((w - pad * 2) / Math.max(40, x1 - x0), (hh - pad * 2) / Math.max(40, y1 - y0), view.fit * 3.5);
  view.k = Math.max(view.fit * 0.8, k);
  view.x = ins.l + w / 2 - ((x0 + x1) / 2) * view.k; view.y = ins.t + hh / 2 - ((y0 + y1) / 2) * view.k;
  view.touched = true; staticDirty = true;
}

/* ------------------------------------------------------- camada estática */
function poly(g, pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(sx(p[0]), sy(p[1])) : g.moveTo(sx(p[0]), sy(p[1])))); g.closePath(); }
function strokeEdges(g, list, width, color, dash) {
  if (!list.length) return;
  g.beginPath();
  for (const e of list) { g.moveTo(sx(e.ax), sy(e.ay)); g.lineTo(sx(e.bx), sy(e.by)); }
  g.lineWidth = width; g.strokeStyle = color; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
}
function drawStatic() {
  staticDirty = false;
  const g = cx.bg, rw = ROAD_W * view.k;
  g.fillStyle = P.land; g.fillRect(0, 0, CW, CH);
  g.lineJoin = "round"; g.lineCap = "round";
  for (const c of cells) {
    const col = c.type === "park" ? P.park : c.type === "water" ? P.water : P.block;
    poly(g, c.Q); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = Math.max(2, 6 * view.k); g.fill(); g.stroke();
    if (c.type === "built") for (const b of c.bld) { poly(g, b.q); g.fillStyle = b.tone ? P["bld-2"] : P.bld; g.fill(); }
    else if (c.type === "park" && view.k > view.fit * 0.9) {
      g.fillStyle = P.tree;
      for (const t of c.trees) { g.beginPath(); g.arc(sx(t[0]), sy(t[1]), 4.5 * view.k, 0, 7); g.fill(); }
    }
  }
  const open = E.filter((e) => !closedSet.has(e.id)), shut = E.filter((e) => closedSet.has(e.id));
  strokeEdges(g, E, rw + Math.max(2, rw * 0.22), P.casing);
  strokeEdges(g, open, rw, P.road);
  strokeEdges(g, shut, rw, P.closed);
  if (layers.mst && S) strokeEdges(g, S.mst.edges.map((id) => E[id]), Math.max(2.5, rw * 0.24), P.mst);
  if (shut.length) strokeEdges(g, shut, Math.max(1.5, rw * 0.16), P["crit-fill"], [6, 6]);

  // camada de rótulos e marcos fixos
  const l = cx.lbl; l.clearRect(0, 0, CW, CH);
  placeLabels(l, open);
  for (const e of shut) drawBarrier(l, sx(e.mx), sy(e.my));
  for (const hn of MAP.hospitals) drawHospital(l, sx(MAP.nodes[hn][0]), sy(MAP.nodes[hn][1]));
  if (layers.comp && S) {
    const pal = [P.accent, "#2f9e6a", "#c77d14", P["crit-fill"], "#8a63d2", "#1597a5"];
    MAP.nodes.forEach((p, i) => {
      l.fillStyle = pal[S.comp[i] % pal.length]; l.strokeStyle = P.surface; l.lineWidth = 2;
      l.beginPath(); l.arc(sx(p[0]), sy(p[1]), 5, 0, 7); l.fill(); l.stroke();
    });
  }
}
/** Rótulos ao longo das ruas sem sobreposição; quantidade cresce com o zoom. */
function placeLabels(g, open) {
  const rw = ROAD_W * view.k, z = view.k / view.fit;
  if (rw < 9) return;
  const fs = z < 1.6 ? 12 : 13;
  g.font = `500 ${fs}px ${P.font}`; g.textAlign = "center"; g.textBaseline = "middle";
  const maxLabels = Math.round(Math.min(70, Math.max(9, 9 * z * z)));
  const spacing = z < 1.5 ? 1e9 : 460 / Math.min(2.2, z / 1.5);  // mesma rua só repete se der para ler
  const cand = [];
  for (const e of open) {
    const px = sx(e.mx), py = sy(e.my);
    if (px < 0 || py < 0 || px > CW || py > CH) continue;
    cand.push(e);
  }
  cand.sort((a, b) => (nameOrder.get(a.name) - nameOrder.get(b.name)) || (b.len - a.len));
  // primeiro um rótulo por rua (na ordem de prioridade), depois repetições
  const firstPass = [], seen = new Set();
  for (const e of cand) { if (!seen.has(e.name)) { seen.add(e.name); firstPass.push(e); } }
  const ordered = firstPass.concat(cand.filter((e) => !firstPass.includes(e)));
  const placed = [], byStreet = new Map(); let count = 0;
  for (const e of ordered) {
    if (count >= maxLabels) break;
    const txt = e.name.replace(/^Rua /, "R. "), tw = g.measureText(txt).width, room = e.len * view.k - rw * 1.2;
    if (tw + 12 > room) continue;
    const px = sx(e.mx), py = sy(e.my);
    const prev = byStreet.get(e.name) || [];
    if (prev.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < spacing)) continue;
    let a = e.ang; if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI;
    const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a)), hw = (tw / 2 + 6) * ca + (fs / 2 + 4) * sa, hh = (tw / 2 + 6) * sa + (fs / 2 + 4) * ca;
    const box = [px - hw, py - hh, px + hw, py + hh];
    if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
    placed.push(box); prev.push([px, py]); byStreet.set(e.name, prev); count++;
    g.save(); g.translate(px, py); g.rotate(a);
    g.lineJoin = "round"; g.lineWidth = 3.5; g.strokeStyle = P.halo; g.strokeText(txt, 0, 0.5);
    g.fillStyle = P.label; g.fillText(txt, 0, 0.5);
    g.restore();
  }
}
function drawBarrier(g, x, y) {
  const r = 8;
  g.fillStyle = P["crit-fill"]; g.strokeStyle = P.surface; g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#ffffff"; g.fillRect(x - 4.5, y - 1.25, 9, 2.5);
}
function drawHospital(g, x, y) {
  const s = 18;
  g.fillStyle = P.hosp; g.strokeStyle = P["crit-fill"]; g.lineWidth = 2;
  g.beginPath(); g.roundRect(x - s / 2, y - s / 2, s, s, 5); g.fill(); g.stroke();
  g.fillStyle = P["crit-fill"]; g.fillRect(x - 1.75, y - 5.5, 3.5, 11); g.fillRect(x - 5.5, y - 1.75, 11, 3.5);
}

/* ------------------------------------------------------- trânsito e carros */
function onState(msg) {
  const prev = S; S = msg.state; tickMs = msg.tickMs || tickMs; stateAt = performance.now();
  const motion = msg.motion;
  if (!MAP) return;
  // nível de trânsito por rua: o mesmo que o motor usa para pesar as rotas
  const tl = S.traffic_levels || [];
  for (let i = 0; i < E.length; i++) level[i] = tl[i] === 2 ? 3 : tl[i] === 1 ? 2 : 0;
  S.cars.forEach(([x, y, id], j) => {
    const a = motion[2 * j + 1];
    let v = carVis.get(id);
    if (!v) { v = { x, y, fx: x, fy: y, tx: x, ty: y, a: Number.isNaN(a) ? 0 : a, ta: a }; carVis.set(id, v); return; }
    v.fx = v.x; v.fy = v.y; v.tx = x; v.ty = y; if (!Number.isNaN(a)) v.ta = a;
    if (Math.hypot(x - v.x, y - v.y) > 140) { v.x = v.fx = x; v.y = v.fy = y; }
  });
  for (const a of S.ambulances) {
    let v = ambVis.get(a.id);
    if (!v) { ambVis.set(a.id, { x: a.x, y: a.y, fx: a.x, fy: a.y, tx: a.x, ty: a.y, a: 0, ta: 0 }); continue; }
    v.fx = v.x; v.fy = v.y; v.tx = a.x; v.ty = a.y;
    if (Math.hypot(a.x - v.fx, a.y - v.fy) > 0.5) v.ta = Math.atan2(a.y - v.fy, a.x - v.fx);
  }
  if (S.version !== lastVersion || !prev || prev.closed.length !== S.closed.length) {
    const changed = prev && S.version !== lastVersion;
    lastVersion = S.version; closedSet = new Set(S.closed); staticDirty = true;
    if (changed) followTraffic();
  }
  $("#traffic-routing").checked = !!S.traffic_routing;
  updatePanels();
}
function stepVehicles(store2, dt) {
  const alpha = Math.min(1, (performance.now() - stateAt) / Math.max(60, tickMs));
  const turn = Math.min(1, dt / 140);
  for (const v of store2.values()) {
    v.x = v.fx + (v.tx - v.fx) * alpha; v.y = v.fy + (v.ty - v.fy) * alpha;
    let da = v.ta - v.a; da = Math.atan2(Math.sin(da), Math.cos(da)); v.a += da * turn;
  }
}
function drawCar(g, x, y, a, len, col) {
  const w = len * 0.5, c = Math.cos(a), s = Math.sin(a);
  g.setTransform(c * DPR, s * DPR, -s * DPR, c * DPR, x * DPR, y * DPR);
  g.fillStyle = col; g.beginPath(); g.roundRect(-len / 2, -w / 2, len, w, w * 0.45); g.fill();
}
function drawAmbulance(g, x, y, a, t, busy) {
  const len = 18, w = 9;
  if (busy && !reduceMotion.matches) {   // halo suave em serviço; sem pisca-pisca
    const p = (t / 1400) % 1;
    g.globalAlpha = 0.35 * (1 - p); g.strokeStyle = P["crit-fill"]; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 10 + p * 14, 0, 7); g.stroke(); g.globalAlpha = 1;
  }
  const c = Math.cos(a), s = Math.sin(a);
  g.setTransform(c * DPR, s * DPR, -s * DPR, c * DPR, x * DPR, y * DPR);
  g.fillStyle = P.amb; g.strokeStyle = P["amb-line"]; g.lineWidth = 1.2;
  g.beginPath(); g.roundRect(-len / 2, -w / 2, len, w, 3); g.fill(); g.stroke();
  g.fillStyle = P["crit-fill"]; g.fillRect(-1, -3, 2.5, 6); g.fillRect(-3, -1, 6.5, 2);
  if (busy) { g.fillStyle = P.accent; g.fillRect(len / 2 - 4, -w / 2 + 1, 2.5, w - 2); }
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
}
function drawPin(g, x, y, sevN, t, waiting) {
  if (waiting && !reduceMotion.matches) {
    const p = (t / 1600) % 1;
    g.globalAlpha = 0.45 * (1 - p); g.strokeStyle = P["sev" + sevN]; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 6 + p * 18, 0, 7); g.stroke(); g.globalAlpha = 1;
  }
  const r = 11;
  g.save(); g.translate(x, y);
  g.fillStyle = "rgba(0,0,0,.18)"; g.beginPath(); g.ellipse(0, 1, 5, 2.2, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(0, 0);
  g.bezierCurveTo(-r * 0.25, -r * 0.7, -r, -r * 1.05, -r, -r * 1.85);
  g.arc(0, -r * 1.85, r, Math.PI, 0);
  g.bezierCurveTo(r, -r * 1.05, r * 0.25, -r * 0.7, 0, 0);
  g.fillStyle = P["sev" + sevN]; g.fill(); g.strokeStyle = P.surface; g.lineWidth = 2; g.stroke();
  g.fillStyle = P["sevt" + sevN]; g.font = `600 12px ${P.font}`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(sevN), 0, -r * 1.85 + 0.5);
  g.restore();
}
function drawPolyline(g, nodes, startXY) {
  const N = MAP.nodes; g.beginPath();
  if (startXY) g.moveTo(sx(startXY[0]), sy(startXY[1]));
  nodes.forEach((n, i) => (i || startXY ? g.lineTo(sx(N[n][0]), sy(N[n][1])) : g.moveTo(sx(N[n][0]), sy(N[n][1]))));
}

let lastT = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, t - lastT); lastT = t;
  if (!MAP) return;
  if (staticDirty) drawStatic();
  const d = cx.dyn, f = cx.fg, rw = ROAD_W * view.k, motion = !reduceMotion.matches;
  d.setTransform(DPR, 0, 0, DPR, 0, 0); d.clearRect(0, 0, CW, CH);
  f.setTransform(DPR, 0, 0, DPR, 0, 0); f.clearRect(0, 0, CW, CH);
  d.lineCap = "round"; d.lineJoin = "round";

  if (layers.traffic && S) {
    const slow = [], jam = [];
    for (let i = 0; i < E.length; i++) { if (closedSet.has(i)) continue; if (level[i] === 2) slow.push(E[i]); else if (level[i] === 3) jam.push(E[i]); }
    strokeEdges(d, slow, Math.max(3, rw * 0.42), P.slow);
    strokeEdges(d, jam, Math.max(3, rw * 0.42), P.jam);
  }
  if (hiName && t < hiUntil && byName.has(hiName)) {
    d.globalAlpha = motion ? 0.35 + 0.25 * Math.sin(t / 220) : 0.45;
    strokeEdges(d, byName.get(hiName), rw * 1.1, P.route); d.globalAlpha = 1;
  }
  if (layers.qt && S) {
    d.strokeStyle = P.qt; d.lineWidth = 1;
    for (const [x0, y0, x1, y1] of S.quadtree) d.strokeRect(sx(x0), sy(y0), (x1 - x0) * view.k, (y1 - y0) * view.k);
  }
  const animDone = !anim || (t - anim.t0) >= anim.total;
  if (route && route.found && animDone && route.free_path && route.free_path.join() !== route.path.join()) {
    drawPolyline(d, route.free_path);
    d.strokeStyle = P["text-3"]; d.lineWidth = Math.max(3, rw * 0.28); d.setLineDash([6, 8]); d.stroke(); d.setLineDash([]);
  }
  if (route && route.found && animDone) {
    drawPolyline(d, route.path);
    d.strokeStyle = P["route-casing"]; d.lineWidth = Math.max(7, rw * 0.6) + 3; d.stroke();
    d.strokeStyle = P.route; d.lineWidth = Math.max(7, rw * 0.6); d.stroke();
  }
  if (S) {
    for (const a of S.ambulances) {   // vermelho: indo ao chamado; azul: indo ao hospital
      if (a.state === "idle" || !a.route.length) continue;
      const v = ambVis.get(a.id) || a;
      drawPolyline(d, a.route, [v.x, v.y]);
      d.strokeStyle = P["route-casing"]; d.lineWidth = 6; d.stroke();
      d.strokeStyle = a.state === "to_scene" ? P["crit-fill"] : P.accent; d.lineWidth = 3.5;
      d.setLineDash([9, 7]); d.lineDashOffset = motion ? -t / 50 : 0; d.stroke(); d.setLineDash([]); d.lineDashOffset = 0;
    }
    stepVehicles(carVis, dt); stepVehicles(ambVis, dt);
    const clen = Math.max(7, Math.min(14, 10 * view.k + 2));
    for (const [, , id] of S.cars) { const v = carVis.get(id); if (v) drawCar(d, sx(v.x), sy(v.y), v.a, clen, id % 3 ? P.car : P["car-2"]); }
    d.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // camada de cima: seleção, pinos, ambulâncias
  if (hover) {
    if (hover.type === "node") {
      const p = MAP.nodes[hover.id];
      f.strokeStyle = P.accent; f.lineWidth = 2.5; f.beginPath(); f.arc(sx(p[0]), sy(p[1]), 12, 0, 7); f.stroke();
    } else {
      const e = E[hover.id]; f.globalAlpha = 0.35; strokeEdges(f, [e], rw * 1.15, closedSet.has(e.id) ? P.accent : P["crit-fill"]); f.globalAlpha = 1;
    }
  }
  if (anim) {
    const el = t - anim.t0, end = anim.total + anim.hold + anim.fade;
    if (el > end) { anim = null; updateAnimCard(Infinity); if (pendingFollow) followTraffic(); }
    else { const k = Math.floor(el / anim.dt) + 1; drawSearch(f, k, el); updateAnimCard(k); }
  }
  if (sel.src !== null) {
    const p = MAP.nodes[sel.src];
    f.fillStyle = P.surface; f.strokeStyle = P.route; f.lineWidth = 4;
    f.beginPath(); f.arc(sx(p[0]), sy(p[1]), 7, 0, 7); f.fill(); f.stroke();
  }
  if (route && route.found && animDone) {
    const p = MAP.nodes[route.dst], x = sx(p[0]), y = sy(p[1]);
    f.fillStyle = P.route; f.strokeStyle = P.surface; f.lineWidth = 3;
    f.beginPath(); f.arc(x, y, 8, 0, 7); f.fill(); f.stroke();
  }
  if (S) {
    for (const e of S.emergencies) { const p = MAP.nodes[e.node]; drawPin(f, sx(p[0]), sy(p[1]), e.severity, t + e.id * 400, e.state === "waiting"); }
    for (const a of S.ambulances) { const v = ambVis.get(a.id); if (v) drawAmbulance(f, sx(v.x), sy(v.y), v.a, t, a.state !== "idle"); }
  }
  if (kbFocus) {   // mira do teclado: Enter clica no centro
    const x = CW / 2, y = CH / 2; f.strokeStyle = P.accent; f.lineWidth = 2;
    f.beginPath(); f.moveTo(x - 10, y); f.lineTo(x - 4, y); f.moveTo(x + 4, y); f.lineTo(x + 10, y);
    f.moveTo(x, y - 10); f.lineTo(x, y - 4); f.moveTo(x, y + 4); f.lineTo(x, y + 10); f.stroke();
  }
}

/* ------------------------------------------------ animação Dijkstra × A* */
/** Busca a ordem de visita no motor e anima: anéis = Dijkstra, pontos = A*. */
async function startSearchAnim() {
  if (!route || !route.found) { anim = null; return; }
  const tr = await call("trace", { src: route.src, dst: route.dst });
  const n = Math.max(tr.dijkstra.length, tr.astar.length);
  const dt = Math.max(14, Math.min(70, 2600 / n));
  anim = { d: tr.dijkstra, a: tr.astar, n, dt, t0: performance.now(), total: n * dt, hold: 2400, fade: 900, k: -1 };
  if (reduceMotion.matches) { anim.t0 -= anim.total; anim.fade = 0; anim.hold = 3500; }   // sem movimento: mostra o resultado final parado
  say("Dijkstra × A*", `Anéis cinza: cruzamentos que o Dijkstra fechou, sempre o mais próximo da origem primeiro, então a busca cresce em círculo (${tr.dijkstra.length} nós). Pontos azuis: o A* soma a distância em linha reta até o destino e por isso avança direto para ele (${tr.astar.length} nós). Os dois acham o mesmo caminho.`);
}
function drawSearch(g, k, el) {
  const fadeStart = anim.total + anim.hold;
  g.globalAlpha = el > fadeStart ? Math.max(0, 1 - (el - fadeStart) / Math.max(1, anim.fade)) : 1;
  const N = MAP.nodes, kd = Math.min(k, anim.d.length), ka = Math.min(k, anim.a.length);
  g.beginPath();
  for (let i = 0; i < kd; i++) { const p = N[anim.d[i]], x = sx(p[0]), y = sy(p[1]); g.moveTo(x + 6.5, y); g.arc(x, y, 6.5, 0, 7); }
  g.strokeStyle = P["text-3"]; g.lineWidth = 2; g.stroke();
  g.beginPath();
  for (let i = 0; i < ka; i++) { const p = N[anim.a[i]], x = sx(p[0]), y = sy(p[1]); g.moveTo(x + 3.5, y); g.arc(x, y, 3.5, 0, 7); }
  g.fillStyle = P.accent; g.fill();
  // a "frente" de cada busca: o nó que acabou de ser fechado
  for (const [list, kk, col] of [[anim.d, kd, P["text-3"]], [anim.a, ka, P.accent]]) {
    if (kk < 1 || kk >= list.length) continue;
    const p = N[list[kk - 1]]; g.strokeStyle = col; g.lineWidth = 2.5;
    g.beginPath(); g.arc(sx(p[0]), sy(p[1]), 11, 0, 7); g.stroke();
  }
  g.globalAlpha = 1;
}
/** Barras e contadores do cartão crescem junto com a animação. */
function updateAnimCard(k) {
  if (!route || !route.found) return;
  const card = $("#routecard"); if (card.hidden) return;
  const dN = route.dijkstra_settled, aN = route.astar_expanded, mx = Math.max(dN, aN, 1);
  const kk = anim ? Math.min(k, anim.n) : Infinity;
  if (anim && anim.k === kk) return;
  if (anim) anim.k = kk;
  const bd = card.querySelector(".bar-d"), ba = card.querySelector(".bar-a");
  if (!bd) return;
  const cd = Math.min(kk, dN), ca = Math.min(kk, aN);
  bd.style.width = (cd / mx) * 100 + "%"; ba.style.width = (ca / mx) * 100 + "%";
  card.querySelector(".cnt-d").textContent = cd + " nós"; card.querySelector(".cnt-a").textContent = ca + " nós";
}

/* ----------------------------------------------------------------- painéis */
function setKids(el, kids) { el.replaceChildren(...kids); }
function streetsAt(n) { const x = n % MAP.W, y = Math.floor(n / MAP.W); return MAP.rows[y] + " com " + MAP.cols[x]; }
function clockText(tick) {
  const s = 7 * 3600 + 30 * 60 + tick * 10, hh = Math.floor(s / 3600) % 24, mm = Math.floor((s % 3600) / 60);
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
const minutes = (ticks) => Math.max(1, Math.round((ticks * 10) / 60));
function kpi(label, value, cls) { return h("div", { class: "kpi " + (cls || "") }, h("b", {}, value), h("span", {}, label)); }
function srow(name, role, val) { return h("div", { class: "srow" }, h("b", {}, name), h("code", {}, val), h("small", {}, role)); }

let lastPanelKey = "";
function updatePanels() {
  $("#tick").textContent = "tick " + S.tick;
  $("#clock").textContent = clockText(S.tick);
  $("#btn-undo").disabled = S.undo === 0; $("#btn-redo").disabled = S.redo === 0;
  $("#pause-path").setAttribute("d", S.paused ? "M8 5v14l11-7z" : "M7 5h3v14H7zm7 0h3v14h-3z");
  $("#btn-pause").setAttribute("aria-label", S.paused ? "Continuar simulação" : "Pausar simulação");
  const st = S.stats, busy = S.emergencies.filter((e) => e.state !== "waiting").length;
  const cnt = $("#calls-count"); cnt.hidden = !S.emergencies.length; cnt.textContent = S.emergencies.length;

  const key = [st.waiting, busy, st.resolved, S.closed.length, S.ncomp, st.avg_response_ticks].join();
  if (key !== lastPanelKey) {
    lastPanelKey = key;
    setKids($("#kpis"), [
      kpi("aguardando ambulância", st.waiting, st.waiting ? "warn" : ""),
      kpi("em atendimento", busy),
      kpi("atendidos", st.resolved, st.resolved ? "good" : ""),
      kpi(S.ncomp > 1 ? `vias fechadas · ${S.ncomp - 1} área isolada` : "vias fechadas", S.closed.length, S.ncomp > 1 ? "crit" : S.closed.length ? "warn" : ""),
      kpi("tempo médio até o local", st.avg_response_ticks == null ? "–" : `${minutes(st.avg_response_ticks)} min`),
      kpi("passagens na última hora (simulada)", S.traffic.last60.toLocaleString("pt-BR")),
    ]);
  }
  setKids($("#log"), S.log.slice(0, 7).map((line) => {
    const m = /^t(\d+)\s+(.*)$/.exec(line);
    return h("li", {}, h("time", {}, m ? clockText(+m[1]) : ""), h("span", {}, m ? humanLog(m[2]) : line));
  }));
  const l = S.lru;
  setKids($("#structs"), [
    srow("Grafo + Union-Find", "ilhas: partes da cidade sem ligação entre si", S.ncomp + (S.ncomp > 1 ? " ilhas" : " ilha")),
    srow("Kruskal", "rede mínima que liga a cidade", S.mst.total.toLocaleString("pt-BR")),
    srow("Heap binária", "fila de chamados por gravidade", st.waiting + " na fila"),
    srow("Quadtree", "acha ambulância e carros próximos", S.quadtree.length + " regiões"),
    srow("KD-Tree", "acha o hospital mais próximo", MAP.hospitals.length + " hospitais"),
    srow("Cache LRU", "rotas recentes (lista dupla + hash)", Math.round(l.hit_rate * 100) + "% acertos"),
    srow("Pilha", "desfazer / refazer", S.undo + " / " + S.redo),
    srow("Segment Tree", `passagens nos últimos 60 ticks · pico ${S.traffic.peak60}`, String(S.traffic.last60)),
    srow("Fenwick Tree", "total de atendimentos", String(S.traffic.resolved_total)),
    srow("Pesos dinâmicos", S.traffic_routing ? "ruas lentas custam ×1,6 e intensas ×2,5 no Dijkstra" : "desligado: rotas ignoram o trânsito",
      `${S.traffic_levels.filter((x) => x).length} ruas com trânsito`),
    srow("Count-Min Sketch", S.hot_roads.length ? "rua mais usada: " + S.hot_roads[0].street : "ruas mais usadas", S.hot_roads.length ? "~" + S.hot_roads[0].count : "–"),
    srow("AVL", `moradores · ${S.avl.rotations.toLocaleString("pt-BR")} rotações`, `${S.avl.size} · altura ${S.avl.height}`),
    srow("Bloom Filter", `${S.bloom.skips} buscas evitadas`, (S.bloom.est_fp * 100).toFixed(2).replace(".", ",") + "% falso positivo"),
    srow("Trie + Levenshtein", "busca de ruas", S.trie.nodes + " nós"),
    srow("Huffman", "compressão do registro de eventos", Math.round(S.huffman.ratio * 100) + "% do tamanho"),
  ]);
  const STEP = ["Na fila", "A caminho", "Ao hospital", "Concluído"], IDX = { waiting: 0, assigned: 1, transport: 2 };
  setKids($("#calls"), S.emergencies.length ? S.emergencies.map((e) => {
    const at = IDX[e.state] ?? 0;
    return h("div", { class: "item" },
      h("div", { class: "top" },
        h("span", { class: "badge", style: `background:var(--sev-${e.severity});color:var(--sev-${e.severity}-t)`, "aria-label": "gravidade " + e.severity }, e.severity),
        h("span", { class: "t" }, `#${e.id} · ${streetsAt(e.node)}`),
        h("span", { class: "s" }, SEV_NAME[e.severity])),
      h("div", { class: "steps", "aria-label": "Situação: " + STATE_TXT[e.state] }, STEP.map((t2, i) => h("span", { class: i < at ? "done" : i === at ? "now" : "" }, t2))));
  }) : [h("p", { class: "empty" }, "Nenhum chamado ativo. Use a ferramenta Chamado ou o botão acima.")]);
  setKids($("#ambs"), S.ambulances.map((a) => h("div", { class: "item" }, h("div", { class: "top" },
    h("span", { class: "badge " + (a.state === "idle" ? "idle" : "busy") }, a.id + 1),
    h("span", { class: "t" }, "Ambulância " + (a.id + 1)),
    h("span", { class: "s" }, AMB_TXT[a.state] + (a.eid ? ` · #${a.eid}` : ""))))));
  $("#lru-info").textContent = `${l.size} de ${l.capacity} rotas guardadas · ${l.hits.toLocaleString("pt-BR")} acertos · ${l.misses.toLocaleString("pt-BR")} erros · ${l.evictions} expulsões. A primeira é a mais recente.` +
    (S.traffic_routing ? " Com as rotas reagindo ao trânsito, a malha muda de versão a cada 10 ticks e as rotas antigas deixam de valer: por isso há poucos acertos." : "");
  setKids($("#lru-list"), l.keys.slice(0, 8).map((k) => h("li", {}, k)));
  if ($("#heap-block").open && !$("#tab-chamados").hidden) drawHeap();
}
function humanLog(s) {
  return s.replace(/no nó (\d+)/, (_, n) => "em " + streetsAt(+n))
    .replace(/^Ambulância (\d+) -> chamado/, (_, n) => `Ambulância ${+n + 1} a caminho do chamado`)
    .replace(/\(ambulância (\d+)\)/, (_, n) => `(ambulância ${+n + 1})`)
    .replace(/ \((\d+)-(\d+)\)/, "").replace(" | ilhas:", " · ilhas:");
}
function drawHeap() {
  const c = $("#heap"), w = c.clientWidth, hh = S.heap.length ? 152 : 40;
  if (!w) return;
  c.style.height = hh + "px"; c.width = w * DPR; c.height = hh * DPR;
  const g = c.getContext("2d"); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const arr = S.heap.slice(0, 31);
  const pos = (i) => { const lv = Math.floor(Math.log2(i + 1)), idx = i + 1 - (1 << lv); return [((idx + 0.5) / (1 << lv)) * w, 18 + lv * 32]; };
  g.strokeStyle = P.line; g.lineWidth = 2;
  arr.forEach((_, i) => { if (!i) return; const [x, y] = pos(i), [px, py] = pos((i - 1) >> 1); g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); });
  arr.forEach((it, i) => {
    const [x, y] = pos(i);
    g.fillStyle = P["sev" + it.severity]; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill();
    if (i === 0) { g.strokeStyle = P.text; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = P["sevt" + it.severity]; g.font = `600 12px ${P.font}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(it.severity), x, y + 0.5);
  });
  if (!arr.length) { g.fillStyle = P["text-2"]; g.font = `13px ${P.font}`; g.textAlign = "center"; g.fillText("Heap vazia: nenhum chamado esperando", w / 2, hh / 2); }
  $("#heap-info").textContent = S.heap.length
    ? "O nó com contorno é o topo: o próximo a ser despachado. Ordem no array: " + S.heap.map((x) => `#${x.id}(g${x.severity})`).join(", ")
    : "Inserir e remover custam O(log n); o topo é sempre o chamado mais grave.";
}

/* --------------------------------------------------------------- tutor */
function say(ds, msg) {
  if (!tutorOn) return;
  $("#tutor-ds").textContent = ds || ""; $("#tutor-text").textContent = msg;
}
function applyTutor() {
  $("#tutor").hidden = !tutorOn; $("#btn-tutor").setAttribute("aria-pressed", String(tutorOn));
  store.set("atlas-tutor", tutorOn ? "1" : "0");
}
let hintTimer = null;
function hint(msg, err) {
  const el = $("#hint"); el.textContent = msg; el.classList.toggle("err", !!err);
  clearTimeout(hintTimer); hintTimer = setTimeout(refreshHint, err ? 6000 : 5000);
}
function refreshHint() {
  const el = $("#hint"); el.classList.remove("err");
  if (route) { el.textContent = ""; return; }
  el.textContent = tool === "route" ? (sel.src === null ? "Clique num cruzamento para escolher a origem" : "Agora clique no destino")
    : tool === "call" ? `Clique onde a ambulância deve ir · gravidade ${SEV_NAME[sev].toLowerCase()}`
      : "Clique numa rua para fechar. Clique de novo para reabrir";
}

/* ----------------------------------------------------------------- rota */
function routeDistM(path) {
  let m = 0;
  for (let i = 0; i + 1 < path.length; i++) { const e = edgeAt.get(path[i] + "-" + path[i + 1]); if (e) m += e.len * UNIT_M; }
  return m;
}
function showRoute() {
  const card = $("#routecard"), det = $("#route-detail");
  if (!route) {
    card.hidden = true;
    det.textContent = sel.src === null ? "Use a ferramenta Rota e clique em dois cruzamentos." : "Origem escolhida. Clique no destino.";
    refreshHint(); return;
  }
  card.hidden = false; $("#hint").textContent = "";
  const close = h("button", { type: "button", class: "icon-btn sm close", "aria-label": "Fechar rota", onclick: clearRoute },
    svgIcon("m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"));
  if (!route.found) {
    setKids(card, [close, h("div", { class: "big" }, h("b", { style: "color:var(--crit)" }, "Sem caminho")),
      h("p", { class: "via" }, "Esses dois pontos estão em ilhas diferentes. Reabra uma rua ou use Desfazer.")]);
    det.textContent = "Sem caminho entre os pontos escolhidos."; return;
  }
  const dist = routeDistM(route.path), min = Math.max(1, Math.round((route.cost * UNIT_M) / (KMH * 1000 / 60)));
  const km = dist >= 1000 ? (dist / 1000).toFixed(1).replace(".", ",") + " km" : Math.round(dist) + " m";
  const mx = Math.max(route.dijkstra_settled, route.astar_expanded, 1);
  const cmp = () => h("div", { class: "cmp" },
    h("span", {}, h("i", { class: "sw-d", "aria-hidden": "true" }), "Dijkstra"), h("div", { class: "bar" }, h("i", { class: "bar-d", style: `width:${(route.dijkstra_settled / mx) * 100}%` })), h("b", { class: "cnt-d" }, route.dijkstra_settled + " nós"),
    h("span", {}, h("i", { class: "sw-a", "aria-hidden": "true" }), "A*"), h("div", { class: "bar alt" }, h("i", { class: "bar-a", style: `width:${(route.astar_expanded / mx) * 100}%` })), h("b", { class: "cnt-a" }, route.astar_expanded + " nós"));
  const via = route.streets.slice(0, 3).join(", ") + (route.streets.length > 3 ? "…" : "");
  const toMin = (c) => Math.max(1, Math.round((c * UNIT_M) / (KMH * 1000 / 60)));
  const detour = route.free_path && route.free_path.join() !== route.path.join();
  const saved = detour ? toMin(route.free_cost_now) - min : 0, delay = route.free_cost != null ? min - toMin(route.free_cost) : 0;
  const traffic = !S || !S.traffic_routing ? h("p", { class: "traffic-note" }, "Rotas ignorando o trânsito (ligue em Camadas).")
    : detour ? h("p", { class: "traffic-note detour" }, h("i", { class: "sw-free", "aria-hidden": "true" }),
      saved > 0 ? `Desviou do trânsito: pelo caminho mais curto levaria ${toMin(route.free_cost_now)} min.` : "Desviou do trânsito por um caminho de tempo parecido.")
      : delay > 0 ? h("p", { class: "traffic-note" }, `Trânsito no caminho: +${delay} min. Não há desvio mais rápido.`)
        : h("p", { class: "traffic-note" }, "Caminho livre de trânsito.");
  setKids(card, [close, h("div", { class: "big" }, h("b", {}, min + " min"), h("span", {}, km)),
    h("p", { class: "via" }, via ? "via " + via : "mesmo cruzamento"), traffic, cmp(),
    h("button", { type: "button", class: "link-btn", onclick: () => startSearchAnim().catch((e) => hint(e.message, true)) }, "Ver a busca de novo")]);
  const save = route.dijkstra_settled ? Math.round((1 - route.astar_expanded / route.dijkstra_settled) * 100) : 0;
  setKids(det, [h("p", {}, `Custo ${route.cost.toLocaleString("pt-BR")} · ${route.path.length - 1} trechos · ${km}. Estava no cache LRU antes? ${route.cached_before ? "Sim" : "Não"}.`),
    cmp(), h("p", { class: "muted" }, `O A* chegou ao mesmo custo visitando ${save}% menos nós, guiado pela distância em linha reta até o destino.`)]);
  if (!routeAnimating) say("Dijkstra · A* · LRU", `O Dijkstra usa uma heap para sempre fechar o cruzamento mais próximo (${route.dijkstra_settled} nós). O A* soma a distância em linha reta e visitou só ${route.astar_expanded}, com o mesmo custo. A rota foi para o cache LRU: repetir a consulta custa O(1).`);
}
let routeAnimating = false;
let following = false, pendingFollow = false;
/** Quando o trânsito (ou uma via) muda a malha, recalcula a rota mostrada, sem animar. */
async function followTraffic() {
  if (!route || !route.found || sel.dst === null) return;
  // durante a busca animada a rota ainda nem apareceu: aplica quando a animação acabar
  if (following || (anim && performance.now() - anim.t0 < anim.total)) { pendingFollow = true; return; }
  pendingFollow = false;
  following = true;
  try {
    const before = route.path.join();
    routeAnimating = true;
    route = await call("route", { src: sel.src, dst: sel.dst });
    routeAnimating = false;
    showRoute();
    if (route.found && route.path.join() !== before) {
      hint("O trânsito mudou e a rota foi recalculada.");
      say("Pesos dinâmicos · Dijkstra", "A cada 10 ticks o motor mede a ocupação de cada rua. Rua lenta passa a custar 1,6× e intensa 2,5× no grafo; a versão da malha sobe, o cache LRU descarta as rotas antigas e o Dijkstra acha outro caminho. Os carros fazem o mesmo no próximo cruzamento.");
    }
  } catch { /* a próxima mudança tenta de novo */ } finally { following = false; routeAnimating = false; if (pendingFollow) followTraffic(); }
}
function clearRoute() { route = null; anim = null; sel = { src: null, dst: null }; showRoute(); }
async function refreshRoute() {
  if (sel.src !== null && sel.dst !== null) { route = await call("route", { src: sel.src, dst: sel.dst }); showRoute(); }
}
function svgIcon(d) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ico"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.append(p); return s;
}

/* ------------------------------------------------------------ interação */
function nearestNode(px, py, maxd) {
  let best = null, bd = maxd * maxd;
  MAP.nodes.forEach((p, i) => { const d = (sx(p[0]) - px) ** 2 + (sy(p[1]) - py) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
function nearestEdge(px, py, maxd) {
  let best = null, bd = maxd;
  for (const e of E) {
    const ax = sx(e.ax), ay = sy(e.ay), dx = sx(e.bx) - ax, dy = sy(e.by) - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < bd) { bd = d; best = e.id; }
  }
  return best;
}
async function onMapClick(px, py, coarse) {
  try {
    if (tool === "route") {
      const n = nearestNode(px, py, coarse ? 30 : 22); if (n === null) return;
      if (sel.src === null || sel.dst !== null) { sel = { src: n, dst: null }; route = null; anim = null; showRoute(); }
      else { sel.dst = n; routeAnimating = true; await refreshRoute(); routeAnimating = false; await startSearchAnim(); updateAnimCard(0); }
    } else if (tool === "call") {
      const n = nearestNode(px, py, coarse ? 32 : 24); if (n === null) return;
      const r = await call("emergency", { node: n, severity: sev });
      hint(`Chamado #${r.id} criado em ${streetsAt(n)}. Acompanhe na aba Chamados.`);
      say("Heap binária · Quadtree · Dijkstra", `O chamado de gravidade ${sev} entrou na heap em O(log n). Quando houver ambulância livre, a quadtree sugere as 3 mais próximas e o Dijkstra escolhe a de menor tempo real de rota.`);
    } else {
      const id = nearestEdge(px, py, coarse ? 20 : 14); if (id === null) return;
      const e = E[id], was = closedSet.has(id);
      await call(was ? "open" : "close", { u: e.u, v: e.v });
      hint(e.name + (was ? " reaberta." : " fechada. As rotas vão se adaptar."));
      say("Union-Find · Pilha · LRU", was
        ? `${e.name} reaberta. O Union-Find recalculou as ilhas e a ação foi para a pilha de desfazer.`
        : `${e.name} fechada. O Union-Find recalculou as ilhas, a versão da malha subiu (as rotas antigas do cache LRU deixam de valer) e a ação foi para a pilha de desfazer.`);
      await refreshRoute();
    }
  } catch (err) { hint(err.message, true); }
}

const pointers = new Map(); let drag = null, pinch = null;
const fg = cvs.fg;
const local = (ev) => { const r = fg.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
fg.addEventListener("pointerdown", (ev) => {
  fg.setPointerCapture(ev.pointerId); pointers.set(ev.pointerId, local(ev));
  if (pointers.size === 1) drag = { x: ev.clientX, y: ev.clientY, moved: false, coarse: ev.pointerType !== "mouse" };
  else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 }; drag = null; }
});
fg.addEventListener("pointermove", (ev) => {
  const [px, py] = local(ev);
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [px, py]);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    panBy(mx - pinch.cx, my - pinch.cy); zoomAt(mx, my, d / pinch.d); pinch = { d, cx: mx, cy: my }; hideTip(); return;
  }
  if (drag) {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (drag.moved || Math.hypot(dx, dy) > 6) { drag.moved = true; panBy(dx, dy); drag.x = ev.clientX; drag.y = ev.clientY; fg.classList.add("dragging"); hideTip(); return; }
  }
  if (!MAP || ev.pointerType !== "mouse") return;
  let tip = null;
  if (tool === "road") {
    const id = nearestEdge(px, py, 14); hover = id === null ? null : { type: "edge", id };
    if (id !== null) tip = E[id].name + (closedSet.has(id) ? " · fechada, clique para reabrir" : level[id] === 3 ? " · trânsito intenso" : level[id] === 2 ? " · trânsito lento" : "");
  } else {
    const n = nearestNode(px, py, 22); hover = n === null ? null : { type: "node", id: n };
    if (n !== null) tip = streetsAt(n) + (MAP.hospitals.includes(n) ? " · hospital" : "");
  }
  tip ? showTip(tip, px, py) : hideTip();
});
function endPointer(ev) {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  fg.classList.remove("dragging");
  const was = drag; drag = null;
  if (ev.type === "pointerup" && was && !was.moved) { const [px, py] = local(ev); onMapClick(px, py, was.coarse); }
}
fg.addEventListener("pointerup", endPointer);
fg.addEventListener("pointercancel", endPointer);
fg.addEventListener("pointerleave", () => { hover = null; hideTip(); });
fg.addEventListener("wheel", (ev) => { ev.preventDefault(); const [px, py] = local(ev); zoomAt(px, py, Math.exp(-ev.deltaY * 0.0015)); }, { passive: false });
fg.addEventListener("focus", () => { kbFocus = fg.matches(":focus-visible"); });
fg.addEventListener("blur", () => { kbFocus = false; });
fg.addEventListener("keydown", (ev) => {
  const step = 60, k = ev.key;
  if (k === "ArrowLeft") panBy(step, 0); else if (k === "ArrowRight") panBy(-step, 0);
  else if (k === "ArrowUp") panBy(0, step); else if (k === "ArrowDown") panBy(0, -step);
  else if (k === "+" || k === "=") zoomAt(CW / 2, CH / 2, 1.3); else if (k === "-") zoomAt(CW / 2, CH / 2, 1 / 1.3);
  else if (k === "0") fitView(true);
  else if (k === "Enter" || k === " ") onMapClick(CW / 2, CH / 2, true);
  else if (k === "Escape") clearRoute();
  else return;
  kbFocus = true; ev.preventDefault();
});
function showTip(text, px, py) {
  const t = $("#tip"); t.textContent = text; t.hidden = false;
  const w = t.offsetWidth; t.style.left = Math.max(8, Math.min(px + 14, CW - w - 8)) + "px"; t.style.top = Math.min(py + 18, CH - 40) + "px";
}
function hideTip() { $("#tip").hidden = true; }

/* ferramentas */
function setTool(name) {
  tool = name; hover = null;
  $$("[data-tool]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.tool === name)));
  $("#sevbar").hidden = tool !== "call";
  fg.className = "tool-" + tool;
  if (tool !== "route") { route = null; sel = { src: null, dst: null }; $("#routecard").hidden = true; }
  refreshHint();
}
$$("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
radioKeys($("#tools"), "[data-tool]");
$$("[data-sev]").forEach((b) => b.addEventListener("click", () => {
  sev = +b.dataset.sev; $$("[data-sev]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  $("#sev-name").textContent = SEV_NAME[sev]; refreshHint();
}));
radioKeys($(".sev"), "[data-sev]");
function radioKeys(group, sel2) {   // setas movem entre opções de um grupo de rádio
  group.addEventListener("keydown", (ev) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
    const items = [...group.querySelectorAll(sel2)], i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const n = items[(i + (ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    n.focus(); n.click(); ev.preventDefault();
  });
}

/* camadas */
const LAYER_TXT = {
  traffic: ["Count-Min Sketch · Heap", "A cor vem da densidade de carros em cada trecho. Um Count-Min Sketch conta as passagens em memória fixa e uma heap de tamanho 5 guarda as ruas mais usadas."],
  qt: ["Quadtree", "A quadtree divide o mapa onde há muitos carros. Achar o vizinho mais próximo vira O(log n) em vez de comparar com todos."],
  mst: ["Kruskal · Union-Find", "Kruskal pega as ruas da mais barata para a mais cara (heap) e o Union-Find só aceita as que não fecham ciclo: o resultado liga a cidade com o menor custo total."],
  comp: ["Union-Find", "Cada cor é uma ilha (componente conexa). Feche ruas até isolar um bairro e veja as cores se separarem."],
};
$$("[data-layer]").forEach((b) => b.addEventListener("change", () => {
  const k = b.dataset.layer; layers[k] = b.checked; staticDirty = true;
  $("#legend").hidden = !layers.traffic;
  if (b.checked) say(...LAYER_TXT[k]);
}));
$("#traffic-routing").addEventListener("change", async (ev) => {
  const on = ev.target.checked;
  try {
    await call("traffic", { on });
    hint(on ? "As rotas voltam a desviar do trânsito." : "As rotas agora ignoram o trânsito.");
    say("Pesos dinâmicos", on ? "Ligado: ruas lentas e intensas pesam mais no Dijkstra, então carros, ambulâncias e a sua rota desviam delas." : "Desligado: todas as ruas voltam ao peso original. Compare a cor do mapa com o caminho escolhido.");
  } catch (e) { hint(e.message, true); }
});
$("#btn-layers").addEventListener("click", (ev) => {
  ev.stopPropagation(); const m = $("#layers"), open = m.hidden; m.hidden = !open;
  $("#btn-layers").setAttribute("aria-expanded", String(open));
  if (open) m.querySelector("input").focus();
});
document.addEventListener("pointerdown", (ev) => {
  if (!ev.target.closest("#layers, #btn-layers")) { $("#layers").hidden = true; $("#btn-layers").setAttribute("aria-expanded", "false"); }
  if (!ev.target.closest(".search")) closeSearch();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("#layers").hidden) { $("#layers").hidden = true; $("#btn-layers").setAttribute("aria-expanded", "false"); $("#btn-layers").focus(); }
});

/* controles */
$("#z-in").onclick = () => zoomAt(CW / 2, CH / 2, 1.4);
$("#z-out").onclick = () => zoomAt(CW / 2, CH / 2, 1 / 1.4);
$("#z-fit").onclick = () => fitView(true);
$("#btn-theme").onclick = () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next; store.set("atlas-theme", next);
};
$("#btn-tutor").onclick = () => {
  tutorOn = !tutorOn; applyTutor();
  if (tutorOn) say("", "Ligado. A cada ação eu explico qual estrutura de dados agiu e por quê.");
};
$("#btn-pause").onclick = () => call("pause", { paused: !(S && S.paused) });
$("#btn-undo").onclick = async () => {
  await call("undo"); await refreshRoute();
  say("Pilha", "Desfazer tirou a última ação do topo da pilha em O(1) e a colocou na pilha de refazer.");
};
$("#btn-redo").onclick = async () => { await call("redo"); await refreshRoute(); say("Pilha", "Refazer devolveu a ação da pilha de refazer para a de desfazer."); };
$("#btn-random").onclick = async () => {
  const n = Math.floor(Math.random() * MAP.nodes.length), s = 1 + Math.floor(Math.random() * 5);
  try { const r = await call("emergency", { node: n, severity: s }); hint(`Chamado #${r.id} (${SEV_NAME[s].toLowerCase()}) criado em ${streetsAt(n)}.`); }
  catch (e) { hint(e.message, true); }
};

/* abas e gaveta */
const tabs = $$("[data-tab]");
function selectTab(b, focus) {
  tabs.forEach((x) => { const on = x === b; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; });
  $$(".pane").forEach((p) => (p.hidden = p.id !== "tab-" + b.dataset.tab));
  if (focus) b.focus();
  if (isNarrow()) setSheet(true);
  if (S && b.dataset.tab === "chamados") drawHeap();
}
tabs.forEach((b) => b.addEventListener("click", () => selectTab(b)));
$(".tabs").addEventListener("keydown", (ev) => {
  const i = tabs.indexOf(document.activeElement); if (i < 0) return;
  if (ev.key === "ArrowRight") { selectTab(tabs[(i + 1) % tabs.length], true); ev.preventDefault(); }
  if (ev.key === "ArrowLeft") { selectTab(tabs[(i + tabs.length - 1) % tabs.length], true); ev.preventDefault(); }
});
$("#heap-block").addEventListener("toggle", () => { if (S) drawHeap(); });
function setSheet(open) {
  $("#panel").classList.toggle("open", open);
  $("#sheet-handle").setAttribute("aria-expanded", String(open));
  $("#sheet-handle").setAttribute("aria-label", open ? "Recolher painel" : "Abrir painel");
}
$("#sheet-handle").onclick = () => setSheet(!$("#panel").classList.contains("open"));
function measurePeek() {
  const peek = isNarrow() ? $("#sheet-handle").offsetHeight + $(".panel-head").offsetHeight : 0;
  document.documentElement.style.setProperty("--peek", peek + "px");
}

/* busca de ruas (Trie + Levenshtein) */
let acTimer = null, acItems = [], acIndex = -1;
function closeSearch() { $("#ac-pop").hidden = true; $("#ac").setAttribute("aria-expanded", "false"); acIndex = -1; }
function selectStreet(name) {
  const list = byName.get(name); if (!list) return;
  hiName = name; hiUntil = performance.now() + 5000;
  fitTo(Math.min(...list.map((e) => Math.min(e.ax, e.bx))), Math.min(...list.map((e) => Math.min(e.ay, e.by))),
    Math.max(...list.map((e) => Math.max(e.ax, e.bx))), Math.max(...list.map((e) => Math.max(e.ay, e.by))));
  closeSearch(); $("#ac").value = name; $("#ac-clear").hidden = false;
  hint(`${name} destacada no mapa.`);
}
async function runSearch() {
  const v = $("#ac").value; $("#ac-clear").hidden = !v;
  if (!v.trim()) { closeSearch(); return; }
  const r = await call("autocomplete", { prefix: v });
  $("#ac-trie").hidden = !r.path.length;
  setKids($("#ac-path"), r.path.map((ch) => h("i", {}, ch === " " ? "␣" : ch)));
  const items = []; acItems = [];
  const opt = (name, meta) => { const id = "ac-o" + acItems.length; acItems.push(name);
    return h("li", { id, role: "option", "aria-selected": "false", onpointerdown: (e) => { e.preventDefault(); selectStreet(name); } }, h("span", {}, name), h("small", {}, meta)); };
  for (const c of r.completions) items.push(opt(c.name, "peso " + c.weight));
  if (!r.completions.length) {
    if (r.suggestions.length) {
      items.push(h("li", { class: "note", role: "presentation" }, "Nenhuma rua começa assim. Você quis dizer:"));
      for (const s of r.suggestions) items.push(opt(s.name, s.distance === 1 ? "1 letra de diferença" : s.distance + " letras de diferença"));
      say("Levenshtein", "A Trie não achou nada com esse prefixo, então calculei a distância de edição (programação dinâmica) contra o início de cada rua e mostrei as mais parecidas.");
    } else items.push(h("li", { class: "note", role: "presentation" }, "Nenhuma rua encontrada."));
  } else say("Trie", `A busca desceu ${r.path.length} nós da Trie, um por letra. Depois uma heap de tamanho 6 escolheu as ruas de maior peso com esse prefixo.`);
  setKids($("#ac-list"), items); acIndex = -1;
  $("#ac-pop").hidden = false; $("#ac").setAttribute("aria-expanded", "true");
}
$("#ac").addEventListener("input", () => { clearTimeout(acTimer); acTimer = setTimeout(() => runSearch().catch((e) => hint(e.message, true)), 90); });
$("#ac").addEventListener("focus", () => { if ($("#ac").value) runSearch().catch(() => {}); });
$("#ac").addEventListener("keydown", (ev) => {
  const opts = $$("#ac-list [role=option]");
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    if (!opts.length) return;
    acIndex = (acIndex + (ev.key === "ArrowDown" ? 1 : opts.length - 1) + (acIndex < 0 && ev.key === "ArrowUp" ? 1 : 0)) % opts.length;
    opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === acIndex)));
    $("#ac").setAttribute("aria-activedescendant", opts[acIndex].id); ev.preventDefault();
  } else if (ev.key === "Enter") {
    const name = acItems[acIndex >= 0 ? acIndex : 0]; if (name) selectStreet(name); ev.preventDefault();
  } else if (ev.key === "Escape") closeSearch();
});
$("#ac-clear").onclick = () => { $("#ac").value = ""; closeSearch(); $("#ac-clear").hidden = true; hiName = null; $("#ac").focus(); };

/* moradores (Bloom + AVL) */
async function lookup(id) {
  const out = $("#res-info");
  if (!/^\d{1,9}$/.test(String(id).trim())) { out.className = "result no"; out.textContent = "Digite só números, por exemplo 104231."; return; }
  try {
    const r = await call("resident", { id: Number(id) });
    out.className = "result " + (r.found ? "ok" : "no");
    out.textContent = r.found
      ? `${r.resident.name}, mora em ${streetsAt(r.resident.home)}. A AVL achou com ${r.comparisons} comparações.`
      : r.bloom_maybe ? `Não existe. O Bloom Filter disse "talvez" (falso positivo) e a AVL gastou ${r.comparisons} comparações para confirmar.`
        : `Não existe. O Bloom Filter respondeu "com certeza não" sem tocar na árvore (0 comparações).`;
    say("Bloom Filter · AVL", "O Bloom Filter testa k bits. Se algum é 0, o morador com certeza não existe. Se todos são 1, a AVL confirma em O(log n) (altura " + S.avl.height + ").");
  } catch (e) { out.className = "result no"; out.textContent = e.message; }
}
$("#res-form").addEventListener("submit", (ev) => { ev.preventDefault(); lookup($("#rid").value); });
$("#btn-range").onclick = async () => {
  const r = await call("residents", { lo: 100000, hi: 100500 }), out = $("#res-info");
  out.className = "result ok";
  out.textContent = `${r.count} moradores com ID entre 100000 e 100500 (consulta por intervalo na AVL, O(log n + k)). Primeiros: ` +
    r.residents.slice(0, 4).map((x) => `${x.id} ${x.name}`).join(" · ") + (r.count > 4 ? " …" : "");
  say("AVL", "Consulta por intervalo: a AVL desce só pelos galhos que podem ter IDs na faixa, em O(log n + k).");
};

/* benchmarks (num worker separado; a cidade continua rodando) */
const SERIES = ["#1d5fd1", "#c2410c", "#15803d", "#7c3aed", "#0e7490", "#a16207"];
const SERIES_DARK = ["#79a7ff", "#fb923c", "#4ade80", "#c4b5fd", "#67e8f9", "#facc15"];
function drawChart(c, sizes, series, unit) {
  const w = c.clientWidth, hh = c.clientHeight; c.width = w * DPR; c.height = hh * DPR;
  const g = c.getContext("2d"); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const pal = effectiveTheme() === "dark" ? SERIES_DARK : SERIES, names = Object.keys(series);
  const all = names.flatMap((n) => series[n]).filter((v) => v > 0);
  let lo = Math.floor(Math.log10(Math.min(...all))), hi = Math.ceil(Math.log10(Math.max(...all)));
  if (hi - lo < 1) hi = lo + 1;
  const L = 44, R = 8, T = 8, B = 22, X = (i) => L + (Math.log10(sizes[i] / sizes[0]) / Math.log10(sizes[sizes.length - 1] / sizes[0])) * (w - L - R);
  const Y = (v) => T + (1 - (Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo)) * (hh - T - B);
  g.font = `11px ${P.font}`; g.lineWidth = 1;
  for (let e = lo; e <= hi; e++) {
    const y = Y(10 ** e); g.strokeStyle = P.line; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
    g.fillStyle = P["text-2"]; g.textAlign = "right"; g.textBaseline = "middle";
    const v = 10 ** e; g.fillText((v >= 1 ? v.toLocaleString("pt-BR") : v.toString().replace(".", ",")) + (unit ? " " + unit : ""), L - 6, y);
  }
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  sizes.forEach((s, i) => { g.fillStyle = P["text-2"]; g.fillText(s.toLocaleString("pt-BR"), X(i), hh - 6); });
  names.forEach((n, k) => {
    g.strokeStyle = g.fillStyle = pal[k % pal.length]; g.lineWidth = 2;
    g.beginPath(); series[n].forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
    series[n].forEach((v, i) => { g.beginPath(); g.arc(X(i), Y(v), i === series[n].length - 1 ? 3.5 : 2.5, 0, 7); g.fill(); });
  });
  return names.map((n, k) => h("span", {}, h("i", { style: "background:" + pal[k % pal.length] }), n));
}
let benchData = null;
function renderBench() {
  if (!benchData) return;
  const r = benchData, box = $("#bench"); box.replaceChildren();
  const add = (title, series, unit) => {
    const c = h("canvas", { role: "img", "aria-label": "Gráfico: " + title }), keys = h("div", { class: "keys" });
    box.append(h("div", { class: "chart" }, h("h4", {}, title), c, keys));
    keys.append(...drawChart(c, r.sizes, series, unit));
  };
  for (const [title, series] of Object.entries(r.suites)) add(title, series, "ms");
  for (const [title, series] of Object.entries(r.work)) add(title, series, "");
  box.append(h("div", { class: "chart" }, h("h4", {}, "Altura da AVL (limite teórico 1,44·log₂ n)"),
    h("table", { class: "avl-table" }, h("thead", {}, h("tr", {}, h("th", {}, "n"), h("th", {}, "altura"), h("th", {}, "log₂ n"), h("th", {}, "limite"), h("th", {}, "rotações"))),
      h("tbody", {}, r.avl_height.map((a) => h("tr", {}, h("td", {}, a.n.toLocaleString("pt-BR")), h("td", {}, a.height), h("td", {}, String(a.log2n).replace(".", ",")), h("td", {}, String(a.limite).replace(".", ",")), h("td", {}, a.rotacoes.toLocaleString("pt-BR"))))))));
}
async function runBench() {
  const btn = $("#btn-bench"), status = $("#bench-status"); btn.disabled = true; btn.textContent = "Rodando…";
  status.textContent = "Preparando…";
  const done = (r) => { benchData = r; renderBench(); status.textContent = `Pronto em ${(r.elapsed_ms / 1000).toFixed(1).replace(".", ",")} s. Tempos em milissegundos, nos dois eixos em escala log.`; btn.disabled = false; btn.textContent = "Rodar de novo";
    say("Benchmarks", "Em escala log-log, uma reta com inclinação perto de 1 é O(n); curvas quase planas são O(1) ou O(log n). Compare a Trie com a varredura linear e o A* com o Dijkstra."); };
  const fail = (e) => { status.textContent = "Não consegui rodar: " + e; btn.disabled = false; btn.textContent = "Rodar benchmarks"; };
  try {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "bench-progress") status.textContent = `Medindo ${m.name} (${m.i + 1} de ${m.n})…`;
      else if (m.type === "bench-done") { w.terminate(); done(m.result); }
      else if (m.type === "bench-error") { w.terminate(); fail(m.error); }
      else if (m.type === "boot") w.postMessage({ type: "bench" });
    };
    w.onerror = async (ev) => { ev.preventDefault(); w.terminate(); await benchInPage(done, fail); };
  } catch { await benchInPage(done, fail); }
}
async function benchInPage(done, fail) {
  try {
    const { runBenchmarks } = await import("./engine/benchmarks.js");
    await new Promise((r) => setTimeout(r, 30));
    done(runBenchmarks());
  } catch (e) { fail(e.message); }
}
$("#btn-bench").onclick = runBench;

/* ------------------------------------------------------------ tour */
const TOUR = [
  { target: "#tools", title: "Escolha uma ferramenta", text: "Rota traça o melhor caminho. Chamado pede uma ambulância. Fechar via bloqueia uma rua." },
  { target: "#mapwrap", title: "Clique no mapa", text: "Com Rota, clique em dois cruzamentos. Arraste para mover; use a roda do mouse ou dois dedos para aproximar." },
  { target: "#panel", title: "Acompanhe no painel", text: "Chamados, ambulâncias e o estado de cada estrutura ficam aqui. O botão de capelo liga o Modo tutor, que explica qual estrutura agiu." },
];
let tourStep = -1, ring = null;
function startTour() { tourStep = 0; $("#tour").hidden = false; ring = ring || document.body.appendChild(h("div", { class: "tour-ring" })); ring.hidden = false; renderTour(); $("#tour-next").focus(); }
function endTour() { tourStep = -1; $("#tour").hidden = true; if (ring) ring.hidden = true; store.set("atlas-tour", "done"); fg.focus({ preventScroll: true }); }
function renderTour() {
  const s = TOUR[tourStep]; let el = $(s.target);
  if (s.target === "#panel" && isNarrow()) el = $(".panel-head");
  if (s.target === "#mapwrap") el = $("#mapwrap");
  $("#tour-step").textContent = `Passo ${tourStep + 1} de ${TOUR.length}`;
  $("#tour-title").textContent = s.title; $("#tour-text").textContent = s.text;
  $("#tour-next").textContent = tourStep === TOUR.length - 1 ? "Começar" : "Próximo";
  $$(".dots i").forEach((d, i) => d.classList.toggle("on", i === tourStep));
  const r = el.getBoundingClientRect(), pad = s.target === "#mapwrap" ? -24 : 6;
  const box = { l: r.left - pad, t: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  if (s.target === "#mapwrap") { const ins = mapInsets(); box.l = r.left + ins.l + 120; box.t = r.top + ins.t + 120; box.w = Math.max(120, r.width - ins.l - ins.r - 240); box.h = Math.max(120, r.height - ins.t - ins.b - 240); }
  Object.assign(ring.style, { left: box.l + "px", top: box.t + "px", width: box.w + "px", height: box.h + "px" });
  const card = $(".tour-card"), cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight;
  let x, y;
  if (s.target === "#panel" && !isNarrow()) { x = box.l - cw - 16; y = box.t + 96; }
  else if (s.target === "#panel") { x = (vw - cw) / 2; y = box.t - ch - 16; }
  else if (s.target === "#mapwrap") { x = box.l + box.w / 2 - cw / 2; y = box.t + box.h / 2 - ch / 2; }
  else { x = box.l; y = box.t + box.h + 16; }
  card.style.left = Math.max(16, Math.min(x, vw - cw - 16)) + "px";
  card.style.top = Math.max(16, Math.min(y, vh - ch - 16)) + "px";
}
$("#tour-next").onclick = () => { if (tourStep >= TOUR.length - 1) endTour(); else { tourStep++; renderTour(); } };
$("#tour-skip").onclick = endTour;
$("#btn-tour").onclick = startTour;
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && tourStep >= 0) endTour(); });

/* ------------------------------------------------------------- início */
function onMap(msg) {
  MAP = msg.map; samples = msg.samples || [];
  prepare(); measurePeek(); sizeCanvases(); fitView(true);
  $("#rid").placeholder = "Ex.: " + samples[0];
  setKids($("#rid-samples"), [...samples, 99999].map((id) => h("button", { type: "button", onclick: () => { $("#rid").value = id; lookup(id); } }, id)));
}
function init() {
  const saved = store.get("atlas-theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
  readPalette(); applyThemeIcon(); applyTutor(); setTool("route");
  new MutationObserver(() => { readPalette(); applyThemeIcon(); if (S) drawHeap(); if (benchData) renderBench(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readPalette(); applyThemeIcon(); if (benchData) renderBench(); });
  new ResizeObserver(() => { measurePeek(); sizeCanvases(); if (tourStep >= 0) renderTour(); }).observe($("#mapwrap"));
  if (document.fonts) document.fonts.ready.then(() => { staticDirty = true; measurePeek(); });
  requestAnimationFrame(frame);
  startEngine().then(() => {
    if (store.get("atlas-tour") !== "done") setTimeout(startTour, 400);
  }).catch((e) => hint("Não consegui iniciar a simulação: " + e.message, true));
}
init();

/* gancho só de leitura para testes automatizados (Playwright) */
Object.defineProperty(window, "__atlas", { value: Object.freeze({
  get map() { return MAP; }, get state() { return S; }, get route() { return route; },
  call: (method, args) => call(method, args),
  get anim() { return anim ? { dijkstra: anim.d.length, astar: anim.a.length, done: performance.now() - anim.t0 >= anim.total } : null; },
  node(n) { const p = MAP.nodes[n], r = fg.getBoundingClientRect(); return [r.left + sx(p[0]), r.top + sy(p[1])]; },
  edge(id) { const e = E[id], r = fg.getBoundingClientRect(); return [r.left + sx(e.mx), r.top + sy(e.my)]; },
  visible(x, y) { const r = fg.getBoundingClientRect(); return x > r.left + 40 && x < r.right - 80 && y > r.top + 160 && y < r.bottom - 60; },
}) });
