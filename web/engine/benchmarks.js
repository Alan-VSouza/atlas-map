// Benchmarks no navegador: estruturas próprias vs. alternativas nativas ou ingênuas.
// Mesmas suítes de benchmarks.py, com tamanhos moderados para não pesar no celular.
import { PyRandom, hypot } from "./pycompat.js";
import { ChainingHashTable, OpenAddressingHashTable } from "./hashtable.js";
import { BinaryHeap } from "./heap.js";
import { FenwickTree, SegmentTree } from "./misc.js";
import { AVLTree, SkipList, Trie } from "./trees.js";
import { Graph, astar, shortestPath } from "./graph.js";
import { Quadtree, KDTree } from "./spatial.js";

const now = () => performance.now();
/** Mede em ms; repete trabalhos muito curtos para reduzir ruído do relógio. */
function time(fn) {
  let reps = 0; const t0 = now(); let t = t0;
  do { fn(); reps++; t = now(); } while (t - t0 < 8 && reps < 50);
  return (t - t0) / reps;
}
const range = (n) => Array.from({ length: n }, (_, i) => i);
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const words = (rng, n) => range(n).map(() => { let s = ""; const L = rng.randint(4, 9); for (let i = 0; i < L; i++) s += rng.choice(LETTERS); return s; });
const lt = (a, b) => a < b;

function suiteDictionary(sizes, rng) {
  const res = { "AVL": [], "Skip List": [], "Hash encadeado": [], "Hash aberto (linear)": [], "Hash aberto (duplo)": [], "Map do JS": [] };
  for (const n of sizes) {
    const keys = rng.sample(range(n * 10), n), probes = range(n).map(() => rng.choice(keys));
    const run = (make, put, get) => time(() => { const d = make(); for (const k of keys) put(d, k); for (const k of probes) get(d, k); });
    res["AVL"].push(run(() => new AVLTree(), (d, k) => d.insert(k, k), (d, k) => d.get(k)));
    res["Skip List"].push(run(() => new SkipList(1), (d, k) => d.insert(k, k), (d, k) => d.get(k)));
    res["Hash encadeado"].push(run(() => new ChainingHashTable(), (d, k) => d.put(k, k), (d, k) => d.get(k)));
    res["Hash aberto (linear)"].push(run(() => new OpenAddressingHashTable(8, "linear"), (d, k) => d.put(k, k), (d, k) => d.get(k)));
    res["Hash aberto (duplo)"].push(run(() => new OpenAddressingHashTable(8, "double"), (d, k) => d.put(k, k), (d, k) => d.get(k)));
    res["Map do JS"].push(run(() => new Map(), (d, k) => d.set(k, k), (d, k) => d.get(k)));
  }
  return res;
}

function suitePriorityQueue(sizes, rng) {
  const res = { "Heap binária": [], "Lista + busca do mínimo": [] };
  for (const n of sizes) {
    const vals = range(n).map(() => rng.random());
    res["Heap binária"].push(time(() => { const h = new BinaryHeap({ lt }); for (const v of vals) h.push(v); while (h.length) h.pop(); }));
    // alternativa ingênua: lista ordenada a cada inserção (busca linear do lugar)
    res["Lista + busca do mínimo"].push(time(() => {
      const a = []; for (const v of vals) a.push(v);
      while (a.length) { let mi = 0; for (let i = 1; i < a.length; i++) if (a[i] < a[mi]) mi = i; a[mi] = a[a.length - 1]; a.pop(); }
    }));
  }
  return res;
}

function suitePrefix(sizes, rng) {
  const res = { "Trie (top-5)": [], "Varredura linear": [] };
  for (const n of sizes) {
    const ws = [...new Set(words(rng, n))], trie = new Trie();
    for (const w of ws) trie.insert(w, rng.randint(1, 100));
    const prefixes = range(100).map(() => rng.choice(ws).slice(0, 3));
    res["Trie (top-5)"].push(time(() => { for (const p of prefixes) trie.autocomplete(p, 5); }));
    res["Varredura linear"].push(time(() => { for (const p of prefixes) ws.filter((w) => w.startsWith(p)); }));
  }
  return res;
}

function suiteNearest(sizes, rng) {
  const res = { "Quadtree": [], "KD-Tree": [], "Força bruta": [] };
  for (const n of sizes) {
    const pts = range(n).map((i) => [rng.uniform(0, 1000), rng.uniform(0, 1000), i]);
    const qs = range(200).map(() => [rng.uniform(0, 1000), rng.uniform(0, 1000)]);
    const qt = new Quadtree(0, 0, 1000, 1000); for (const p of pts) qt.insert(...p);
    const kd = new KDTree(pts);
    res["Quadtree"].push(time(() => { for (const [x, y] of qs) qt.nearest(x, y); }));
    res["KD-Tree"].push(time(() => { for (const [x, y] of qs) kd.nearest(x, y); }));
    res["Força bruta"].push(time(() => {
      for (const [x, y] of qs) { let b = null, bd = Infinity; for (const p of pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; b = p; } } void b; }
    }));
  }
  return res;
}

