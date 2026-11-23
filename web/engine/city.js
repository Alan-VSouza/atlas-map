// Motor da cidade ATLAS (porte fiel de city/simulation.py).
// Com a mesma seed, mapa, rotas e estado batem com a versão Python (ver tests_js/parity).
//
//   malha viária ........ Graph + Dijkstra/A* (heap), Union-Find, Kruskal
//   chamados ............ BinaryHeap (prioridade por gravidade)
//   ambulâncias ......... Quadtree (candidatas mais próximas) + KDTree (hospital)
//   cache de rotas ...... LRUCache (lista dupla + hash)
//   moradores ........... AVL + Bloom Filter
//   ruas ................ Trie (autocomplete) + Levenshtein ("você quis dizer")
//   tráfego ............. Segment Tree, Fenwick Tree, Count-Min Sketch
//   rotas x trânsito .... pesos dinâmicos: rua lenta/intensa custa mais no Dijkstra
//   desfazer/refazer .... Stack
//   linha do tempo ...... DoublyLinkedList + Huffman (compressão do log)

import { PyRandom, hypot, pyRound } from "./pycompat.js";
import { ChainingHashTable } from "./hashtable.js";
import { DoublyLinkedList, Stack } from "./linear.js";
import { BinaryHeap } from "./heap.js";
import { BloomFilter, CountMinSketch, LRUCache, SegmentTree, FenwickTree, HuffmanCodec, levenshtein } from "./misc.js";
import { AVLTree, Trie } from "./trees.js";
import { Graph, INF, astar, connectedComponents, kruskal, shortestPath, UnionFind } from "./graph.js";
import { Quadtree, KDTree } from "./spatial.js";

export const FIRST = ["Ana", "Bruno", "Carla", "Daniel", "Eduarda", "Felipe", "Gabriela", "Hugo",
  "Isabela", "João", "Karina", "Lucas", "Marina", "Nicolas", "Olívia", "Pedro",
  "Quitéria", "Rafael", "Sofia", "Tiago", "Úrsula", "Vitor", "Wesley", "Yasmin"];
export const LAST = ["Silva", "Souza", "Oliveira", "Santos", "Lima", "Pereira", "Costa", "Rodrigues",
  "Almeida", "Nascimento", "Carvalho", "Gomes", "Martins", "Araújo", "Ribeiro",
  "Barbosa", "Rocha", "Dias", "Moreira", "Cardoso"];
export const STREETS = ["das Flores", "Sete de Setembro", "Tiradentes", "XV de Novembro", "Santos Dumont",
  "Dom Pedro II", "Getúlio Vargas", "Rui Barbosa", "Bandeirantes", "Paulista",
  "Santa Cruz", "São Carlos", "do Brasil", "da Independência", "Marechal Deodoro",
  "Castro Alves", "Machado de Assis", "Carlos Gomes", "Ipiranga", "Augusta",
  "Anhanguera", "Brigadeiro Luís", "Saldanha Marinho", "Voluntários da Pátria",
  "Quintino Bocaiúva", "José Bonifácio", "da Consolação", "Lavras"];

// Trânsito: a cada TRAFFIC_WINDOW ticks mede a ocupação média de cada rua
// (carros por 100 unidades) e classifica em livre / lenta / intensa.
// Com traffic_routing ligado, o peso da rua no grafo vira peso0 * fator do nível.
export const TRAFFIC_WINDOW = 10, TRAFFIC_SLOW = 2.3, TRAFFIC_JAM = 3.2;
export const TRAFFIC_FACTOR = [1.0, 1.6, 2.5];

/** Chave canônica de aresta: (menor, maior) como string "u-v" (e array para o hash). */
const ek = (u, v) => (u < v ? u * 1048576 + v : v * 1048576 + u);
const ekPair = (k) => [Math.floor(k / 1048576), k % 1048576];
const range = (n) => Array.from({ length: n }, (_, i) => i);
const cmpPair = (a, b) => a[0] - b[0] || a[1] - b[1];

