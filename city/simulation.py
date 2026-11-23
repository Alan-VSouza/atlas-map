"""Motor de simulação da cidade ATLAS.

Cada subsistema é movido por uma estrutura de dados da ds_lib:

  malha viária ........ Graph + Dijkstra/A* (heap), Union-Find, Kruskal
  chamados ............ BinaryHeap (prioridade por gravidade)
  ambulâncias ......... Quadtree (candidatas mais próximas) + KDTree (hospital)
  cache de rotas ...... LRUCache (lista dupla + hash)
  moradores ........... AVL + Bloom Filter
  ruas ................ Trie (autocomplete) + Levenshtein ("você quis dizer")
  tráfego ............. Segment Tree, Fenwick Tree, Count-Min Sketch
  rotas x trânsito .... pesos dinâmicos: rua lenta/intensa custa mais no Dijkstra
  desfazer/refazer .... Stack
  linha do tempo ...... DoublyLinkedList + Huffman (compressão do log)
"""

import math
import random

from ds_lib import (
    AVLTree, BinaryHeap, BloomFilter, ChainingHashTable, CountMinSketch,
    DoublyLinkedList, FenwickTree, Graph, HuffmanCodec, KDTree, LRUCache,
    Quadtree, SegmentTree, Stack, Trie, UnionFind, astar, connected_components,
    kruskal, levenshtein, shortest_path, INF,
)

FIRST = ["Ana", "Bruno", "Carla", "Daniel", "Eduarda", "Felipe", "Gabriela", "Hugo",
         "Isabela", "João", "Karina", "Lucas", "Marina", "Nicolas", "Olívia", "Pedro",
         "Quitéria", "Rafael", "Sofia", "Tiago", "Úrsula", "Vitor", "Wesley", "Yasmin"]
LAST = ["Silva", "Souza", "Oliveira", "Santos", "Lima", "Pereira", "Costa", "Rodrigues",
        "Almeida", "Nascimento", "Carvalho", "Gomes", "Martins", "Araújo", "Ribeiro",
        "Barbosa", "Rocha", "Dias", "Moreira", "Cardoso"]
STREETS = ["das Flores", "Sete de Setembro", "Tiradentes", "XV de Novembro", "Santos Dumont",
           "Dom Pedro II", "Getúlio Vargas", "Rui Barbosa", "Bandeirantes", "Paulista",
           "Santa Cruz", "São Carlos", "do Brasil", "da Independência", "Marechal Deodoro",
           "Castro Alves", "Machado de Assis", "Carlos Gomes", "Ipiranga", "Augusta",
           "Anhanguera", "Brigadeiro Luís", "Saldanha Marinho", "Voluntários da Pátria",
           "Quintino Bocaiúva", "José Bonifácio", "da Consolação", "Lavras"]


# Trânsito: a cada TRAFFIC_WINDOW ticks mede a ocupação média de cada rua
# (carros por 100 unidades) e classifica em livre / lenta / intensa.
# Com traffic_routing ligado, o peso da rua no grafo vira peso0 * fator do nível.
TRAFFIC_WINDOW = 10
TRAFFIC_SLOW, TRAFFIC_JAM = 2.3, 3.2
TRAFFIC_FACTOR = (1.0, 1.6, 2.5)


def _ek(u, v):
    return (u, v) if u < v else (v, u)


