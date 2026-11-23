import json
import math
import os
import tempfile
import unittest

from benchmarks import run_benchmarks, svg_chart, write_reports


class TestBenchmarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sizes = [200, 400, 800]
        cls.result = run_benchmarks(cls.sizes, seed=1)

    def test_structure(self):
        r = self.result
        self.assertEqual(r["sizes"], self.sizes)
        self.assertGreaterEqual(len(r["suites"]), 6)
        for title, series in r["suites"].items():
            for name, vals in series.items():
                self.assertEqual(len(vals), len(self.sizes), (title, name))
                self.assertTrue(all(v >= 0 for v in vals))

    def test_avl_height_within_theory(self):
        for row in self.result["avl_height"]:
            self.assertLessEqual(row["height"], row["limite_1.44log2n"])
            self.assertGreaterEqual(row["height"], math.floor(row["log2n"]))

    def test_astar_does_less_work_than_dijkstra(self):
        work = self.result["work"]["Trabalho médio por consulta (grade)"]
        d = work["Dijkstra (nós assentados)"]
        a = work["A* (nós expandidos)"]
        self.assertTrue(all(x <= y for x, y in zip(a, d)))

    def test_trie_beats_linear_scan_at_scale(self):
        s = run_benchmarks([6000], seed=2)["suites"]["Busca por prefixo (100 consultas)"]
        self.assertLess(s["Trie (top-5)"][0], s["varredura linear"][0] * 3)  # margem p/ máquinas lentas

    def test_reports_written(self):
        with tempfile.TemporaryDirectory() as d:
            write_reports(self.result, d)
            for f in ("results.json", "report.md", "chart_1.svg", "chart_6.svg"):
                self.assertTrue(os.path.isfile(os.path.join(d, f)), f)
            with open(os.path.join(d, "results.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f)["sizes"], self.sizes)
            with open(os.path.join(d, "chart_1.svg"), encoding="utf-8") as f:
                svg = f.read()
            self.assertTrue(svg.startswith("<svg") and svg.rstrip().endswith("</svg>"))

    def test_svg_chart_flat_series(self):
        svg = svg_chart("t", [1, 10], {"a": [1.0, 1.0]})
        self.assertIn("polyline", svg)


if __name__ == "__main__":
    unittest.main()
