import json
import threading
import unittest
import urllib.error
import urllib.request

from city import City
from city.server import make_server
from ds_lib import INF, shortest_path


def small_city(**kw):
    args = dict(seed=1, width=6, height=5, n_cars=15, n_residents=300, emergency_rate=0.0)
    args.update(kw)
    return City(**args)


class TestCityBasics(unittest.TestCase):
    def test_map_is_connected_and_deterministic(self):
        a, b = small_city(), small_city()
        self.assertEqual(a.ncomp, 1)
        self.assertEqual(a.map_json(), b.map_json())
        self.assertNotEqual(a.map_json()["nodes"], small_city(seed=2).map_json()["nodes"])

    def test_mst_spans_city(self):
        c = small_city()
        self.assertEqual(len(c.mst_edges), c.n - 1)

    def test_simulation_is_deterministic(self):
        a, b = small_city(emergency_rate=0.1), small_city(emergency_rate=0.1)
        a.run(150)
        b.run(150)
        self.assertEqual(a.state_json(), b.state_json())

    def test_cars_stay_on_map_and_move(self):
        c = small_city()
        x0, y0, x1, y1 = c.bounds
        before = [tuple(p[:2]) for p in c.state_json()["cars"]]
        c.run(40)
        after = [tuple(p[:2]) for p in c.state_json()["cars"]]
        self.assertNotEqual(before, after)
        for x, y, _ in c.state_json()["cars"]:
            self.assertTrue(x0 <= x <= x1 and y0 <= y <= y1)

    def test_quadtree_indexes_all_cars(self):
        c = small_city()
        c.run(10)
        self.assertEqual(len(c.car_qt), len(c.cars))

    def test_invalid_sizes(self):
        with self.assertRaises(ValueError):
            City(width=2, height=5)


class TestEmergencies(unittest.TestCase):
    def test_priority_order_and_resolution(self):
        c = small_city(n_ambulances=1, n_hospitals=1)
        # 3 chamados simultâneos: a de maior gravidade tem que ser despachada primeiro
        far = [n for n in range(c.n) if n != c.hospitals[0]]
        e_low = c.add_emergency(far[0], 1)
        e_high = c.add_emergency(far[1], 5)
        e_mid = c.add_emergency(far[2], 3)
        c.tick()
        self.assertEqual(c.emergencies.get(e_high)["state"], "assigned")
        self.assertEqual(c.emergencies.get(e_low)["state"], "waiting")
        self.assertEqual(c.emergencies.get(e_mid)["state"], "waiting")
        c.run(600)
        for eid in (e_low, e_high, e_mid):
            self.assertEqual(c.emergencies.get(eid)["state"], "done")
        # atendidos na ordem de gravidade
        order = sorted((c.emergencies.get(i)["done"], i) for i in (e_low, e_high, e_mid))
        self.assertEqual([i for _, i in order], [e_high, e_mid, e_low])
        self.assertEqual(c.stats["resolved"], 3)
        self.assertEqual(c.stats["unreachable"], 0)

    def test_heap_never_loses_calls(self):
        c = small_city(emergency_rate=0.2, n_ambulances=2)
        c.run(500)
        st = c.stats
        pending = len(c.pq)
        in_progress = sum(1 for _, e in c.emergencies.items() if e["state"] in ("assigned", "transport"))
        done = sum(1 for _, e in c.emergencies.items() if e["state"] == "done")
        unreachable = sum(1 for _, e in c.emergencies.items() if e["state"] == "unreachable")
        self.assertEqual(st["spawned"], pending + in_progress + done + unreachable)
        self.assertEqual(st["resolved"], done)
        self.assertGreater(done, 0)

    def test_validation(self):
        c = small_city()
        with self.assertRaises(ValueError):
            c.add_emergency(-1, 3)
        with self.assertRaises(ValueError):
            c.add_emergency(0, 9)

    def test_chosen_ambulance_is_among_nearest(self):
        c = small_city(n_ambulances=3, n_hospitals=3)
        node = (c.hospitals[0] + 7) % c.n
        eid = c.add_emergency(node, 4)
        c.tick()
        amb = c.ambulances[c.emergencies.get(eid)["ambulance"]]
        costs = sorted(shortest_path(c.g, h, node)[0] for h in c.hospitals)
        used = shortest_path(c.g, amb["route"][0], node)[0]
        self.assertLessEqual(used, costs[2])


