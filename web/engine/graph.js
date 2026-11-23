// Grafo (lista de adjacência) e algoritmos: Dijkstra, A*, Bellman-Ford, Floyd-Warshall,
// Union-Find, Kruskal, BFS, DFS, ordenação topológica, Tarjan e componentes conexas.
import { BinaryHeap } from "./heap.js";
import { CircularQueue } from "./linear.js";

export const INF = Infinity;

export class Graph {
  constructor(n, directed = false) {
    this.n = n; this.directed = directed; this.m = 0;
    this.adj = Array.from({ length: n }, () => []);
  }
  addEdge(u, v, w = 1.0) {
    this.adj[u].push([v, w]);
    if (!this.directed && u !== v) this.adj[v].push([u, w]);
    this.m++;
  }
  hasEdge(u, v) { return this.adj[u].some(([x]) => x === v); }
  weight(u, v) {
    let best = null;
    for (const [x, w] of this.adj[u]) if (x === v && (best === null || w < best)) best = w;
    return best;
  }
  /** Muda o peso de u-v (e v-u se não dirigido), mantendo a ordem da lista. */
  setWeight(u, v, w) {
    this.adj[u] = this.adj[u].map(([x, wx]) => [x, x === v ? w : wx]);
    if (!this.directed) this.adj[v] = this.adj[v].map(([x, wx]) => [x, x === u ? w : wx]);
  }
  removeEdge(u, v) {
    const w = this.weight(u, v);
    if (w === null) return null;
    this.adj[u] = this.adj[u].filter((e) => e[0] !== v);
    if (!this.directed) this.adj[v] = this.adj[v].filter((e) => e[0] !== u);
    this.m--;
    return w;
  }
  *edges() {
    for (let u = 0; u < this.n; u++) for (const [v, w] of this.adj[u]) if (this.directed || u <= v) yield [u, v, w];
  }
}

function buildPath(prev, s, t) {
  const path = []; let x = t;
  while (x !== -1) { path.push(x); if (x === s) break; x = prev[x]; }
  path.reverse();
  return path.length && path[0] === s ? path : [];
}

// comparadores de tupla especializados (mesma ordem do Python, mais rápidos)
const lt2 = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]);
const lt3 = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]);

/** Retorna [dist, prev, nósAssentados]. Para cedo se dst for informado.
 *  `visit(u)` (opcional) recebe cada nó na ordem em que é assentado: usado só para animar. */
export function dijkstra(g, src, dst = null, visit = null) {
  const dist = new Array(g.n).fill(INF), prev = new Array(g.n).fill(-1), done = new Uint8Array(g.n);
  dist[src] = 0.0;
  const heap = new BinaryHeap({ lt: lt2 });
  heap.push([0.0, src]);
  let settled = 0;
  while (heap.length) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1; settled++;
    if (visit) visit(u);
    if (u === dst) break;
    for (const [v, w] of g.adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push([nd, v]); }
    }
  }
  return [dist, prev, settled];
}

/** [custo, caminho, assentados]. Custo INF e caminho [] se inalcançável. */
export function shortestPath(g, s, t, visit = null) {
  const [dist, prev, settled] = dijkstra(g, s, t, visit);
  if (dist[t] === INF) return [INF, [], settled];
  return [dist[t], buildPath(prev, s, t), settled];
}

/** A* com heurística h(u, t). Retorna [custo, caminho, expandidos]. */
export function astar(g, s, t, h, visit = null) {
  const dist = new Array(g.n).fill(INF), prev = new Array(g.n).fill(-1), closed = new Uint8Array(g.n);
  dist[s] = 0.0;
  const heap = new BinaryHeap({ lt: lt3 });
  heap.push([h(s, t), 0.0, s]);
  let expanded = 0;
  while (heap.length) {
    const [, d, u] = heap.pop();
    if (closed[u]) continue;
    closed[u] = 1; expanded++;
    if (visit) visit(u);
    if (u === t) return [d, buildPath(prev, s, t), expanded];
    for (const [v, w] of g.adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push([nd + h(v, t), nd, v]); }
    }
  }
  return [INF, [], expanded];
}

export function bellmanFord(n, edges, src) {
  const dist = new Array(n).fill(INF); dist[src] = 0.0;
  for (let it = 0; it < n - 1; it++) {
    let changed = false;
    for (const [u, v, w] of edges) if (dist[u] !== INF && dist[u] + w < dist[v]) { dist[v] = dist[u] + w; changed = true; }
    if (!changed) break;
  }
  for (const [u, v, w] of edges) if (dist[u] !== INF && dist[u] + w < dist[v]) throw new Error("ciclo de peso negativo");
  return dist;
}

