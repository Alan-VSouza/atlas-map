"""Benchmarks: estruturas próprias vs. alternativas ingênuas / da biblioteca padrão.

Uso:
    python3 benchmarks.py            # tamanhos padrão
    python3 benchmarks.py --quick    # rápido
    python3 benchmarks.py --sizes 1000 5000 20000

Gera reports/results.json, reports/report.md e gráficos SVG log-log.
"""

import argparse
import heapq
import json
import math
import os
import random
import time

from ds_lib import (AVLTree, BinaryHeap, ChainingHashTable, FenwickTree, Graph,
                    KDTree, OpenAddressingHashTable, Quadtree, SegmentTree,
                    SkipList, Trie, astar, shortest_path)


def _time(fn):
    t0 = time.perf_counter()
    fn()
    return time.perf_counter() - t0


def _words(rng, n):
    letters = "abcdefghijklmnopqrstuvwxyz"
    return ["".join(rng.choice(letters) for _ in range(rng.randint(4, 9))) for _ in range(n)]


def suite_dictionary(sizes, rng):
    res = {"AVL": [], "SkipList": [], "Hash encadeado": [], "Hash aberto (linear)": [],
           "Hash aberto (duplo)": [], "dict do Python": []}
    for n in sizes:
        keys = rng.sample(range(n * 10), n)
        probes = [rng.choice(keys) for _ in range(n)]

        def run(make, put, get):
            def f():
                d = make()
                for k in keys:
                    put(d, k)
                for k in probes:
                    get(d, k)
            return _time(f)

        res["AVL"].append(run(AVLTree, lambda d, k: d.insert(k, k), lambda d, k: d.get(k)))
        res["SkipList"].append(run(lambda: SkipList(seed=1), lambda d, k: d.insert(k, k), lambda d, k: d.get(k)))
        res["Hash encadeado"].append(run(ChainingHashTable, lambda d, k: d.put(k, k), lambda d, k: d.get(k)))
        res["Hash aberto (linear)"].append(run(lambda: OpenAddressingHashTable(probing="linear"),
                                               lambda d, k: d.put(k, k), lambda d, k: d.get(k)))
        res["Hash aberto (duplo)"].append(run(lambda: OpenAddressingHashTable(probing="double"),
                                              lambda d, k: d.put(k, k), lambda d, k: d.get(k)))
        res["dict do Python"].append(run(dict, lambda d, k: d.__setitem__(k, k), lambda d, k: d.get(k)))
    return res


def suite_priority_queue(sizes, rng):
    res = {"BinaryHeap": [], "heapq (C)": []}
    for n in sizes:
        vals = [rng.random() for _ in range(n)]

        def mine():
            h = BinaryHeap()
            for v in vals:
                h.push(v)
            while len(h):
                h.pop()

        def std():
            h = []
            for v in vals:
                heapq.heappush(h, v)
            while h:
                heapq.heappop(h)

        res["BinaryHeap"].append(_time(mine))
        res["heapq (C)"].append(_time(std))
    return res


def suite_prefix(sizes, rng):
    res = {"Trie (top-5)": [], "varredura linear": []}
    for n in sizes:
        words = list(set(_words(rng, n)))
        trie = Trie()
        for w in words:
            trie.insert(w, rng.randint(1, 100))
        prefixes = [rng.choice(words)[:3] for _ in range(100)]
        res["Trie (top-5)"].append(_time(lambda: [trie.autocomplete(p, 5) for p in prefixes]))
        res["varredura linear"].append(_time(lambda: [[w for w in words if w.startswith(p)] for p in prefixes]))
    return res


def suite_nearest(sizes, rng):
    res = {"Quadtree": [], "KD-Tree": [], "força bruta": []}
    for n in sizes:
        pts = [(rng.uniform(0, 1000), rng.uniform(0, 1000), i) for i in range(n)]
        qs = [(rng.uniform(0, 1000), rng.uniform(0, 1000)) for _ in range(200)]
        qt = Quadtree(0, 0, 1000, 1000)
        for p in pts:
            qt.insert(*p)
        kd = KDTree(pts)
        res["Quadtree"].append(_time(lambda: [qt.nearest(x, y) for x, y in qs]))
        res["KD-Tree"].append(_time(lambda: [kd.nearest(x, y) for x, y in qs]))
        res["força bruta"].append(_time(
            lambda: [min(pts, key=lambda p: (p[0] - x) ** 2 + (p[1] - y) ** 2) for x, y in qs]))
    return res