class TestRoadsAndRoutes(unittest.TestCase):
    def test_close_open_undo_redo(self):
        c = small_city()
        u, v = c.edge_list[0]
        self.assertTrue(c.close_road(u, v))
        self.assertFalse(c.close_road(u, v))
        self.assertFalse(c.g.has_edge(u, v))
        self.assertEqual(len(c.closed), 1)
        self.assertTrue(c.undo())
        self.assertTrue(c.g.has_edge(u, v))
        self.assertEqual(len(c.closed), 0)
        self.assertTrue(c.redo())
        self.assertFalse(c.g.has_edge(u, v))
        self.assertTrue(c.open_road(u, v))
        self.assertTrue(c.undo())      # desfaz o open
        self.assertTrue(c.undo())      # desfaz o close
        self.assertFalse(c.undo())
        self.assertTrue(c.g.has_edge(u, v))
        self.assertAlmostEqual(c.g.weight(u, v), c.weight0[(u, v)])

    def test_new_action_clears_redo(self):
        c = small_city()
        (a, b), (d, e) = c.edge_list[0], c.edge_list[5]
        c.close_road(a, b)
        c.undo()
        c.close_road(d, e)
        self.assertFalse(c.redo())

    def test_islands_after_cutting_a_node(self):
        c = small_city()
        victim = 0
        for (u, v) in list(c.edge_list):
            if victim in (u, v):
                c.close_road(u, v)
        self.assertGreaterEqual(c.ncomp, 2)
        self.assertEqual(len(c.mst_edges), c.n - c.ncomp)
        c.run(30)  # a simulação não pode quebrar com ilhas
        while c.undo():
            pass
        self.assertEqual(c.ncomp, 1)

    def test_cars_avoid_closed_roads_and_cache_versioned(self):
        c = small_city(n_cars=30)
        c.run(20)
        v0 = c.version
        for (u, v) in c.edge_list[:6]:
            c.close_road(u, v)
        self.assertGreater(c.version, v0)
        closed = set(c.closed)
        c.run(120)
        for car in c.cars:
            r = car["route"]
            for a, b in zip(r[car["i"] + 1:], r[car["i"] + 2:]):
                self.assertNotIn((min(a, b), max(a, b)), closed)

    def test_route_query_astar_matches_dijkstra(self):
        c = small_city()
        for src, dst in [(0, c.n - 1), (3, 17), (5, 5)]:
            r = c.route_query(src, dst)
            self.assertTrue(r["found"])
            self.assertAlmostEqual(r["cost"], r["astar_cost"], places=1)
            self.assertEqual(r["path"][0], src)
            self.assertEqual(r["path"][-1], dst)
        r = c.route_query(0, c.n - 1)
        self.assertLessEqual(r["astar_expanded"], r["dijkstra_settled"])
        with self.assertRaises(ValueError):
            c.route_query(0, 9999)

    def test_route_cache_hits(self):
        c = small_city()
        c.route_query(0, 20)
        h0 = c.route_cache.hits
        c._route_full(0, 20)
        self.assertEqual(c.route_cache.hits, h0 + 1)

    def test_unreachable_route(self):
        c = small_city()
        for (u, v) in list(c.edge_list):
            if 0 in (u, v):
                c.close_road(u, v)
        r = c.route_query(0, c.n - 1)
        self.assertFalse(r["found"])
        self.assertIsNone(r["cost"])
        self.assertEqual(r["path"], [])