export function floydWarshall(g) {
  const n = g.n, d = Array.from({ length: n }, () => new Array(n).fill(INF));
  for (let i = 0; i < n; i++) d[i][i] = 0.0;
  for (const [u, v, w] of g.edges()) {
    if (w < d[u][v]) d[u][v] = w;
    if (!g.directed && w < d[v][u]) d[v][u] = w;
  }
  for (let k = 0; k < n; k++) {
    const dk = d[k];
    for (let i = 0; i < n; i++) {
      const dik = d[i][k]; if (dik === INF) continue;
      const di = d[i];
      for (let j = 0; j < n; j++) { const nd = dik + dk[j]; if (nd < di[j]) di[j] = nd; }
    }
  }
  return d;
}

export class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
    this.components = n;
  }
  find(x) {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== root) { const nx = this.parent[x]; this.parent[x] = root; x = nx; }
    return root;
  }
  union(a, b) {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
    this.components--;
    return true;
  }
}

/** Árvore geradora mínima (floresta se desconexo). Retorna [arestas, custo]. */
export function kruskal(g) {
  const heap = new BinaryHeap({ lt: lt3 });
  for (const [u, v, w] of g.edges()) if (u !== v) heap.push([w, u, v]);
  const uf = new UnionFind(g.n), chosen = []; let total = 0.0;
  while (heap.length) {
    const [w, u, v] = heap.pop();
    if (uf.union(u, v)) { chosen.push([u, v, w]); total += w; }
  }
  return [chosen, total];
}

export function bfs(g, s) {
  const dist = new Array(g.n).fill(-1); dist[s] = 0;
  const q = new CircularQueue(); q.enqueue(s);
  const order = [];
  while (q.length) {
    const u = q.dequeue(); order.push(u);
    for (const [v] of g.adj[u]) if (dist[v] === -1) { dist[v] = dist[u] + 1; q.enqueue(v); }
  }
  return [order, dist];
}

export function dfs(g, s) {
  const seen = new Uint8Array(g.n), order = [], stack = [s];
  while (stack.length) {
    const u = stack.pop();
    if (seen[u]) continue;
    seen[u] = 1; order.push(u);
    const adj = g.adj[u];
    for (let i = adj.length - 1; i >= 0; i--) if (!seen[adj[i][0]]) stack.push(adj[i][0]);
  }
  return order;
}

export function topologicalSort(g) {
  const indeg = new Array(g.n).fill(0);
  for (let u = 0; u < g.n; u++) for (const [v] of g.adj[u]) indeg[v]++;
  const q = new CircularQueue();
  for (let u = 0; u < g.n; u++) if (indeg[u] === 0) q.enqueue(u);
  const order = [];
  while (q.length) {
    const u = q.dequeue(); order.push(u);
    for (const [v] of g.adj[u]) if (--indeg[v] === 0) q.enqueue(v);
  }
  if (order.length !== g.n) throw new Error("o grafo possui ciclo");
  return order;
}

export function tarjanScc(g) {
  const n = g.n, index = new Array(n).fill(-1), low = new Array(n).fill(0), onStack = new Uint8Array(n);
  const stack = [], comps = []; let counter = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const work = [[root, 0]];
    while (work.length) {
      let [v, pi] = work.pop();
      if (pi === 0) { index[v] = low[v] = counter++; stack.push(v); onStack[v] = 1; }
      const adj = g.adj[v]; let descended = false;
      while (pi < adj.length) {
        const w = adj[pi][0]; pi++;
        if (index[w] === -1) { work.push([v, pi]); work.push([w, 0]); descended = true; break; }
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      }
      if (descended) continue;
      if (low[v] === index[v]) {
        const comp = [];
        for (;;) { const w = stack.pop(); onStack[w] = 0; comp.push(w); if (w === v) break; }
        comps.push(comp);
      }
      if (work.length) { const parent = work[work.length - 1][0]; low[parent] = Math.min(low[parent], low[v]); }
    }
  }
  return comps;
}

/** Rótulo de componente (0..k-1) para cada nó, usando Union-Find. Retorna [labels, k]. */
export function connectedComponents(g) {
  const uf = new UnionFind(g.n);
  for (const [u, v] of g.edges()) uf.union(u, v);
  const labels = new Array(g.n).fill(0), ids = new Map();
  for (let i = 0; i < g.n; i++) {
    const r = uf.find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    labels[i] = ids.get(r);
  }
  return [labels, ids.size];
}
