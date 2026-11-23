// Ponte entre a interface e o motor. Substitui o antigo servidor HTTP:
// cada antiga rota /api/* virou um método aqui. Roda dentro do Web Worker
// (worker.js) ou, se o navegador recusar workers, na própria página.
import { City } from "./city.js";

export const DEFAULTS = { seed: 42, width: 12, height: 8, n_cars: 150, tick_ms: 300 };

export function makeHost(post) {
  let city = null, timer = null, paused = false, tickMs = DEFAULTS.tick_ms;

  const sendState = () => {
    const state = city.state_json();
    state.paused = paused;
    const motion = city.motion_json();
    post({ type: "state", state, motion, tickMs }, [motion.buffer]);
  };
  const loop = () => {
    clearInterval(timer);
    timer = setInterval(() => { if (!paused) { city.tick(); sendState(); } }, tickMs);
  };
  const int = (v, name) => {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error("parâmetro inteiro inválido: " + name);
    return n;
  };

  const methods = {
    init(cfg = {}) {
      const c = { ...DEFAULTS, ...cfg };
      city = new City({ seed: c.seed, width: c.width, height: c.height, n_cars: c.n_cars });
      tickMs = c.tick_ms; paused = false;
      post({ type: "map", map: city.map_json(), samples: city.sample_residents(4) });
      sendState(); loop();
      return true;
    },
    route: ({ src, dst }) => city.route_query(int(src, "src"), int(dst, "dst")),
    trace: ({ src, dst }) => city.search_trace(int(src, "src"), int(dst, "dst")),
    autocomplete: ({ prefix }) => city.autocomplete(String(prefix ?? "")),
    resident: ({ id }) => city.lookup_resident(int(id, "id")),
    residents: ({ lo, hi }) => city.residents_range(int(lo, "lo"), int(hi, "hi")),
    emergency: ({ node, severity = 3 }) => ({ ok: true, id: city.add_emergency(int(node, "node"), int(severity, "severity")) }),
    close: ({ u, v }) => ({ ok: city.close_road(int(u, "u"), int(v, "v")) }),
    open: ({ u, v }) => ({ ok: city.open_road(int(u, "u"), int(v, "v")) }),
    undo: () => ({ ok: city.undo() }),
    redo: () => ({ ok: city.redo() }),
    traffic: ({ on }) => ({ ok: city.set_traffic_routing(!!on), on: city.traffic_routing }),
    pause: ({ paused: p }) => { paused = p === undefined ? !paused : !!p; return { paused }; },
    speed: ({ tick_ms }) => { tickMs = Math.max(60, Math.min(2000, int(tick_ms, "tick_ms"))); loop(); return { tick_ms: tickMs }; },
  };
  const MUTATING = new Set(["emergency", "close", "open", "undo", "redo", "pause", "traffic"]);

  return function onMessage(msg) {
    if (!msg || msg.type !== "call") return;
    const { id, method, args } = msg;
    try {
      if (!methods[method]) throw new Error("método desconhecido: " + method);
      if (method !== "init" && !city) throw new Error("motor ainda não iniciado");
      const result = methods[method](args || {});
      post({ type: "reply", id, ok: true, result });
      if (MUTATING.has(method)) sendState();
    } catch (e) {
      post({ type: "reply", id, ok: false, error: e && e.message ? e.message : String(e) });
    }
  };
}