function suiteRangeSum(sizes, rng) {
  const res = { "Fenwick": [], "Segment Tree": [], "Soma ingênua": [] };
  for (const n of sizes) {
    const data = range(n).map(() => rng.randint(0, 100));
    const qs = range(500).map(() => { const a = rng.randrange(n), b = rng.randrange(n); return a < b ? [a, b + 1] : [b, a + 1]; });
    const ups = range(500).map(() => [rng.randrange(n), rng.randint(0, 100)]);
    res["Fenwick"].push(time(() => { const f = new FenwickTree(data); for (const [i, v] of ups) f.add(i, v); for (const [l, r] of qs) f.rangeSum(l, r); }));
    res["Segment Tree"].push(time(() => { const s = new SegmentTree(data); for (const [i, v] of ups) s.update(i, v); for (const [l, r] of qs) s.query(l, r); }));
    res["Soma ingênua"].push(time(() => { const a = data.slice(); for (const [i, v] of ups) a[i] = v; for (const [l, r] of qs) { let s = 0; for (let i = l; i < r; i++) s += a[i]; } }));
  }
  return res;
}

function suiteShortestPath(sizes, rng) {
  const res = { "Dijkstra": [], "A*": [] }, work = { "Dijkstra (nós assentados)": [], "A* (nós expandidos)": [] };
  for (const n of sizes) {
    const side = Math.max(3, Math.floor(Math.sqrt(n))), g = new Graph(side * side);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const u = y * side + x;
      if (x + 1 < side) g.addEdge(u, u + 1, 1.0 + rng.random() * 0.3);
      if (y + 1 < side) g.addEdge(u, u + side, 1.0 + rng.random() * 0.3);
    }
    const h = (u, t) => hypot((u % side) - (t % side), Math.floor(u / side) - Math.floor(t / side));
    const pairs = range(20).map(() => [rng.randrange(side * side), rng.randrange(side * side)]);
    let st = 0, ex = 0;
    for (const [s, t] of pairs) { st += shortestPath(g, s, t)[2]; ex += astar(g, s, t, h)[2]; }
    res["Dijkstra"].push(time(() => { for (const [s, t] of pairs) shortestPath(g, s, t); }));
    res["A*"].push(time(() => { for (const [s, t] of pairs) astar(g, s, t, h); }));
    work["Dijkstra (nós assentados)"].push(st / pairs.length);
    work["A* (nós expandidos)"].push(ex / pairs.length);
  }
  return [res, work];
}

function avlHeight(sizes, rng) {
  return sizes.map((n) => {
    const t = new AVLTree(); for (const k of rng.sample(range(n * 10), n)) t.insert(k);
    return { n, height: t.height(), log2n: Math.round(Math.log2(n) * 100) / 100, limite: Math.round(1.44 * Math.log2(n + 2) * 100) / 100, rotacoes: t.rotations };
  });
}

export const DEFAULT_SIZES = [1000, 2000, 4000, 8000];

/** Roda todas as suítes. `onProgress(i, total, nome)` é chamado entre suítes. */
export function runBenchmarks(sizes = DEFAULT_SIZES, seed = 7, onProgress = () => {}) {
  const rng = new PyRandom(seed), t0 = now();
  const steps = [
    ["Dicionário (inserir n + buscar n)", () => suiteDictionary(sizes, rng)],
    ["Fila de prioridade (inserir n + remover n)", () => suitePriorityQueue(sizes, rng)],
    ["Busca por prefixo (100 consultas)", () => suitePrefix(sizes, rng)],
    ["Vizinho mais próximo (200 consultas)", () => suiteNearest(sizes, rng)],
    ["Soma em intervalo (500 atualizações + 500 consultas)", () => suiteRangeSum(sizes, rng)],
  ];
  // aquecimento do JIT com um tamanho pequeno (descartado), para a 1ª coluna não sair inflada
  { const w = new PyRandom(1); suiteDictionary([300], w); suitePriorityQueue([300], w);
    suitePrefix([300], w); suiteNearest([300], w); suiteRangeSum([300], w); suiteShortestPath([300], w); }
  const suites = {};
  steps.forEach(([name, fn], i) => { onProgress(i, steps.length + 1, name); suites[name] = fn(); });
  onProgress(steps.length, steps.length + 1, "Menor caminho em grade");
  const [sp, work] = suiteShortestPath(sizes, rng);
  suites["Menor caminho em grade (20 pares)"] = sp;
  return { sizes, unit: "ms", suites, work: { "Trabalho médio por consulta (grade)": work },
    avl_height: avlHeight(sizes, rng), elapsed_ms: Math.round(now() - t0) };
}
