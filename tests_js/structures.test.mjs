// Estruturas JS contra referências de força bruta (operações aleatórias de semente fixa).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PyRandom } from "../web/engine/pycompat.js";
import { ChainingHashTable, OpenAddressingHashTable } from "../web/engine/hashtable.js";
import { BinaryHeap, IndexedPriorityQueue } from "../web/engine/heap.js";
import { Stack, Deque, DoublyLinkedList } from "../web/engine/linear.js";
import { BloomFilter, CountMinSketch, LRUCache, SegmentTree, FenwickTree, SparseTable, levenshtein, kmpSearch, HuffmanCodec } from "../web/engine/misc.js";
import { AVLTree, SkipList, Trie } from "../web/engine/trees.js";
import { Graph, INF, dijkstra, astar, floydWarshall, bellmanFord, UnionFind, kruskal, tarjanScc, connectedComponents, topologicalSort } from "../web/engine/graph.js";
import { Quadtree, KDTree } from "../web/engine/spatial.js";

const rng = new PyRandom(2024);

test("hash encadeado e aberto se comportam como Map", () => {
  for (const make of [() => new ChainingHashTable(), () => new OpenAddressingHashTable(8, "linear"),
    () => new OpenAddressingHashTable(8, "quadratic"), () => new OpenAddressingHashTable(8, "double")]) {
    const t = make(), ref = new Map();
    for (let i = 0; i < 3000; i++) {
      const k = rng.randrange(500), op = rng.random();
      if (op < 0.5) { t.put(k, i); ref.set(k, i); }
      else if (op < 0.75) assert.equal(t.remove(k), ref.delete(k));
      else assert.equal(t.get(k), ref.get(k));
      assert.equal(t.length, ref.size);
    }
    assert.deepEqual(new Map([...t.items()]), ref);
  }
});

test("heap binária ordena como sort; fila indexada aceita update", () => {
  const h = new BinaryHeap(), vals = Array.from({ length: 2000 }, () => rng.random());
  vals.forEach((v) => h.push(v));
  assert.ok(h.isValid());
  const out = []; while (h.length) out.push(h.pop());
  assert.deepEqual(out, [...vals].sort((a, b) => a - b));
  const mx = new BinaryHeap({ max: true, items: [3, 1, 4, 1, 5, 9, 2, 6] });
  assert.equal(mx.pop(), 9);
  const q = new IndexedPriorityQueue();
  for (let i = 0; i < 50; i++) q.push("n" + i, rng.random());
  q.update("n7", -1); q.remove("n3");
  assert.equal(q.pop()[0], "n7");
  assert.throws(() => new BinaryHeap().pop());
});

test("pilha, deque e lista dupla", () => {
  const s = new Stack(); for (let i = 0; i < 100; i++) s.push(i);
  for (let i = 99; i >= 0; i--) assert.equal(s.pop(), i);
  assert.ok(s.isEmpty());
  const d = new Deque(2), ref = [];
  for (let i = 0; i < 500; i++) {
    const r = rng.random();
    if (r < 0.3) { d.pushBack(i); ref.push(i); } else if (r < 0.6) { d.pushFront(i); ref.unshift(i); }
    else if (ref.length && r < 0.8) assert.equal(d.popFront(), ref.shift());
    else if (ref.length) assert.equal(d.popBack(), ref.pop());
  }
  assert.deepEqual(d.toList(), ref);
  const l = new DoublyLinkedList(); const a = l.pushBack(1); l.pushBack(2); l.pushBack(3); l.moveToFront(l.tail.prev);
  assert.deepEqual(l.toList().map((x) => x[0]), [3, 1, 2]); l.remove(a);
  assert.deepEqual(l.toList().map((x) => x[0]), [3, 2]);
});

test("LRU expulsa o menos recente", () => {
  const c = new LRUCache(2); c.put("a", 1); c.put("b", 2); c.get("a"); c.put("c", 3);
  assert.equal(c.get("b"), null); assert.equal(c.get("a"), 1); assert.equal(c.evictions, 1);
  assert.deepEqual(c.keysMruFirst(), ["a", "c"]);
});