class City:
    def __init__(self, seed=42, width=12, height=8, n_cars=60, n_residents=2000,
                 n_hospitals=3, n_ambulances=3, emergency_rate=0.05, traffic_routing=True):
        if width < 3 or height < 3:
            raise ValueError("a cidade precisa de pelo menos 3x3 cruzamentos")
        self.seed = seed
        self.rng = random.Random(seed)
        self.W, self.H = width, height
        self.n = width * height
        self.tick_n = 0
        self.version = 0
        self.emergency_rate = emergency_rate

        self._build_map()
        self._build_streets()
        self._build_residents(n_residents)
        self._build_services(n_hospitals, n_ambulances)

        # estruturas de estado
        self.route_cache = LRUCache(128)
        self.cms = CountMinSketch(256, 4)
        self.pq = BinaryHeap()                      # (-gravidade, criado, id)
        self.emergencies = ChainingHashTable()      # id -> dict
        self._next_eid = 1
        self.undo_stack, self.redo_stack = Stack(), Stack()
        self.timeline = DoublyLinkedList()          # eventos (mais novo na frente)
        self.RING = 256
        self.thr_sum = SegmentTree([0] * self.RING)                       # vazão por tick
        self.thr_max = SegmentTree([0] * self.RING, op=max, identity=0)   # pico
        self.resolved_bit = FenwickTree(self.RING)                        # atendimentos
        self._huff_cache = (-1, 1.0, 0)
        self.stats = {"spawned": 0, "resolved": 0, "unreachable": 0,
                      "resp_sum": 0, "resp_n": 0, "arrivals": 0}
        self._arrivals_tick = 0
        self.traffic_routing = bool(traffic_routing)
        self.traffic_level = [0] * len(self.edge_list)
        self._occ_sum = [0] * len(self.edge_list)
        self.traffic_updates = 0

        self._recompute_topology()
        self.cars = [self._new_car(i) for i in range(n_cars)]
        self._rebuild_car_index()
        self.log("Cidade criada (seed=%d, %dx%d)" % (seed, width, height))

    # ------------------------------------------------------------------ mapa
    def _build_map(self):
        rng, W, H = self.rng, self.W, self.H
        self.coords = []
        for y in range(H):
            for x in range(W):
                self.coords.append((x * 100 + rng.uniform(-18, 18), y * 100 + rng.uniform(-18, 18)))
        candidates = []
        for y in range(H):
            for x in range(W):
                u = y * W + x
                if x + 1 < W:
                    candidates.append((u, u + 1))
                if y + 1 < H:
                    candidates.append((u, u + W))
        rng.shuffle(candidates)
        uf = UnionFind(self.n)
        keep = []
        for (u, v) in candidates:  # Kruskal aleatório garante conectividade
            if uf.union(u, v):
                keep.append((u, v))
            elif rng.random() < 0.88:
                keep.append((u, v))
        keep.sort()
        self.g = Graph(self.n)
        self.g0 = Graph(self.n)   # mesma malha sem trânsito (para comparar a rota)
        self.length, self.weight0 = {}, {}
        self.edge_list, self.edge_id = [], {}
        for (u, v) in keep:
            (x0, y0), (x1, y1) = self.coords[u], self.coords[v]
            ln = math.hypot(x1 - x0, y1 - y0)
            w = ln * (1.0 + rng.random() * 0.4)
            self.g.add_edge(u, v, w)
            self.g0.add_edge(u, v, w)
            k = _ek(u, v)
            self.length[k] = ln
            self.weight0[k] = w
            self.edge_id[k] = len(self.edge_list)
            self.edge_list.append(k)
        self.closed = set()

    def _build_streets(self):
        rng = self.rng
        need = self.W + self.H
        names = list(STREETS)
        rng.shuffle(names)
        while len(names) < need:
            names.append("Projetada %d" % (len(names) + 1))
        self.row_name = ["Rua " + names[i] for i in range(self.H)]
        self.col_name = ["Av. " + names[self.H + i] for i in range(self.W)]
        self.edge_street = {}
        for (u, v) in self.edge_list:
            if v == u + 1:
                self.edge_street[(u, v)] = self.row_name[u // self.W]
            else:
                self.edge_street[(u, v)] = self.col_name[u % self.W]
        self.trie = Trie()
        self.street_display = ChainingHashTable()
        for name in self.row_name + self.col_name:
            low = name.lower()
            self.trie.insert(low, rng.randint(1, 50))
            self.street_display.put(low, name)
        self.street_words = [n.lower() for n in self.row_name + self.col_name]

    def _build_residents(self, count):
        rng = self.rng
        self.residents = AVLTree()
        self.bloom = BloomFilter.from_capacity(max(1, count), 0.01)
        ids = rng.sample(range(100000, 100000 + count * 5), count)
        for rid in ids:
            rec = {"id": rid,
                   "name": "%s %s" % (rng.choice(FIRST), rng.choice(LAST)),
                   "home": rng.randrange(self.n)}
            self.residents.insert(rid, rec)
            self.bloom.add(rid)
        self.bloom_skips = 0

    def _build_services(self, n_hospitals, n_ambulances):
        rng = self.rng
        self.hospitals = sorted(rng.sample(range(self.n), min(n_hospitals, self.n)))
        self.hospital_index = KDTree([(self.coords[h][0], self.coords[h][1], h) for h in self.hospitals])
        self.ambulances = []
        for i in range(n_ambulances):
            node = self.hospitals[i % len(self.hospitals)]
            self.ambulances.append({"id": i, "node": node, "state": "idle", "route": [node],
                                    "i": 0, "frac": 0.0, "dest": node, "eid": None,
                                    "version": 0, "speed": 55.0})
        xs = [c[0] for c in self.coords]
        ys = [c[1] for c in self.coords]
        self.bounds = (min(xs) - 20, min(ys) - 20, max(xs) + 20, max(ys) + 20)

    # ------------------------------------------------------------- topologia
    def _recompute_topology(self):
        self.comp, self.ncomp = connected_components(self.g)
        self.mst_edges, self.mst_total = kruskal(self.g)

    def _bump_version(self):
        self.version += 1
        self._recompute_topology()

    # -------------------------------------------------------------- trânsito
    def _eff_weight(self, k):
        if not self.traffic_routing:
            return self.weight0[k]
        return self.weight0[k] * TRAFFIC_FACTOR[self.traffic_level[self.edge_id[k]]]

    def _update_traffic(self):
        """Soma a ocupação de cada rua; a cada janela reclassifica e ajusta os pesos."""
        occ = self._occ_sum
        for car in self.cars:
            r, i = car["route"], car["i"]
            if i < len(r) - 1:
                occ[self.edge_id[_ek(r[i], r[i + 1])]] += 1
        if (self.tick_n + 1) % TRAFFIC_WINDOW:
            return
        changed = 0
        for e, k in enumerate(self.edge_list):
            dens = occ[e] / TRAFFIC_WINDOW * 100 / self.length[k]
            lvl = 0 if dens < TRAFFIC_SLOW else (1 if dens < TRAFFIC_JAM else 2)
            occ[e] = 0
            if lvl != self.traffic_level[e]:
                self.traffic_level[e] = lvl
                changed += 1
                if self.traffic_routing and k not in self.closed:
                    self.g.set_weight(k[0], k[1], self._eff_weight(k))
        if changed and self.traffic_routing:
            self.traffic_updates += 1
            self._bump_version()   # rotas antigas do cache deixam de valer; carros recalculam

    def set_traffic_routing(self, on):
        """Liga/desliga o efeito do trânsito nas rotas (reaplica os pesos)."""
        on = bool(on)
        if on == self.traffic_routing:
            return False
        self.traffic_routing = on
        for k in self.edge_list:
            if k not in self.closed:
                self.g.set_weight(k[0], k[1], self._eff_weight(k))
        self._bump_version()
        self.log("Rotas %s o trânsito" % ("consideram" if on else "ignoram"))
        return True

    # ---------------------------------------------------------------- rotas
    def _h(self, u, t):
        (x0, y0), (x1, y1) = self.coords[u], self.coords[t]
        return math.hypot(x1 - x0, y1 - y0)

    def _route_full(self, src, dst):
        """(custo, caminho) via cache LRU + Dijkstra; None se inalcançável."""
        if src == dst:
            return 0.0, [src]
        key = (src, dst, self.version)
        hit = self.route_cache.get(key)
        if hit is not None:
            return hit
        cost, path, _ = shortest_path(self.g, src, dst)
        if cost == INF:
            return None
        self.route_cache.put(key, (cost, path))
        return cost, path

    def _route(self, src, dst):
        r = self._route_full(src, dst)
        return None if r is None else r[1]

    def route_query(self, src, dst):
        """Consulta de rota para a UI, comparando Dijkstra e A*."""
        if not (0 <= src < self.n and 0 <= dst < self.n):
            raise ValueError("nó inválido")
        key = (src, dst, self.version)
        cached = key in self.route_cache
        d_cost, d_path, d_settled = shortest_path(self.g, src, dst)
        a_cost, a_path, a_expanded = astar(self.g, src, dst, self._h)
        if d_cost != INF:
            self.route_cache.put(key, (d_cost, d_path))
        # o mesmo pedido sem trânsito: mostra o caminho que o trânsito fez evitar
        if self.traffic_routing:
            f_cost, f_path, _ = shortest_path(self.g0, src, dst)
        else:
            f_cost, f_path = d_cost, d_path
        f_now = None
        if f_cost != INF:
            f_now = sum(self.g.weight(a, b) for a, b in zip(f_path, f_path[1:]))
        return {"src": src, "dst": dst, "found": d_cost != INF,
                "free_cost": None if f_cost == INF else round(f_cost, 2),
                "free_path": f_path,
                "free_cost_now": None if f_now is None else round(f_now, 2),
                "cost": None if d_cost == INF else round(d_cost, 2),
                "path": d_path, "cached_before": cached,
                "dijkstra_settled": d_settled, "astar_expanded": a_expanded,
                "astar_cost": None if a_cost == INF else round(a_cost, 2),
                "streets": self._streets_of(d_path)}

    def _streets_of(self, path):
        out = []
        for a, b in zip(path, path[1:]):
            name = self.edge_street.get(_ek(a, b))
            if name and (not out or out[-1] != name):
                out.append(name)
        return out

    # ------------------------------------------------------------ entidades
    def _pick_dest(self, node):
        c = self.comp[node]
        options = [i for i in range(self.n) if self.comp[i] == c and i != node]
        return self.rng.choice(options) if options else None

    def _new_car(self, cid):
        # carros fazem o trajeto casa <-> trabalho; as rotas se repetem e o cache LRU rende
        home = self.rng.randrange(self.n)
        work = self.rng.choice([i for i in range(self.n) if i != home])
        car = {"id": cid, "route": [home], "i": 0, "frac": 0.0, "dest": home,
               "home": home, "work": work,
               "version": self.version, "speed": self.rng.uniform(16, 30)}
        self._assign_trip(car, home)
        return car

    def _assign_trip(self, ent, node):
        dest = None
        if "work" in ent:
            cand = ent["work"] if node != ent["work"] else ent["home"]
            if cand != node and self.comp[cand] == self.comp[node]:
                dest = cand
        if dest is None:  # fora do trajeto (ex.: via fechada) ou sem caminho: sorteia outro
            dest = self._pick_dest(node)
        route = self._route(node, dest) if dest is not None else None
        if route is None:
            ent["route"], ent["dest"] = [node], node
        else:
            ent["route"], ent["dest"] = route, dest
        ent["i"], ent["frac"], ent["version"] = 0, 0.0, self.version

    def _advance(self, ent, speed, is_car=False):
        remaining = speed
        while remaining > 1e-9 and ent["i"] < len(ent["route"]) - 1:
            route = ent["route"]
            u, v = route[ent["i"]], route[ent["i"] + 1]
            length = self.length[_ek(u, v)]
            left = length * (1.0 - ent["frac"])
            if remaining >= left:
                remaining -= left
                ent["i"] += 1
                ent["frac"] = 0.0
                self.cms.add(_ek(u, v))
                if is_car:
                    self._arrivals_tick += 1
                    self.stats["arrivals"] += 1
                if ent["i"] < len(route) - 1 and ent["version"] != self.version:
                    ent["version"] = self.version
                    newr = self._route(v, ent["dest"])
                    if newr is None:
                        ent["route"], ent["i"], ent["dest"] = [v], 0, v
                        break
                    ent["route"], ent["i"] = newr, 0
            else:
                ent["frac"] += remaining / length
                remaining = 0.0

    def _pos(self, ent):
        r, i = ent["route"], ent["i"]
        if i >= len(r) - 1:
            return self.coords[r[-1]]
        (x0, y0), (x1, y1) = self.coords[r[i]], self.coords[r[i + 1]]
        f = ent["frac"]
        return (x0 + (x1 - x0) * f, y0 + (y1 - y0) * f)

    def _rebuild_car_index(self):
        b = self.bounds
        self.car_qt = Quadtree(b[0], b[1], b[2], b[3], capacity=4)
        for c in self.cars:
            x, y = self._pos(c)
            self.car_qt.insert(x, y, c["id"])

    # ----------------------------------------------------------- emergências
    def add_emergency(self, node, severity):
        if not (0 <= node < self.n):
            raise ValueError("nó inválido")
        if not (1 <= severity <= 5):
            raise ValueError("gravidade deve estar entre 1 e 5")
        eid = self._next_eid
        self._next_eid += 1
        self.emergencies.put(eid, {"id": eid, "node": node, "severity": severity,
                                   "created": self.tick_n, "state": "waiting",
                                   "ambulance": None})
        self.pq.push((-severity, self.tick_n, eid))
        self.stats["spawned"] += 1
        self.log("Chamado #%d (gravidade %d) no nó %d" % (eid, severity, node))
        return eid

    def _dispatch(self):
        idle = [a for a in self.ambulances if a["state"] == "idle"]
        if not idle or not len(self.pq):
            return
        b = self.bounds
        qt = Quadtree(b[0], b[1], b[2], b[3], capacity=2)
        for a in idle:
            x, y = self.coords[a["node"]]
            qt.insert(x, y, a["id"])
        while len(qt) and len(self.pq):
            _, _, eid = self.pq.pop()
            e = self.emergencies.get(eid)
            ex, ey = self.coords[e["node"]]
            best = None
            for (_d2, px, py, aid) in qt.nearest(ex, ey, k=min(3, len(qt))):
                amb = self.ambulances[aid]
                r = self._route_full(amb["node"], e["node"])
                if r is not None and (best is None or r[0] < best[0]):
                    best = (r[0], r[1], aid, px, py)
            if best is None:
                e["state"] = "unreachable"
                self.stats["unreachable"] += 1
                self.log("Chamado #%d inalcançável" % eid)
                continue
            _, path, aid, px, py = best
            qt.remove(px, py, aid)
            amb = self.ambulances[aid]
            amb.update(state="to_scene", route=path, i=0, frac=0.0, dest=e["node"],
                       eid=eid, version=self.version)
            e["state"], e["ambulance"], e["dispatched"] = "assigned", aid, self.tick_n
            self.log("Ambulância %d -> chamado #%d" % (aid, eid))

    def _step_ambulances(self):
        for a in self.ambulances:
            if a["state"] == "idle":
                continue
            self._advance(a, a["speed"])
            if a["i"] < len(a["route"]) - 1:
                continue
            node = a["route"][-1]
            e = self.emergencies.get(a["eid"])
            if a["state"] == "to_scene" and node != e["node"]:
                # a rota até o chamado foi cortada (via fechada) e não há caminho
                e["state"] = "unreachable"
                self.stats["unreachable"] += 1
                self.log("Chamado #%d ficou inalcançável" % e["id"])
                a.update(state="idle", node=node, route=[node], i=0, frac=0.0, dest=node, eid=None)
            elif a["state"] == "to_scene":
                e["state"], e["arrived"] = "transport", self.tick_n
                self.stats["resp_sum"] += self.tick_n - e["created"]
                self.stats["resp_n"] += 1
                x, y = self.coords[node]
                target = None
                for (_d2, _px, _py, h) in self.hospital_index.nearest(x, y, k=len(self.hospitals)):
                    r = self._route_full(node, h)
                    if r is not None:
                        target = (h, r[1])
                        break
                if target is None:
                    self._finish(a, e, node)
                else:
                    a.update(state="to_hospital", route=target[1], i=0, frac=0.0,
                             dest=target[0], version=self.version)
            else:
                self._finish(a, e, node)

    def _finish(self, a, e, node):
        e["state"], e["done"] = "done", self.tick_n
        self.stats["resolved"] += 1
        self.resolved_bit.add(self.tick_n % self.RING, 1)
        self.log("Chamado #%d atendido (ambulância %d)" % (e["id"], a["id"]))
        a.update(state="idle", node=node, route=[node], i=0, frac=0.0, dest=node, eid=None)

    # ------------------------------------------------------------------ tick
    def tick(self):
        if self.rng.random() < self.emergency_rate:
            sev = self.rng.choices([1, 2, 3, 4, 5], weights=[5, 4, 3, 2, 1])[0]
            self.add_emergency(self.rng.randrange(self.n), sev)
        self._dispatch()
        self._step_ambulances()
        self._arrivals_tick = 0
        for car in self.cars:
            if car["i"] >= len(car["route"]) - 1:
                self._assign_trip(car, car["route"][-1])
            self._advance(car, car["speed"], is_car=True)
        self._update_traffic()
        slot = self.tick_n % self.RING
        self.thr_sum.update(slot, self._arrivals_tick)
        self.thr_max.update(slot, self._arrivals_tick)
        self._rebuild_car_index()
        self.tick_n += 1

    def run(self, ticks):
        for _ in range(ticks):
            self.tick()

    def _ring_query(self, tree, k):
        """Consulta nos últimos k ticks (anel circular com 2 consultas se der a volta)."""
        k = min(k, self.tick_n if self.tick_n else 1)
        end = (self.tick_n - 1) % self.RING if self.tick_n else 0   # último tick gravado
        start = end - k + 1
        if start >= 0:
            return tree.query(start, end + 1)
        return tree.op(tree.query(0, end + 1), tree.query(self.RING + start, self.RING))

    # ---------------------------------------------------------- ações do mapa
    def close_road(self, u, v, _record=True):
        k = _ek(u, v)
        if k not in self.edge_id or k in self.closed:
            return False
        w = self.g.remove_edge(u, v)
        if w is None:
            return False
        self.g0.remove_edge(u, v)
        self.closed.add(k)
        if _record:
            self.undo_stack.push(("close", k))
            self.redo_stack.clear()
        self._bump_version()
        self.log("Via fechada: %s (%d-%d) | ilhas: %d" % (self.edge_street[k], k[0], k[1], self.ncomp))
        return True

    def open_road(self, u, v, _record=True):
        k = _ek(u, v)
        if k not in self.closed:
            return False
        self.closed.discard(k)
        self.g.add_edge(k[0], k[1], self._eff_weight(k))
        self.g0.add_edge(k[0], k[1], self.weight0[k])
        if _record:
            self.undo_stack.push(("open", k))
            self.redo_stack.clear()
        self._bump_version()
        self.log("Via reaberta: %s (%d-%d)" % (self.edge_street[k], k[0], k[1]))
        return True

    def undo(self):
        if self.undo_stack.is_empty():
            return False
        kind, k = self.undo_stack.pop()
        (self.open_road if kind == "close" else self.close_road)(k[0], k[1], _record=False)
        self.redo_stack.push((kind, k))
        return True

    def redo(self):
        if self.redo_stack.is_empty():
            return False
        kind, k = self.redo_stack.pop()
        (self.close_road if kind == "close" else self.open_road)(k[0], k[1], _record=False)
        self.undo_stack.push((kind, k))
        return True

    # ------------------------------------------------------------- consultas
    def autocomplete(self, prefix, k=6):
        p = prefix.lower()
        comps = [{"name": self.street_display.get(w, w), "weight": wt}
                 for (w, wt) in self.trie.autocomplete(p, k)]
        out = {"prefix": prefix, "path": self.trie.path(p), "completions": comps, "suggestions": []}
        if not comps and p:
            heap = BinaryHeap(key=lambda t: t[0], max_heap=True)
            for w in self.street_words:
                # distância entre o que foi digitado e o início da rua (mesmo tamanho)
                d = levenshtein(p, w[:len(p)])
                heap.push((d, w))
                if len(heap) > 3:
                    heap.pop()
            best = []
            while len(heap):
                best.append(heap.pop())
            best.reverse()
            out["suggestions"] = [{"name": self.street_display.get(w, w), "distance": d}
                                  for d, w in best if d <= max(2, len(p) // 2)]
        return out

    def lookup_resident(self, rid):
        if rid not in self.bloom:
            self.bloom_skips += 1
            return {"id": rid, "found": False, "bloom_maybe": False, "comparisons": 0,
                    "resident": None}
        before = self.residents.comparisons
        rec = self.residents.get(rid)
        return {"id": rid, "found": rec is not None, "bloom_maybe": True,
                "comparisons": self.residents.comparisons - before, "resident": rec}

    def residents_range(self, lo, hi, limit=20):
        items = self.residents.range(lo, hi)
        return {"lo": lo, "hi": hi, "count": len(items),
                "residents": [v for _, v in items[:limit]]}

    def hot_roads(self, k=5):
        heap = BinaryHeap(key=lambda t: t[0])
        for e in self.edge_list:
            est = self.cms.estimate(e)
            if est == 0:
                continue
            heap.push((est, e))
            if len(heap) > k:
                heap.pop()
        out = []
        while len(heap):
            out.append(heap.pop())
        out.reverse()
        return [{"edge": self.edge_id[e], "street": self.edge_street[e], "count": c} for c, e in out]

    def log(self, msg):
        self.timeline.push_front(self.tick_n, msg)
        if len(self.timeline) > 300:
            self.timeline.pop_back()

    def _huffman_stats(self):
        if self.tick_n - self._huff_cache[0] < 25 and self._huff_cache[0] >= 0:
            return self._huff_cache[1], self._huff_cache[2]
        text = "\n".join("t%d %s" % (n.key, n.value) for n in self.timeline)
        codec = HuffmanCodec().fit(text)
        ratio = codec.compression_ratio(text)
        self._huff_cache = (self.tick_n, ratio, len(text))
        return ratio, len(text)

    # ----------------------------------------------------------------- JSON
    def map_json(self):
        return {"W": self.W, "H": self.H, "bounds": list(self.bounds),
                "nodes": [[round(x, 1), round(y, 1)] for x, y in self.coords],
                "edges": [{"id": i, "u": u, "v": v, "name": self.edge_street[(u, v)]}
                          for i, (u, v) in enumerate(self.edge_list)],
                "hospitals": self.hospitals, "seed": self.seed,
                "rows": self.row_name, "cols": self.col_name}

    def state_json(self):
        cars = []
        for c in self.cars:
            x, y = self._pos(c)
            cars.append([round(x, 1), round(y, 1), c["id"]])
        ambs = []
        for a in self.ambulances:
            x, y = self._pos(a)
            ahead = a["route"][a["i"] + 1:] if a["state"] != "idle" else []
            ambs.append({"id": a["id"], "x": round(x, 1), "y": round(y, 1),
                         "state": a["state"], "eid": a["eid"], "route": ahead, "dest": a["dest"]})
        active = []
        for _, e in self.emergencies.items():
            if e["state"] in ("waiting", "assigned", "transport"):
                active.append({"id": e["id"], "node": e["node"], "severity": e["severity"],
                               "state": e["state"], "created": e["created"]})
        active.sort(key=lambda e: e["id"])
        heap_arr = [{"id": eid, "severity": -s, "created": cr,
                     "node": self.emergencies.get(eid)["node"]}
                    for (s, cr, eid) in self.pq.to_list()]
        ratio, raw = self._huffman_stats()
        st = self.stats
        resp = (st["resp_sum"] / st["resp_n"]) if st["resp_n"] else None
        rc = self.route_cache
        return {
            "tick": self.tick_n, "version": self.version,
            "cars": cars, "ambulances": ambs, "emergencies": active,
            "heap": heap_arr,
            "closed": sorted(self.edge_id[k] for k in self.closed),
            "comp": self.comp, "ncomp": self.ncomp,
            "mst": {"edges": [self.edge_id[_ek(u, v)] for u, v, _ in self.mst_edges],
                    "total": round(self.mst_total, 1)},
            "lru": {"keys": ["%d→%d (v%d)" % k for k in rc.keys_mru_first()][:12],
                    "size": len(rc), "capacity": rc.capacity, "hits": rc.hits,
                    "misses": rc.misses, "evictions": rc.evictions,
                    "hit_rate": round(rc.hit_rate(), 3)},
            "quadtree": [list(r) for r in self.car_qt.rects()],
            "stats": {"spawned": st["spawned"], "resolved": st["resolved"],
                      "unreachable": st["unreachable"],
                      "avg_response_ticks": None if resp is None else round(resp, 1),
                      "waiting": len(self.pq)},
            "traffic": {"last60": self._ring_query(self.thr_sum, 60),
                        "peak60": self._ring_query(self.thr_max, 60),
                        "resolved_total": self.resolved_bit.prefix(self.RING)},
            "hot_roads": self.hot_roads(5),
            "traffic_levels": list(self.traffic_level),
            "traffic_routing": self.traffic_routing,
            "traffic_updates": self.traffic_updates,
            "undo": len(self.undo_stack), "redo": len(self.redo_stack),
            "log": ["t%d  %s" % (n.key, n.value) for n in list(self.timeline)[:14]],
            "huffman": {"ratio": round(ratio, 3), "raw_chars": raw},
            "avl": {"size": len(self.residents), "height": self.residents.height(),
                    "rotations": self.residents.rotations},
            "bloom": {"bits": self.bloom.m, "hashes": self.bloom.k,
                      "est_fp": round(self.bloom.estimated_fp_rate(), 4),
                      "skips": self.bloom_skips},
            "trie": {"words": len(self.trie), "nodes": self.trie.node_count},
        }
