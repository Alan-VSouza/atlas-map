import math
import random
import unittest

from ds_lib import (INF, Graph, KDTree, Quadtree, UnionFind, astar, bellman_ford, bfs,
                    connected_components, dfs, dijkstra, floyd_warshall, kruskal,
                    shortest_path, tarjan_scc, topological_sort)


def random_graph(rng, n, m, directed=False, wmax=20):
    g = Graph(n, directed)
    for _ in range(m):
        g.add_edge(rng.randrange(n), rng.randrange(n), rng.randint(1, wmax))
    return g


def ref_dijkstra_matrix(g):
    return floyd_warshall(g)


class TestShortestPaths(unittest.TestCase):
    def test_dijkstra_vs_floyd(self):
        rng = random.Random(60)
        for _ in range(20):
            n = rng.randint(2, 25)
            g = random_graph(rng, n, rng.randint(n, 3 * n))
            fw = floyd_warshall(g)
            for s in range(n):
                dist, _, _ = dijkstra(g, s)
                for t in range(n):
                    self.assertEqual(dist[t], fw[s][t])

    def test_bellman_ford_vs_dijkstra(self):
        rng = random.Random(61)
        for _ in range(20):
            n = rng.randint(2, 25)
            g = random_graph(rng, n, 2 * n, directed=True)
            edges = list(g.edges())
            for s in range(n):
                self.assertEqual(bellman_ford(n, edges, s), dijkstra(g, s)[0])

    def test_bellman_ford_negative_weights_and_cycle(self):
        edges = [(0, 1, 4), (0, 2, 5), (1, 2, -3), (2, 3, 2)]
        self.assertEqual(bellman_ford(4, edges, 0), [0, 4, 1, 3])
        with self.assertRaises(ValueError):
            bellman_ford(3, [(0, 1, 1), (1, 2, -2), (2, 1, 1)], 0)

    def test_path_is_valid_and_costs_match(self):
        rng = random.Random(62)
        g = random_graph(rng, 40, 120)
        for _ in range(50):
            s, t = rng.randrange(40), rng.randrange(40)
            cost, path, _ = shortest_path(g, s, t)
            if cost == INF:
                self.assertEqual(path, [])
                continue
            self.assertEqual(path[0], s)
            self.assertEqual(path[-1], t)
            total = sum(g.weight(a, b) for a, b in zip(path, path[1:]))
            self.assertAlmostEqual(total, cost)

    def test_astar_optimal_and_expands_less_on_grid(self):
        rng = random.Random(63)
        side = 30
        g = Graph(side * side)
        for y in range(side):
            for x in range(side):
                u = y * side + x
                if x + 1 < side:
                    g.add_edge(u, u + 1, 1.0 + rng.random() * 0.2)
                if y + 1 < side:
                    g.add_edge(u, u + side, 1.0 + rng.random() * 0.2)

        def h(u, t):
            return math.hypot(u % side - t % side, u // side - t // side)

        less = 0
        for _ in range(20):
            s, t = rng.randrange(side * side), rng.randrange(side * side)
            dc, _, dsettled = shortest_path(g, s, t)
            ac, apath, aexp = astar(g, s, t, h)
            self.assertAlmostEqual(dc, ac)
            less += aexp <= dsettled
        self.assertGreaterEqual(less, 15)

    def test_unreachable(self):
        g = Graph(4)
        g.add_edge(0, 1, 1)
        g.add_edge(2, 3, 1)
        cost, path, _ = shortest_path(g, 0, 3)
        self.assertEqual(cost, INF)
        self.assertEqual(path, [])
        self.assertEqual(astar(g, 0, 3, lambda a, b: 0)[0], INF)

    def test_remove_edge(self):
        g = Graph(3)
        g.add_edge(0, 1, 2)
        g.add_edge(1, 2, 3)
        self.assertEqual(g.remove_edge(0, 1), 2)
        self.assertIsNone(g.remove_edge(0, 1))
        self.assertFalse(g.has_edge(1, 0))
        self.assertEqual(shortest_path(g, 0, 2)[0], INF)


class TestUnionFindMST(unittest.TestCase):
    def test_union_find(self):
        uf = UnionFind(10)
        self.assertTrue(uf.union(1, 2))
        self.assertTrue(uf.union(2, 3))
        self.assertFalse(uf.union(1, 3))
        self.assertEqual(uf.find(1), uf.find(3))
        self.assertNotEqual(uf.find(1), uf.find(4))
        self.assertEqual(uf.components, 8)

    def test_kruskal_vs_bruteforce_on_small_graphs(self):
        import itertools
        rng = random.Random(64)
        for _ in range(30):
            n = rng.randint(3, 6)
            g = Graph(n)
            for u in range(n):
                for v in range(u + 1, n):
                    if rng.random() < 0.7:
                        g.add_edge(u, v, rng.randint(1, 15))
            edges = list(g.edges())
            comps = connected_components(g)[1]
            mst, total = kruskal(g)
            self.assertEqual(len(mst), n - comps)
            best = INF
            for sub in itertools.combinations(edges, n - comps):
                uf = UnionFind(n)
                if all(uf.union(u, v) for u, v, _ in sub) and uf.components == comps:
                    best = min(best, sum(w for _, _, w in sub))
            self.assertEqual(total, best)


class TestTraversals(unittest.TestCase):
    def test_bfs_distances(self):
        g = Graph(6)
        for a, b in [(0, 1), (1, 2), (0, 3), (3, 4)]:
            g.add_edge(a, b)
        order, dist = bfs(g, 0)
        self.assertEqual(dist, [0, 1, 2, 1, 2, -1])
        self.assertEqual(set(order), {0, 1, 2, 3, 4})

    def test_dfs_visits_component(self):
        g = Graph(5)
        for a, b in [(0, 1), (1, 2), (3, 4)]:
            g.add_edge(a, b)
        self.assertEqual(set(dfs(g, 0)), {0, 1, 2})
        self.assertEqual(dfs(g, 0)[0], 0)

    def test_topological_sort(self):
        rng = random.Random(65)
        n = 30
        g = Graph(n, directed=True)
        perm = list(range(n))
        rng.shuffle(perm)
        for _ in range(80):
            a, b = sorted(rng.sample(range(n), 2))
            g.add_edge(perm[a], perm[b])
        order = topological_sort(g)
        pos = {v: i for i, v in enumerate(order)}
        for u, v, _ in g.edges():
            self.assertLess(pos[u], pos[v])

    def test_topological_cycle_detected(self):
        g = Graph(3, directed=True)
        g.add_edge(0, 1)
        g.add_edge(1, 2)
        g.add_edge(2, 0)
        with self.assertRaises(ValueError):
            topological_sort(g)

    def test_tarjan_scc_vs_reachability(self):
        rng = random.Random(66)
        for _ in range(25):
            n = rng.randint(2, 18)
            g = random_graph(rng, n, rng.randint(n // 2, 3 * n), directed=True)
            reach = [set(dfs(g, s)) for s in range(n)]
            comps = tarjan_scc(g)
            self.assertEqual(sum(len(c) for c in comps), n)
            label = {}
            for i, c in enumerate(comps):
                for v in c:
                    label[v] = i
            for a in range(n):
                for b in range(n):
                    mutual = b in reach[a] and a in reach[b]
                    self.assertEqual(label[a] == label[b], mutual)

    def test_tarjan_deep_chain_no_recursion_error(self):
        n = 20000
        g = Graph(n, directed=True)
        for i in range(n - 1):
            g.add_edge(i, i + 1)
        g.add_edge(n - 1, 0)
        comps = tarjan_scc(g)
        self.assertEqual(len(comps), 1)
        self.assertEqual(len(comps[0]), n)

    def test_connected_components(self):
        g = Graph(6)
        g.add_edge(0, 1)
        g.add_edge(1, 2)
        g.add_edge(3, 4)
        labels, k = connected_components(g)
        self.assertEqual(k, 3)
        self.assertEqual(labels[0], labels[2])
        self.assertNotEqual(labels[0], labels[3])
        self.assertNotEqual(labels[5], labels[3])


class TestSpatial(unittest.TestCase):
    def setUp(self):
        rng = random.Random(70)
        self.pts = [(rng.uniform(0, 1000), rng.uniform(0, 1000), i) for i in range(1500)]
        self.rng = rng

    def _brute_nn(self, x, y, k):
        return sorted(((px - x) ** 2 + (py - y) ** 2, i) for px, py, i in self.pts)[:k]

    def test_quadtree_nearest_and_range(self):
        qt = Quadtree(0, 0, 1000, 1000)
        for p in self.pts:
            self.assertTrue(qt.insert(*p))
        self.assertEqual(len(qt), len(self.pts))
        for _ in range(60):
            x, y = self.rng.uniform(-50, 1050), self.rng.uniform(-50, 1050)
            for k in (1, 5):
                got = [(d2, i) for d2, _, _, i in qt.nearest(x, y, k)]
                exp = self._brute_nn(x, y, k)
                self.assertEqual([i for _, i in got], [i for _, i in exp])
                for (a, _), (b, _) in zip(got, exp):
                    self.assertAlmostEqual(a, b)
        for _ in range(40):
            x0, x1 = sorted((self.rng.uniform(0, 1000), self.rng.uniform(0, 1000)))
            y0, y1 = sorted((self.rng.uniform(0, 1000), self.rng.uniform(0, 1000)))
            got = sorted(i for _, _, i in qt.query(x0, y0, x1, y1))
            exp = sorted(i for x, y, i in self.pts if x0 <= x <= x1 and y0 <= y <= y1)
            self.assertEqual(got, exp)

    def test_quadtree_remove_and_bounds(self):
        qt = Quadtree(0, 0, 1000, 1000)
        for p in self.pts:
            qt.insert(*p)
        self.assertFalse(qt.insert(5000, 5000, "fora"))
        removed = self.pts[:700]
        for x, y, i in removed:
            self.assertTrue(qt.remove(x, y, i))
        self.assertFalse(qt.remove(*removed[0]))
        self.assertEqual(len(qt), len(self.pts) - 700)
        rest = self.pts[700:]
        x, y = 500, 500
        best = min(rest, key=lambda p: (p[0] - x) ** 2 + (p[1] - y) ** 2)[2]
        self.assertEqual(qt.nearest(x, y)[0][3], best)
        self.assertEqual(sum(1 for _ in qt.rects()) > 1, True)

    def test_quadtree_duplicate_points_terminate(self):
        qt = Quadtree(0, 0, 100, 100, capacity=2)
        for i in range(50):
            qt.insert(10, 10, i)  # mesmo ponto: limitado por max_depth
        self.assertEqual(len(qt), 50)
        self.assertEqual(len(qt.query(0, 0, 20, 20)), 50)
        self.assertEqual(len(qt.nearest(10, 10, 5)), 5)

    def test_quadtree_empty(self):
        self.assertEqual(Quadtree(0, 0, 1, 1).nearest(0.5, 0.5), [])

    def test_kdtree_nearest(self):
        kd = KDTree(self.pts)
        self.assertEqual(len(kd), len(self.pts))
        for _ in range(60):
            x, y = self.rng.uniform(0, 1000), self.rng.uniform(0, 1000)
            for k in (1, 4):
                got = [i for _, _, _, i in kd.nearest(x, y, k)]
                exp = [i for _, i in self._brute_nn(x, y, k)]
                self.assertEqual(got, exp)
        self.assertEqual(KDTree([]).nearest(0, 0), [])


if __name__ == "__main__":
    unittest.main()