test("Bloom sem falso negativo; Count-Min nunca subestima", () => {
  const b = BloomFilter.fromCapacity(1000, 0.01);
  for (let i = 0; i < 1000; i++) b.add(i * 7);
  for (let i = 0; i < 1000; i++) assert.ok(b.has(i * 7));
  let fp = 0; for (let i = 0; i < 5000; i++) if (b.has(10_000_000 + i)) fp++;
  assert.ok(fp / 5000 < 0.03, "taxa de falso positivo " + fp / 5000);
  const cms = new CountMinSketch(64, 4), ref = new Map();
  for (let i = 0; i < 3000; i++) { const k = rng.randrange(200); cms.add(k); ref.set(k, (ref.get(k) || 0) + 1); }
  for (const [k, v] of ref) assert.ok(cms.estimate(k) >= v);
});

test("AVL e Skip List contra array ordenado", () => {
  const t = new AVLTree(), s = new SkipList(3), ref = new Set();
  for (let i = 0; i < 4000; i++) {
    const k = rng.randrange(2000);
    if (rng.random() < 0.7) { t.insert(k, k); s.insert(k, k); ref.add(k); }
    else { assert.equal(t.delete(k), ref.has(k)); assert.equal(s.delete(k), ref.has(k)); ref.delete(k); }
  }
  t.checkInvariants();
  const sorted = [...ref].sort((a, b) => a - b);
  assert.deepEqual([...t.items()].map((x) => x[0]), sorted);
  assert.deepEqual([...s.items()].map((x) => x[0]), sorted);
  assert.ok(t.height() <= 1.44 * Math.log2(ref.size + 2));
  assert.deepEqual(t.range(100, 300).map((x) => x[0]), sorted.filter((k) => k >= 100 && k <= 300));
});

test("Segment, Fenwick e Sparse Table contra soma ingênua", () => {
  const data = Array.from({ length: 300 }, () => rng.randint(0, 100));
  const seg = new SegmentTree(data), fen = new FenwickTree(data), mn = new SparseTable(data);
  for (let q = 0; q < 300; q++) {
    const i = rng.randrange(300), v = rng.randint(0, 100);
    fen.add(i, v - data[i]); seg.update(i, v); data[i] = v;
    let a = rng.randrange(300), b = rng.randrange(300); if (a > b) [a, b] = [b, a];
    const sum = data.slice(a, b + 1).reduce((x, y) => x + y, 0);
    assert.equal(seg.query(a, b + 1), sum); assert.equal(fen.rangeSum(a, b + 1), sum);
  }
  const st = [5, 2, 8, 1, 9]; assert.equal(new SparseTable(st).query(1, 4), 1); assert.ok(mn);
});

test("Trie, Levenshtein, KMP e Huffman", () => {
  const t = new Trie(); ["casa", "casado", "cama", "carro", "dado"].forEach((w, i) => t.insert(w, i + 1));
  assert.deepEqual(t.autocomplete("ca", 2), [["carro", 4], ["cama", 3]]);
  assert.ok(t.delete("casa") && !t.contains("casa") && t.contains("casado"));
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("são", "sao"), 1);
  assert.deepEqual(kmpSearch("aaaa", "aa"), [0, 1, 2]);
  const text = "chamado atendido pela ambulância 2 no cruzamento 17";
  const h = new HuffmanCodec().fit(text);
  assert.equal(h.decode(h.encode(text)), text);
  const codes = [...h.codes.values()];
  for (const a of codes) for (const b of codes) if (a !== b) assert.ok(!b.startsWith(a), "livre de prefixo");
});