export class City {
  constructor({ seed = 42, width = 12, height = 8, n_cars = 60, n_residents = 2000,
    n_hospitals = 3, n_ambulances = 3, emergency_rate = 0.05, traffic_routing = true } = {}) {
    if (width < 3 || height < 3) throw new Error("a cidade precisa de pelo menos 3x3 cruzamentos");
    this.seed = seed;
    this.rng = new PyRandom(seed);
    this.W = width; this.H = height; this.n = width * height;
    this.tick_n = 0; this.version = 0; this.emergency_rate = emergency_rate;

    this._buildMap();
    this._buildStreets();
    this._buildResidents(n_residents);
    this._buildServices(n_hospitals, n_ambulances);

    this.route_cache = new LRUCache(128);
    this.cms = new CountMinSketch(256, 4);
    const lt3 = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]);
    this.pq = new BinaryHeap({ lt: lt3 });            // [-gravidade, criado, id]
    this.emergencies = new ChainingHashTable();       // id -> objeto
    this._next_eid = 1;
    this.undo_stack = new Stack(); this.redo_stack = new Stack();
    this.timeline = new DoublyLinkedList();
    this.RING = 256;
    this.thr_sum = new SegmentTree(new Array(this.RING).fill(0));
    this.thr_max = new SegmentTree(new Array(this.RING).fill(0), (a, b) => (a >= b ? a : b), 0);
    this.resolved_bit = new FenwickTree(this.RING);
    this._huff_cache = [-1, 1.0, 0];
    this.stats = { spawned: 0, resolved: 0, unreachable: 0, resp_sum: 0, resp_n: 0, arrivals: 0 };
    this._arrivals_tick = 0;
    this.traffic_routing = !!traffic_routing;
    this.traffic_level = new Array(this.edge_list.length).fill(0);
    this._occ_sum = new Array(this.edge_list.length).fill(0);
    this.traffic_updates = 0;

    this._recomputeTopology();
    this.cars = range(n_cars).map((i) => this._newCar(i));
    this._rebuildCarIndex();
    this.log(`Cidade criada (seed=${seed}, ${width}x${height})`);
  }

  // ------------------------------------------------------------------ mapa
  _buildMap() {
    const rng = this.rng, W = this.W, H = this.H;
    this.coords = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const cx = x * 100 + rng.uniform(-18, 18);
      const cy = y * 100 + rng.uniform(-18, 18);
      this.coords.push([cx, cy]);
    }
    const candidates = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = y * W + x;
      if (x + 1 < W) candidates.push([u, u + 1]);
      if (y + 1 < H) candidates.push([u, u + W]);
    }
    rng.shuffle(candidates);
    const uf = new UnionFind(this.n), keep = [];
    for (const [u, v] of candidates) {        // Kruskal aleatório garante conectividade
      if (uf.union(u, v)) keep.push([u, v]);
      else if (rng.random() < 0.88) keep.push([u, v]);
    }
    keep.sort(cmpPair);
    this.g = new Graph(this.n);
    this.g0 = new Graph(this.n);   // mesma malha sem trânsito (para comparar a rota)
    this.length = new Map(); this.weight0 = new Map();
    this.edge_list = []; this.edge_id = new Map();
    for (const [u, v] of keep) {
      const [x0, y0] = this.coords[u], [x1, y1] = this.coords[v];
      const ln = hypot(x1 - x0, y1 - y0);
      const w = ln * (1.0 + rng.random() * 0.4);
      this.g.addEdge(u, v, w);
      this.g0.addEdge(u, v, w);
      const k = ek(u, v);
      this.length.set(k, ln); this.weight0.set(k, w);
      this.edge_id.set(k, this.edge_list.length);
      this.edge_list.push(k);
    }
    this.closed = new Set();
  }

  _buildStreets() {
    const rng = this.rng, need = this.W + this.H, names = STREETS.slice();
    rng.shuffle(names);
    while (names.length < need) names.push(`Projetada ${names.length + 1}`);
    this.row_name = range(this.H).map((i) => "Rua " + names[i]);
    this.col_name = range(this.W).map((i) => "Av. " + names[this.H + i]);
    this.edge_street = new Map();
    for (const k of this.edge_list) {
      const [u, v] = ekPair(k);
      this.edge_street.set(k, v === u + 1 ? this.row_name[Math.floor(u / this.W)] : this.col_name[u % this.W]);
    }
    this.trie = new Trie();
    this.street_display = new ChainingHashTable();
    for (const name of [...this.row_name, ...this.col_name]) {
      const low = name.toLowerCase();
      this.trie.insert(low, rng.randint(1, 50));
      this.street_display.put(low, name);
    }
    this.street_words = [...this.row_name, ...this.col_name].map((n) => n.toLowerCase());
  }

  _buildResidents(count) {
    const rng = this.rng;
    this.residents = new AVLTree();
    this.bloom = BloomFilter.fromCapacity(Math.max(1, count), 0.01);
    const pop = range(count * 5).map((i) => 100000 + i);
    const ids = rng.sample(pop, count);
    for (const rid of ids) {
      const first = rng.choice(FIRST), last = rng.choice(LAST);
      const rec = { id: rid, name: `${first} ${last}`, home: rng.randrange(this.n) };
      this.residents.insert(rid, rec);
      this.bloom.add(rid);
    }
    this.bloom_skips = 0;
  }

  _buildServices(nHosp, nAmb) {
    const rng = this.rng;
    this.hospitals = rng.sample(range(this.n), Math.min(nHosp, this.n)).sort((a, b) => a - b);
    this.hospital_index = new KDTree(this.hospitals.map((h) => [this.coords[h][0], this.coords[h][1], h]));
    this.ambulances = [];
    for (let i = 0; i < nAmb; i++) {
      const node = this.hospitals[i % this.hospitals.length];
      this.ambulances.push({ id: i, node, state: "idle", route: [node], i: 0, frac: 0.0, dest: node,
        eid: null, version: 0, speed: 55.0 });
    }
    const xs = this.coords.map((c) => c[0]), ys = this.coords.map((c) => c[1]);
    this.bounds = [Math.min(...xs) - 20, Math.min(...ys) - 20, Math.max(...xs) + 20, Math.max(...ys) + 20];
  }

  // ------------------------------------------------------------- topologia
  _recomputeTopology() {
    [this.comp, this.ncomp] = connectedComponents(this.g);
    [this.mst_edges, this.mst_total] = kruskal(this.g);
  }
  _bumpVersion() { this.version++; this._recomputeTopology(); }

  // -------------------------------------------------------------- trânsito
  _effWeight(k) {
    if (!this.traffic_routing) return this.weight0.get(k);
    return this.weight0.get(k) * TRAFFIC_FACTOR[this.traffic_level[this.edge_id.get(k)]];
  }
  /** Soma a ocupação de cada rua; a cada janela reclassifica e ajusta os pesos. */
  _updateTraffic() {
    const occ = this._occ_sum;
    for (const car of this.cars) {
      const r = car.route, i = car.i;
      if (i < r.length - 1) occ[this.edge_id.get(ek(r[i], r[i + 1]))] += 1;
    }
    if ((this.tick_n + 1) % TRAFFIC_WINDOW) return;
    let changed = 0;
    this.edge_list.forEach((k, e) => {
      const dens = occ[e] / TRAFFIC_WINDOW * 100 / this.length.get(k);
      const lvl = dens < TRAFFIC_SLOW ? 0 : dens < TRAFFIC_JAM ? 1 : 2;
      occ[e] = 0;
      if (lvl !== this.traffic_level[e]) {
        this.traffic_level[e] = lvl;
        changed++;
        if (this.traffic_routing && !this.closed.has(k)) { const [a, b] = ekPair(k); this.g.setWeight(a, b, this._effWeight(k)); }
      }
    });
    if (changed && this.traffic_routing) {
      this.traffic_updates++;
      this._bumpVersion();   // rotas antigas do cache deixam de valer; carros recalculam
    }
  }
  /** Liga/desliga o efeito do trânsito nas rotas (reaplica os pesos). */
  set_traffic_routing(on) {
    on = !!on;
    if (on === this.traffic_routing) return false;
    this.traffic_routing = on;
    for (const k of this.edge_list) if (!this.closed.has(k)) { const [a, b] = ekPair(k); this.g.setWeight(a, b, this._effWeight(k)); }
    this._bumpVersion();
    this.log(`Rotas ${on ? "consideram" : "ignoram"} o trânsito`);
    return true;
  }

  // ----------------------------------------------------------------- rotas
  _h(u, t) { const [x0, y0] = this.coords[u], [x1, y1] = this.coords[t]; return hypot(x1 - x0, y1 - y0); }

  /** [custo, caminho] via cache LRU + Dijkstra; null se inalcançável. */
  _routeFull(src, dst) {
    if (src === dst) return [0.0, [src]];
    const key = [src, dst, this.version];
    const hit = this.route_cache.get(key, null);
    if (hit !== null) return hit;
    const [cost, path] = shortestPath(this.g, src, dst);
    if (cost === INF) return null;
    this.route_cache.put(key, [cost, path]);
    return [cost, path];
  }
  _route(src, dst) { const r = this._routeFull(src, dst); return r === null ? null : r[1]; }

  /** Consulta de rota para a UI, comparando Dijkstra e A*. */
  route_query(src, dst) {
    if (!(Number.isInteger(src) && Number.isInteger(dst) && src >= 0 && src < this.n && dst >= 0 && dst < this.n)) throw new Error("nó inválido");
    const key = [src, dst, this.version];
    const cached = this.route_cache.has(key);
    const [dCost, dPath, dSettled] = shortestPath(this.g, src, dst);
    const [aCost, , aExpanded] = astar(this.g, src, dst, (u, t) => this._h(u, t));
    if (dCost !== INF) this.route_cache.put(key, [dCost, dPath]);
    // o mesmo pedido sem trânsito: mostra o caminho que o trânsito fez evitar
    let fCost = dCost, fPath = dPath;
    if (this.traffic_routing) [fCost, fPath] = shortestPath(this.g0, src, dst);
    let fNow = null;
    if (fCost !== INF) { fNow = 0; for (let i = 0; i + 1 < fPath.length; i++) fNow += this.g.weight(fPath[i], fPath[i + 1]); }
    return { src, dst, found: dCost !== INF,
      free_cost: fCost === INF ? null : pyRound(fCost, 2), free_path: fPath,
      free_cost_now: fNow === null ? null : pyRound(fNow, 2),
      cost: dCost === INF ? null : pyRound(dCost, 2),
      path: dPath, cached_before: cached,
      dijkstra_settled: dSettled, astar_expanded: aExpanded,
      astar_cost: aCost === INF ? null : pyRound(aCost, 2),
      streets: this._streetsOf(dPath) };
  }
  /** Ordem em que o Dijkstra assenta e o A* expande os nós (só JS: alimenta a animação).
   *  Mesmo algoritmo de route_query, então os tamanhos batem com dijkstra_settled e astar_expanded. */
  search_trace(src, dst) {
    if (!(Number.isInteger(src) && Number.isInteger(dst) && src >= 0 && src < this.n && dst >= 0 && dst < this.n)) throw new Error("nó inválido");
    const d = [], a = [];
    const [, dPath] = shortestPath(this.g, src, dst, (u) => d.push(u));
    astar(this.g, src, dst, (u, t) => this._h(u, t), (u) => a.push(u));
    return { dijkstra: d, astar: a, path: dPath };
  }
  _streetsOf(path) {
    const out = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const name = this.edge_street.get(ek(path[i], path[i + 1]));
      if (name && (!out.length || out[out.length - 1] !== name)) out.push(name);
    }
    return out;
  }

  // ------------------------------------------------------------ entidades
  _pickDest(node) {
    const c = this.comp[node], options = [];
    for (let i = 0; i < this.n; i++) if (this.comp[i] === c && i !== node) options.push(i);
    return options.length ? this.rng.choice(options) : null;
  }
  _newCar(cid) {
    // carros fazem casa <-> trabalho; as rotas se repetem e o cache LRU rende
    const home = this.rng.randrange(this.n);
    const others = []; for (let i = 0; i < this.n; i++) if (i !== home) others.push(i);
    const work = this.rng.choice(others);
    const car = { id: cid, route: [home], i: 0, frac: 0.0, dest: home, home, work,
      version: this.version, speed: this.rng.uniform(16, 30) };
    this._assignTrip(car, home);
    return car;
  }
  _assignTrip(ent, node) {
    let dest = null;
    if ("work" in ent) {
      const cand = node !== ent.work ? ent.work : ent.home;
      if (cand !== node && this.comp[cand] === this.comp[node]) dest = cand;
    }
    if (dest === null) dest = this._pickDest(node);   // fora do trajeto ou sem caminho: sorteia outro
    const route = dest !== null ? this._route(node, dest) : null;
    if (route === null) { ent.route = [node]; ent.dest = node; }
    else { ent.route = route; ent.dest = dest; }
    ent.i = 0; ent.frac = 0.0; ent.version = this.version;
  }
  _advance(ent, speed, isCar = false) {
    let remaining = speed;
    while (remaining > 1e-9 && ent.i < ent.route.length - 1) {
      const route = ent.route, u = route[ent.i], v = route[ent.i + 1], k = ek(u, v);
      const length = this.length.get(k);
      const left = length * (1.0 - ent.frac);
      if (remaining >= left) {
        remaining -= left;
        ent.i += 1; ent.frac = 0.0;
        this.cms.add(ekPair(k));
        if (isCar) { this._arrivals_tick++; this.stats.arrivals++; }
        if (ent.i < route.length - 1 && ent.version !== this.version) {
          ent.version = this.version;
          const newr = this._route(v, ent.dest);
          if (newr === null) { ent.route = [v]; ent.i = 0; ent.dest = v; break; }
          ent.route = newr; ent.i = 0;
        }
      } else {
        ent.frac += remaining / length;
        remaining = 0.0;
      }
    }
  }
  _pos(ent) {
    const r = ent.route, i = ent.i;
    if (i >= r.length - 1) return this.coords[r[r.length - 1]];
    const [x0, y0] = this.coords[r[i]], [x1, y1] = this.coords[r[i + 1]], f = ent.frac;
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
  }
  _rebuildCarIndex() {
    const b = this.bounds;
    this.car_qt = new Quadtree(b[0], b[1], b[2], b[3], 4);
    for (const c of this.cars) { const [x, y] = this._pos(c); this.car_qt.insert(x, y, c.id); }
  }

  // ----------------------------------------------------------- emergências
  add_emergency(node, severity) {
    if (!(Number.isInteger(node) && node >= 0 && node < this.n)) throw new Error("nó inválido");
    if (!(Number.isInteger(severity) && severity >= 1 && severity <= 5)) throw new Error("gravidade deve estar entre 1 e 5");
    const eid = this._next_eid++;
    this.emergencies.put(eid, { id: eid, node, severity, created: this.tick_n, state: "waiting", ambulance: null });
    this.pq.push([-severity, this.tick_n, eid]);
    this.stats.spawned++;
    this.log(`Chamado #${eid} (gravidade ${severity}) no nó ${node}`);
    return eid;
  }
  _dispatch() {
    const idle = this.ambulances.filter((a) => a.state === "idle");
    if (!idle.length || !this.pq.length) return;
    const b = this.bounds;
    const qt = new Quadtree(b[0], b[1], b[2], b[3], 2);
    for (const a of idle) { const [x, y] = this.coords[a.node]; qt.insert(x, y, a.id); }
    while (qt.length && this.pq.length) {
      const [, , eid] = this.pq.pop();
      const e = this.emergencies.get(eid);
      const [ex, ey] = this.coords[e.node];
      let best = null;
      for (const [, px, py, aid] of qt.nearest(ex, ey, Math.min(3, qt.length))) {
        const amb = this.ambulances[aid];
        const r = this._routeFull(amb.node, e.node);
        if (r !== null && (best === null || r[0] < best[0])) best = [r[0], r[1], aid, px, py];
      }
      if (best === null) {
        e.state = "unreachable"; this.stats.unreachable++;
        this.log(`Chamado #${eid} inalcançável`);
        continue;
      }
      const [, path, aid, px, py] = best;
      qt.remove(px, py, aid);
      Object.assign(this.ambulances[aid], { state: "to_scene", route: path, i: 0, frac: 0.0, dest: e.node, eid, version: this.version });
      e.state = "assigned"; e.ambulance = aid; e.dispatched = this.tick_n;
      this.log(`Ambulância ${aid} -> chamado #${eid}`);
    }
  }
  _stepAmbulances() {
    for (const a of this.ambulances) {
      if (a.state === "idle") continue;
      this._advance(a, a.speed);
      if (a.i < a.route.length - 1) continue;
      const node = a.route[a.route.length - 1];
      const e = this.emergencies.get(a.eid);
      if (a.state === "to_scene" && node !== e.node) {
        // a rota até o chamado foi cortada (via fechada) e não há caminho
        e.state = "unreachable"; this.stats.unreachable++;
        this.log(`Chamado #${e.id} ficou inalcançável`);
        Object.assign(a, { state: "idle", node, route: [node], i: 0, frac: 0.0, dest: node, eid: null });
      } else if (a.state === "to_scene") {
        e.state = "transport"; e.arrived = this.tick_n;
        this.stats.resp_sum += this.tick_n - e.created; this.stats.resp_n++;
        const [x, y] = this.coords[node];
        let target = null;
        for (const [, , , h] of this.hospital_index.nearest(x, y, this.hospitals.length)) {
          const r = this._routeFull(node, h);
          if (r !== null) { target = [h, r[1]]; break; }
        }
        if (target === null) this._finish(a, e, node);
        else Object.assign(a, { state: "to_hospital", route: target[1], i: 0, frac: 0.0, dest: target[0], version: this.version });
      } else {
        this._finish(a, e, node);
      }
    }
  }
  _finish(a, e, node) {
    e.state = "done"; e.done = this.tick_n;
    this.stats.resolved++;
    this.resolved_bit.add(this.tick_n % this.RING, 1);
    this.log(`Chamado #${e.id} atendido (ambulância ${a.id})`);
    Object.assign(a, { state: "idle", node, route: [node], i: 0, frac: 0.0, dest: node, eid: null });
  }

  // ------------------------------------------------------------------ tick
  tick() {
    if (this.rng.random() < this.emergency_rate) {
      const sev = this.rng.choices([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])[0];
      this.add_emergency(this.rng.randrange(this.n), sev);
    }
    this._dispatch();
    this._stepAmbulances();
    this._arrivals_tick = 0;
    for (const car of this.cars) {
      if (car.i >= car.route.length - 1) this._assignTrip(car, car.route[car.route.length - 1]);
      this._advance(car, car.speed, true);
    }
    this._updateTraffic();
    const slot = this.tick_n % this.RING;
    this.thr_sum.update(slot, this._arrivals_tick);
    this.thr_max.update(slot, this._arrivals_tick);
    this._rebuildCarIndex();
    this.tick_n++;
  }
  run(ticks) { for (let i = 0; i < ticks; i++) this.tick(); }

  /** Consulta nos últimos k ticks (anel circular com 2 consultas se der a volta). */
  _ringQuery(tree, k) {
    k = Math.min(k, this.tick_n ? this.tick_n : 1);
    const end = this.tick_n ? (this.tick_n - 1) % this.RING : 0;
    const start = end - k + 1;
    if (start >= 0) return tree.query(start, end + 1);
    return tree.op(tree.query(0, end + 1), tree.query(this.RING + start, this.RING));
  }

  // ---------------------------------------------------------- ações do mapa
  close_road(u, v, record = true) {
    const k = ek(u, v);
    if (!this.edge_id.has(k) || this.closed.has(k)) return false;
    const w = this.g.removeEdge(u, v);
    if (w === null) return false;
    this.g0.removeEdge(u, v);
    this.closed.add(k);
    if (record) { this.undo_stack.push(["close", k]); this.redo_stack.clear(); }
    this._bumpVersion();
    const [a, b] = ekPair(k);
    this.log(`Via fechada: ${this.edge_street.get(k)} (${a}-${b}) | ilhas: ${this.ncomp}`);
    return true;
  }
  open_road(u, v, record = true) {
    const k = ek(u, v);
    if (!this.closed.has(k)) return false;
    const [a, b] = ekPair(k);
    this.closed.delete(k);
    this.g.addEdge(a, b, this._effWeight(k));
    this.g0.addEdge(a, b, this.weight0.get(k));
    if (record) { this.undo_stack.push(["open", k]); this.redo_stack.clear(); }
    this._bumpVersion();
    this.log(`Via reaberta: ${this.edge_street.get(k)} (${a}-${b})`);
    return true;
  }
  undo() {
    if (this.undo_stack.isEmpty()) return false;
    const [kind, k] = this.undo_stack.pop(), [a, b] = ekPair(k);
    if (kind === "close") this.open_road(a, b, false); else this.close_road(a, b, false);
    this.redo_stack.push([kind, k]);
    return true;
  }
  redo() {
    if (this.redo_stack.isEmpty()) return false;
    const [kind, k] = this.redo_stack.pop(), [a, b] = ekPair(k);
    if (kind === "close") this.close_road(a, b, false); else this.open_road(a, b, false);
    this.undo_stack.push([kind, k]);
    return true;
  }

  // ------------------------------------------------------------- consultas
  autocomplete(prefix, k = 6) {
    const p = prefix.toLowerCase();
    const comps = this.trie.autocomplete(p, k).map(([w, wt]) => ({ name: this.street_display.get(w, w), weight: wt }));
    const out = { prefix, path: this.trie.path(p), completions: comps, suggestions: [] };
    if (!comps.length && p) {
      const heap = new BinaryHeap({ lt: (a, b) => a[0] < b[0], max: true });
      const pl = Array.from(p).length;
      for (const w of this.street_words) {
        // distância entre o que foi digitado e o início da rua (mesmo tamanho)
        const d = levenshtein(p, Array.from(w).slice(0, pl).join(""));
        heap.push([d, w]);
        if (heap.length > 3) heap.pop();
      }
      const best = [];
      while (heap.length) best.push(heap.pop());
      best.reverse();
      out.suggestions = best.filter(([d]) => d <= Math.max(2, Math.floor(pl / 2)))
        .map(([d, w]) => ({ name: this.street_display.get(w, w), distance: d }));
    }
    return out;
  }
  lookup_resident(rid) {
    if (!this.bloom.has(rid)) {
      this.bloom_skips++;
      return { id: rid, found: false, bloom_maybe: false, comparisons: 0, resident: null };
    }
    const before = this.residents.comparisons;
    const rec = this.residents.get(rid, null);
    return { id: rid, found: rec !== null, bloom_maybe: true,
      comparisons: this.residents.comparisons - before, resident: rec };
  }
  residents_range(lo, hi, limit = 20) {
    const items = this.residents.range(lo, hi);
    return { lo, hi, count: items.length, residents: items.slice(0, limit).map(([, v]) => v) };
  }
  hot_roads(k = 5) {
    const heap = new BinaryHeap({ lt: (a, b) => a[0] < b[0] });
    for (const e of this.edge_list) {
      const est = this.cms.estimate(ekPair(e));
      if (est === 0) continue;
      heap.push([est, e]);
      if (heap.length > k) heap.pop();
    }
    const out = [];
    while (heap.length) out.push(heap.pop());
    out.reverse();
    return out.map(([c, e]) => ({ edge: this.edge_id.get(e), street: this.edge_street.get(e), count: c }));
  }
  log(msg) {
    this.timeline.pushFront(this.tick_n, msg);
    if (this.timeline.length > 300) this.timeline.popBack();
  }
  _huffmanStats() {
    if (this.tick_n - this._huff_cache[0] < 25 && this._huff_cache[0] >= 0) return [this._huff_cache[1], this._huff_cache[2]];
    const text = [...this.timeline].map((n) => `t${n.key} ${n.value}`).join("\n");
    const codec = new HuffmanCodec().fit(text);
    const ratio = codec.compressionRatio(text), len = Array.from(text).length;
    this._huff_cache = [this.tick_n, ratio, len];
    return [ratio, len];
  }

  // ----------------------------------------------------------------- JSON
  map_json() {
    return { W: this.W, H: this.H, bounds: this.bounds.slice(),
      nodes: this.coords.map(([x, y]) => [pyRound(x, 1), pyRound(y, 1)]),
      edges: this.edge_list.map((k, i) => { const [u, v] = ekPair(k); return { id: i, u, v, name: this.edge_street.get(k) }; }),
      hospitals: this.hospitals.slice(), seed: this.seed,
      rows: this.row_name.slice(), cols: this.col_name.slice() };
  }

  state_json() {
    const cars = this.cars.map((c) => { const [x, y] = this._pos(c); return [pyRound(x, 1), pyRound(y, 1), c.id]; });
    const ambs = this.ambulances.map((a) => {
      const [x, y] = this._pos(a);
      const ahead = a.state !== "idle" ? a.route.slice(a.i + 1) : [];
      return { id: a.id, x: pyRound(x, 1), y: pyRound(y, 1), state: a.state, eid: a.eid, route: ahead, dest: a.dest };
    });
    const active = [];
    for (const [, e] of this.emergencies.items()) {
      if (e.state === "waiting" || e.state === "assigned" || e.state === "transport") {
        active.push({ id: e.id, node: e.node, severity: e.severity, state: e.state, created: e.created });
      }
    }
    active.sort((a, b) => a.id - b.id);
    const heapArr = this.pq.toList().map(([s, cr, eid]) => ({ id: eid, severity: -s, created: cr, node: this.emergencies.get(eid).node }));
    const [ratio, raw] = this._huffmanStats();
    const st = this.stats, resp = st.resp_n ? st.resp_sum / st.resp_n : null, rc = this.route_cache;
    return {
      tick: this.tick_n, version: this.version,
      cars, ambulances: ambs, emergencies: active, heap: heapArr,
      closed: [...this.closed].map((k) => this.edge_id.get(k)).sort((a, b) => a - b),
      comp: this.comp.slice(), ncomp: this.ncomp,
      mst: { edges: this.mst_edges.map(([u, v]) => this.edge_id.get(ek(u, v))), total: pyRound(this.mst_total, 1) },
      lru: { keys: rc.keysMruFirst().map(([s, d, v]) => `${s}→${d} (v${v})`).slice(0, 12),
        size: rc.length, capacity: rc.capacity, hits: rc.hits, misses: rc.misses, evictions: rc.evictions,
        hit_rate: pyRound(rc.hitRate(), 3) },
      quadtree: this.car_qt.rects(),
      stats: { spawned: st.spawned, resolved: st.resolved, unreachable: st.unreachable,
        avg_response_ticks: resp === null ? null : pyRound(resp, 1), waiting: this.pq.length },
      traffic: { last60: this._ringQuery(this.thr_sum, 60), peak60: this._ringQuery(this.thr_max, 60),
        resolved_total: this.resolved_bit.prefix(this.RING) },
      hot_roads: this.hot_roads(5),
      traffic_levels: this.traffic_level.slice(), traffic_routing: this.traffic_routing, traffic_updates: this.traffic_updates,
      undo: this.undo_stack.length, redo: this.redo_stack.length,
      log: [...this.timeline].slice(0, 14).map((n) => `t${n.key}  ${n.value}`),
      huffman: { ratio: pyRound(ratio, 3), raw_chars: raw },
      avl: { size: this.residents.length, height: this.residents.height(), rotations: this.residents.rotations },
      bloom: { bits: this.bloom.m, hashes: this.bloom.k, est_fp: pyRound(this.bloom.estimatedFpRate(), 4), skips: this.bloom_skips },
      trie: { words: this.trie.length, nodes: this.trie.nodeCount },
    };
  }

  /** Extra só do JS (não faz parte da paridade): por carro, aresta atual e direção. */
  motion_json() {
    const out = new Float32Array(this.cars.length * 2);
    this.cars.forEach((c, j) => {
      const r = c.route, i = c.i;
      if (i < r.length - 1) {
        const [x0, y0] = this.coords[r[i]], [x1, y1] = this.coords[r[i + 1]];
        out[2 * j] = this.edge_id.get(ek(r[i], r[i + 1]));
        out[2 * j + 1] = Math.atan2(y1 - y0, x1 - x0);
      } else { out[2 * j] = -1; out[2 * j + 1] = NaN; }
    });
    return out;
  }

  /** IDs de exemplo para a UI (existentes, e um que não existe). */
  sample_residents(k = 4) {
    const ids = [], all = [...this.residents.items()];
    for (let i = 0; i < k; i++) ids.push(all[Math.floor((i + 0.5) * all.length / k)][0]);
    return ids;
  }
}