def suite_range_sum(sizes, rng):
    res = {"Fenwick": [], "SegmentTree": [], "soma ingênua": []}
    for n in sizes:
        data = [rng.randint(0, 100) for _ in range(n)]
        qs = []
        for _ in range(500):
            a, b = sorted((rng.randrange(n), rng.randrange(n)))
            qs.append((a, b + 1))
        ups = [(rng.randrange(n), rng.randint(0, 100)) for _ in range(500)]

        def fen():
            f = FenwickTree(data)
            for (i, v) in ups:
                f.add(i, v)
            for (l, r) in qs:
                f.range_sum(l, r)

        def seg():
            s = SegmentTree(data)
            for (i, v) in ups:
                s.update(i, v)
            for (l, r) in qs:
                s.query(l, r)

        def naive():
            arr = list(data)
            for (i, v) in ups:
                arr[i] = v
            for (l, r) in qs:
                sum(arr[l:r])

        res["Fenwick"].append(_time(fen))
        res["SegmentTree"].append(_time(seg))
        res["soma ingênua"].append(_time(naive))
    return res


def suite_shortest_path(sizes, rng):
    res = {"Dijkstra": [], "A*": []}
    expanded = {"Dijkstra (nós assentados)": [], "A* (nós expandidos)": []}
    for n in sizes:
        side = max(3, int(math.sqrt(n)))
        g = Graph(side * side)
        for y in range(side):
            for x in range(side):
                u = y * side + x
                if x + 1 < side:
                    g.add_edge(u, u + 1, 1.0 + rng.random() * 0.3)
                if y + 1 < side:
                    g.add_edge(u, u + side, 1.0 + rng.random() * 0.3)

        def h(u, t):
            return math.hypot(u % side - t % side, u // side - t // side)

        pairs = [(rng.randrange(side * side), rng.randrange(side * side)) for _ in range(20)]
        st, ex = [0], [0]

        def dj():
            for s, t in pairs:
                st[0] += shortest_path(g, s, t)[2]

        def as_():
            for s, t in pairs:
                ex[0] += astar(g, s, t, h)[2]

        res["Dijkstra"].append(_time(dj))
        res["A*"].append(_time(as_))
        expanded["Dijkstra (nós assentados)"].append(st[0] / len(pairs))
        expanded["A* (nós expandidos)"].append(ex[0] / len(pairs))
    return res, expanded


def avl_height_study(sizes, rng):
    out = []
    for n in sizes:
        t = AVLTree()
        for k in rng.sample(range(n * 10), n):
            t.insert(k)
        out.append({"n": n, "height": t.height(), "log2n": round(math.log2(n), 2),
                    "limite_1.44log2n": round(1.44 * math.log2(n + 2), 2),
                    "rotacoes": t.rotations})
    return out


def run_benchmarks(sizes, seed=7):
    rng = random.Random(seed)
    sp, expanded = suite_shortest_path(sizes, rng)
    return {
        "sizes": list(sizes),
        "suites": {
            "Dicionário (inserir n + buscar n)": suite_dictionary(sizes, rng),
            "Fila de prioridade (push n + pop n)": suite_priority_queue(sizes, rng),
            "Busca por prefixo (100 consultas)": suite_prefix(sizes, rng),
            "Vizinho mais próximo (200 consultas)": suite_nearest(sizes, rng),
            "Soma em intervalo (500 upd + 500 consultas)": suite_range_sum(sizes, rng),
            "Menor caminho em grade (20 pares)": sp,
        },
        "work": {"Trabalho médio por consulta (grade)": expanded},
        "avl_height": avl_height_study(sizes, rng),
    }


# ---------------------------------------------------------------- relatórios
COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d"]


def svg_chart(title, sizes, series, ylabel="segundos"):
    W, H, L, R, T, B = 640, 360, 70, 170, 40, 50
    xs = [math.log10(s) for s in sizes]
    vals = [v for s in series.values() for v in s if v > 0]
    lo, hi = math.log10(min(vals)), math.log10(max(vals))
    if hi - lo < 0.5:
        hi, lo = hi + 0.25, lo - 0.25

    def px(x):
        return L + (x - xs[0]) / ((xs[-1] - xs[0]) or 1) * (W - L - R)

    def py(v):
        return T + (1 - (math.log10(max(v, 1e-12)) - lo) / (hi - lo)) * (H - T - B)

    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" font-family="sans-serif" font-size="11">' % (W, H),
           '<rect width="100%" height="100%" fill="white"/>',
           '<text x="%d" y="22" font-size="14" font-weight="bold">%s</text>' % (L, title)]
    out.append('<rect x="%d" y="%d" width="%d" height="%d" fill="none" stroke="#999"/>' % (L, T, W - L - R, H - T - B))
    for s, x in zip(sizes, xs):
        out.append('<text x="%.1f" y="%d" text-anchor="middle">%d</text>' % (px(x), H - B + 16, s))
    out.append('<text x="%d" y="%d" text-anchor="middle">n (escala log)</text>' % ((L + W - R) // 2, H - 10))
    for i in range(5):
        v = lo + (hi - lo) * i / 4
        y = T + (1 - i / 4) * (H - T - B)
        out.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="#eee"/>' % (L, W - R, y, y))
        out.append('<text x="%d" y="%.1f" text-anchor="end">%.1e</text>' % (L - 6, y + 4, 10 ** v))
    out.append('<text x="14" y="%d" transform="rotate(-90 14 %d)" text-anchor="middle">%s (log)</text>' % (H // 2, H // 2, ylabel))
    for i, (name, vs) in enumerate(series.items()):
        c = COLORS[i % len(COLORS)]
        pts = " ".join("%.1f,%.1f" % (px(x), py(v)) for x, v in zip(xs, vs))
        out.append('<polyline fill="none" stroke="%s" stroke-width="2" points="%s"/>' % (c, pts))
        for x, v in zip(xs, vs):
            out.append('<circle cx="%.1f" cy="%.1f" r="3" fill="%s"/>' % (px(x), py(v), c))
        ly = T + 14 + i * 18
        out.append('<line x1="%d" x2="%d" y1="%d" y2="%d" stroke="%s" stroke-width="3"/>' % (W - R + 12, W - R + 34, ly, ly, c))
        out.append('<text x="%d" y="%d">%s</text>' % (W - R + 40, ly + 4, name))
    out.append("</svg>")
    return "\n".join(out)


def write_reports(result, outdir):
    os.makedirs(outdir, exist_ok=True)
    sizes = result["sizes"]
    with open(os.path.join(outdir, "results.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    md = ["# Relatório de benchmarks\n", "Tamanhos testados: %s\n" % ", ".join(map(str, sizes))]
    idx = 0
    for title, series in result["suites"].items():
        idx += 1
        fname = "chart_%d.svg" % idx
        with open(os.path.join(outdir, fname), "w", encoding="utf-8") as f:
            f.write(svg_chart(title, sizes, series))
        md.append("\n## %s\n\n![%s](%s)\n" % (title, title, fname))
        md.append("| Implementação | " + " | ".join("n=%d" % s for s in sizes) + " |")
        md.append("|---|" + "---|" * len(sizes))
        for name, vs in series.items():
            md.append("| %s | " % name + " | ".join("%.4fs" % v for v in vs) + " |")
    for title, series in result["work"].items():
        md.append("\n## %s\n" % title)
        md.append("| Algoritmo | " + " | ".join("n=%d" % s for s in sizes) + " |")
        md.append("|---|" + "---|" * len(sizes))
        for name, vs in series.items():
            md.append("| %s | " % name + " | ".join("%.0f" % v for v in vs) + " |")
    md.append("\n## Altura da AVL (teoria: h <= 1,44 log2 n)\n")
    md.append("| n | altura | log2(n) | limite teórico | rotações |")
    md.append("|---|---|---|---|---|")
    for r in result["avl_height"]:
        md.append("| %d | %d | %s | %s | %d |" % (r["n"], r["height"], r["log2n"], r["limite_1.44log2n"], r["rotacoes"]))
    md.append("\n> Observação: as estruturas são escritas em Python puro; `dict` e `heapq` são "
              "implementados em C, então ganham em tempo absoluto. O que importa aqui é a **curva de "
              "crescimento** (inclinação no gráfico log-log), que confirma a complexidade teórica.\n")
    with open(os.path.join(outdir, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--sizes", type=int, nargs="+")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports"))
    a = ap.parse_args()
    sizes = a.sizes or ([500, 1000, 2000, 4000] if a.quick else [1000, 4000, 16000, 64000])
    print("Rodando benchmarks com n =", sizes)
    result = run_benchmarks(sizes)
    write_reports(result, a.out)
    print("Relatório em", os.path.join(a.out, "report.md"))


if __name__ == "__main__":
    main()