test("Dijkstra e A* contra Floyd-Warshall; Kruskal e Union-Find", () => {
  const n = 40, g = new Graph(n), pts = Array.from({ length: n }, () => [rng.uniform(0, 100), rng.uniform(0, 100)]);
  for (let i = 0; i < 120; i++) {
    const u = rng.randrange(n), v = rng.randrange(n);
    if (u !== v) g.addEdge(u, v, Math.hypot(pts[u][0] - pts[v][0], pts[u][1] - pts[v][1]) * (1 + rng.random()));
  }
  const fw = floydWarshall(g), h = (u, t) => Math.hypot(pts[u][0] - pts[t][0], pts[u][1] - pts[t][1]);
  for (let s = 0; s < n; s += 3) {
    const [dist] = dijkstra(g, s);
    for (let t = 0; t < n; t++) {
      assert.ok(Math.abs(dist[t] - fw[s][t]) < 1e-9 || (dist[t] === INF && fw[s][t] === INF));
      const [c] = astar(g, s, t, h);
      assert.ok(Math.abs(c - fw[s][t]) < 1e-9 || (c === INF && fw[s][t] === INF));
    }
  }
  const [labels, k] = connectedComponents(g), [mst] = kruskal(g);
  assert.equal(mst.length, n - k);
  const uf = new UnionFind(n); for (const [u, v] of mst) assert.ok(uf.union(u, v), "sem ciclo");
  assert.equal(new Set(labels).size, k);
  const dg = new Graph(4, true); dg.addEdge(0, 1); dg.addEdge(1, 2); dg.addEdge(2, 0); dg.addEdge(2, 3);
  assert.deepEqual(tarjanScc(dg).map((c) => c.sort()).sort((a, b) => a.length - b.length), [[3], [0, 1, 2]]);
  assert.throws(() => topologicalSort(dg));
  assert.throws(() => bellmanFord(2, [[0, 1, -1], [1, 0, -1]], 0));
});

test("Quadtree e KD-Tree contra vizinho por força bruta", () => {
  const pts = Array.from({ length: 800 }, (_, i) => [rng.uniform(0, 1000), rng.uniform(0, 1000), i]);
  const qt = new Quadtree(0, 0, 1000, 1000); pts.forEach((p) => qt.insert(...p));
  qt.insert(500, 500, "a"); qt.insert(500, 500, "b");
  assert.ok(qt.remove(500, 500, "a") && !qt.remove(500, 500, "a"));
  qt.remove(500, 500, "b");
  const kd = new KDTree(pts);
  for (let i = 0; i < 100; i++) {
    const x = rng.uniform(0, 1000), y = rng.uniform(0, 1000);
    const brute = pts.map((p) => [(p[0] - x) ** 2 + (p[1] - y) ** 2, p[2]]).sort((a, b) => a[0] - b[0]).slice(0, 3).map((p) => p[1]);
    assert.deepEqual(qt.nearest(x, y, 3).map((p) => p[3]), brute);
    assert.deepEqual(kd.nearest(x, y, 3).map((p) => p[3]), brute);
  }
  assert.equal(qt.length, 800);
});

test("search_trace: ordem de visita bate com os contadores da rota", async () => {
  const { City } = await import("../web/engine/city.js");
  const c = new City({ seed: 42, width: 12, height: 8, n_cars: 20 });
  const r = new PyRandom(77);
  for (let i = 0; i < 40; i++) {
    const s = r.randrange(c.n), d = r.randrange(c.n);
    const q = c.route_query(s, d), tr = c.search_trace(s, d);
    assert.equal(tr.dijkstra.length, q.dijkstra_settled);
    assert.equal(tr.astar.length, q.astar_expanded);
    assert.equal(new Set(tr.dijkstra).size, tr.dijkstra.length, "cada nó assentado uma vez");
    assert.equal(tr.dijkstra[0], s); assert.equal(tr.astar[0], s);
    if (q.found) { assert.equal(tr.dijkstra.at(-1), d); assert.equal(tr.astar.at(-1), d); assert.deepEqual(tr.path, q.path); }
  }
});