class TestQueries(unittest.TestCase):
    def test_autocomplete_and_did_you_mean(self):
        c = small_city()
        name = c.row_name[0]
        res = c.autocomplete(name[:5])
        self.assertTrue(any(x["name"] == name for x in res["completions"]) or len(res["completions"]) > 0)
        self.assertEqual(c.autocomplete("rua")["completions"][0]["name"][:3], "Rua")
        typo = c.autocomplete("rau")
        self.assertEqual(typo["completions"], [])
        self.assertTrue(typo["suggestions"])
        self.assertEqual(typo["suggestions"][0]["distance"], 2)

    def test_resident_lookup_with_bloom(self):
        c = small_city()
        rid = next(iter(c.residents.items()))[0]
        r = c.lookup_resident(rid)
        self.assertTrue(r["found"] and r["bloom_maybe"])
        self.assertEqual(r["resident"]["id"], rid)
        self.assertGreater(r["comparisons"], 0)
        self.assertLessEqual(r["comparisons"], 2 * c.residents.height())
        miss = c.lookup_resident(5)
        self.assertFalse(miss["found"])
        self.assertFalse(miss["bloom_maybe"])
        self.assertEqual(miss["comparisons"], 0)
        self.assertGreaterEqual(c.bloom_skips, 1)

    def test_residents_range_is_sorted(self):
        c = small_city()
        res = c.residents_range(100000, 101500, limit=1000)
        ids = [r["id"] for r in res["residents"]]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(res["count"], len(ids))
        self.assertTrue(all(100000 <= i <= 101500 for i in ids))

    def test_traffic_windows(self):
        c = small_city(n_cars=25)
        c.run(100)
        s = c.state_json()["traffic"]
        self.assertGreater(s["last60"], 0)
        self.assertGreaterEqual(s["peak60"], 1)
        self.assertLessEqual(s["peak60"], s["last60"])
        self.assertLessEqual(s["peak60"], 25 * 5)

    def test_hot_roads_sorted(self):
        c = small_city(n_cars=30)
        c.run(120)
        hot = c.hot_roads(5)
        counts = [h["count"] for h in hot]
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertTrue(0 < len(hot) <= 5)

    def test_state_json_is_serializable(self):
        c = small_city(emergency_rate=0.2)
        c.run(80)
        s = json.loads(json.dumps(c.state_json()))
        for key in ("tick", "cars", "ambulances", "heap", "lru", "quadtree", "mst",
                    "huffman", "avl", "bloom", "traffic", "log", "closed", "stats"):
            self.assertIn(key, s)
        self.assertLess(s["huffman"]["ratio"], 1.0)
        json.dumps(c.map_json())

    def test_timeline_is_capped(self):
        c = small_city()
        for i in range(500):
            c.log("evento %d" % i)
        self.assertEqual(len(c.timeline), 300)


class TestServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.city = small_city(emergency_rate=0.0)
        cls.httpd, cls.ticker, cls.lock = make_server(cls.city, "127.0.0.1", 0, 0.05, autostart=False)
        cls.base = "http://127.0.0.1:%d" % cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=10) as r:
            return r.status, r.read(), r.headers.get("Content-Type")

    def getj(self, path):
        s, b, _ = self.get(path)
        self.assertEqual(s, 200)
        return json.loads(b)

    def post(self, path, body=None, raw=None):
        data = raw if raw is not None else json.dumps(body or {}).encode()
        req = urllib.request.Request(self.base + path, data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_static_index(self):
        s, body, ctype = self.get("/")
        self.assertEqual(s, 200)
        self.assertIn("text/html", ctype)
        self.assertIn(b"ATLAS", body)
        s, body, ctype = self.get("/app.js")
        self.assertEqual(s, 200)
        self.assertIn("javascript", ctype)

    def test_static_path_traversal_blocked(self):
        for p in ("/../run.py", "/..%2Frun.py", "/%2e%2e/run.py", "/nada.txt"):
            try:
                self.get(p)
                self.fail("deveria dar 404: " + p)
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 404)

    def test_map_state_endpoints(self):
        m = self.getj("/api/map")
        self.assertEqual(len(m["nodes"]), self.city.n)
        st = self.getj("/api/state")
        self.assertIn("cars", st)
        self.assertIn("paused", st)

    def test_route_endpoint(self):
        r = self.getj("/api/route?src=0&dst=10")
        self.assertTrue(r["found"])
        try:
            self.get("/api/route?src=abc&dst=1")
            self.fail()
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
        try:
            self.get("/api/route?src=0&dst=99999")
            self.fail()
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)

    def test_autocomplete_and_resident_endpoints(self):
        self.assertTrue(self.getj("/api/autocomplete?prefix=rua")["completions"])
        rid = next(iter(self.city.residents.items()))[0]
        self.assertTrue(self.getj("/api/resident?id=%d" % rid)["found"])
        self.assertGreater(self.getj("/api/residents?lo=100000&hi=101000")["count"], 0)

    def test_emergency_close_undo_flow(self):
        s, r = self.post("/api/emergency", {"node": 4, "severity": 5})
        self.assertEqual(s, 200)
        self.assertTrue(r["ok"])
        self.assertEqual(self.post("/api/emergency", {"node": 4, "severity": 9})[0], 400)
        self.assertEqual(self.post("/api/emergency", {"severity": 3})[0], 400)
        u, v = self.city.edge_list[2]
        self.assertTrue(self.post("/api/close", {"u": u, "v": v})[1]["ok"])
        self.assertIn(self.city.edge_id[(u, v)], self.getj("/api/state")["closed"])
        self.assertTrue(self.post("/api/undo")[1]["ok"])
        self.assertNotIn(self.city.edge_id[(u, v)], self.getj("/api/state")["closed"])
        self.assertTrue(self.post("/api/redo")[1]["ok"])
        self.assertTrue(self.post("/api/open", {"u": u, "v": v})[1]["ok"])

    def test_bad_requests(self):
        self.assertEqual(self.post("/api/close", raw=b"{nao e json")[0], 400)
        self.assertEqual(self.post("/api/close", raw=b"[1,2]")[0], 400)
        self.assertEqual(self.post("/api/desconhecida")[0], 404)
        try:
            self.get("/api/desconhecida")
            self.fail()
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 404)

    def test_pause_and_benchmark(self):
        self.assertTrue(self.post("/api/pause", {"paused": True})[1]["paused"])
        self.assertFalse(self.post("/api/pause", {"paused": False})[1]["paused"])

    def test_concurrent_requests(self):
        errors = []

        def worker():
            try:
                for _ in range(15):
                    self.getj("/api/state")
                    self.getj("/api/route?src=1&dst=12")
            except Exception as e:  # noqa
                errors.append(e)

        ts = [threading.Thread(target=worker) for _ in range(6)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()


class TestTrafficRouting(unittest.TestCase):
    """Rotas reagem ao trânsito: rua lenta/intensa custa mais no Dijkstra."""

    def test_levels_update_and_weights_follow(self):
        from city.simulation import TRAFFIC_FACTOR
        c = City(seed=42, width=12, height=8, n_cars=150)
        c.run(120)
        self.assertGreater(c.traffic_updates, 0)
        self.assertTrue(any(c.traffic_level))
        for e, k in enumerate(c.edge_list):
            if k in c.closed:
                continue
            want = c.weight0[k] * TRAFFIC_FACTOR[c.traffic_level[e]]
            self.assertAlmostEqual(c.g.weight(*k), want)
            self.assertAlmostEqual(c.g0.weight(*k), c.weight0[k])

    def test_route_is_optimal_under_current_traffic(self):
        c = City(seed=42, width=12, height=8, n_cars=150)
        c.run(150)
        rng = __import__("random").Random(3)
        for _ in range(30):
            s, d = rng.randrange(c.n), rng.randrange(c.n)
            r = c.route_query(s, d)
            if not r["found"]:
                continue
            # o caminho escolhido nunca é pior que o caminho "sem trânsito" medido com o trânsito atual
            self.assertLessEqual(r["cost"], r["free_cost_now"] + 1e-6)
            # e o trânsito nunca deixa a viagem mais barata que a cidade vazia
            self.assertGreaterEqual(r["cost"] + 1e-6, r["free_cost"])

    def test_toggle_restores_free_weights(self):
        c = City(seed=42, width=12, height=8, n_cars=150)
        c.run(120)
        v = c.version
        self.assertTrue(c.set_traffic_routing(False))
        self.assertFalse(c.set_traffic_routing(False))
        self.assertGreater(c.version, v)
        for k in c.edge_list:
            self.assertAlmostEqual(c.g.weight(*k), c.weight0[k])
        r = c.route_query(0, c.n - 1)
        self.assertEqual(r["path"], r["free_path"])

    def test_jam_on_route_causes_detour(self):
        from city.simulation import TRAFFIC_FACTOR
        c = small_city(n_cars=0)
        r0 = c.route_query(0, c.n - 1)
        for a, b in zip(r0["path"], r0["path"][1:]):   # congestiona todo o caminho
            k = (a, b) if a < b else (b, a)
            c.traffic_level[c.edge_id[k]] = 2
            c.g.set_weight(k[0], k[1], c.weight0[k] * TRAFFIC_FACTOR[2])
        c._bump_version()
        r1 = c.route_query(0, c.n - 1)
        self.assertNotEqual(r1["path"], r0["path"])
        self.assertEqual(r1["free_path"], r0["path"])
        self.assertLess(r1["cost"], r1["free_cost_now"])

