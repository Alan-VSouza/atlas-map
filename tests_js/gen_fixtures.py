"""Gera as saídas de referência do Python para o teste de paridade do motor JS.

Uso: python tests_js/gen_fixtures.py   (grava tests_js/fixtures/*.json)

Cada cenário é uma lista de ações; o teste JS repete as mesmas ações e
compara cada saída com a do Python (mapa, rotas, buscas, moradores e o
state_json completo em vários pontos da simulação).
"""

import json
import math
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from city import City  # noqa: E402
from ds_lib import hash_key  # noqa: E402

OUT = os.path.join(ROOT, "tests_js", "fixtures")

CONFIGS = [
    {"name": "padrao", "seed": 42, "width": 12, "height": 8, "n_cars": 120},
    {"name": "pequena", "seed": 1, "width": 6, "height": 5, "n_cars": 15, "n_residents": 300,
     "emergency_rate": 0.1},
    {"name": "grande", "seed": 7, "width": 16, "height": 10, "n_cars": 150, "emergency_rate": 0.08},
    {"name": "seed_grande", "seed": 2 ** 40 + 12345, "width": 9, "height": 7, "n_cars": 40,
     "n_hospitals": 2, "n_ambulances": 4},
    {"name": "sem_transito", "seed": 3, "width": 10, "height": 7, "n_cars": 140, "traffic_routing": False},
]

PREFIXES = ["rua", "av. s", "Av. Pa", "rua d", "av. ", "r", "tiradentes", "rua tiradentis",
            "av paulsta", "ruaa das flroes", "xyz", "", "rua sete de", "av. são", "aveni", "rua x"]


def scenario(cfg):
    kw = {k: v for k, v in cfg.items() if k != "name"}
    c = City(**kw)
    rng = random.Random(999)
    actions = []

    def rec(action, result):
        actions.append({"do": action, "out": result})

    rec(["map"], c.map_json())
    rec(["state"], c.state_json())
    for _ in range(25):
        s, d = rng.randrange(c.n), rng.randrange(c.n)
        rec(["route", s, d], c.route_query(s, d))
    for p in PREFIXES:
        rec(["autocomplete", p], c.autocomplete(p))
    ids = [k for k, _ in list(c.residents.items())[::97]][:8]
    ids += [100000 + i * 731 for i in range(10)] + [99, 999999]
    for rid in ids:
        rec(["resident", rid], c.lookup_resident(rid))
    rec(["residents", 100000, 100500], c.residents_range(100000, 100500))
    rec(["residents", 100200, 100230], c.residents_range(100200, 100230))

    c.run(40); rec(["run", 40], None)
    rec(["state"], c.state_json())
    rec(["emergency", 5, 4], c.add_emergency(5, 4))
    rec(["emergency", c.n - 1, 2], c.add_emergency(c.n - 1, 2))
    rec(["emergency", c.n // 2, 5], c.add_emergency(c.n // 2, 5))
    c.run(20); rec(["run", 20], None)
    rec(["state"], c.state_json())
    for idx in (3, 10, 17, len(c.edge_list) // 2):
        u, v = c.edge_list[idx % len(c.edge_list)]
        rec(["close", u, v], c.close_road(u, v))
    rec(["close", 0, 0], c.close_road(0, 0))  # aresta inexistente
    rec(["state"], c.state_json())
    for _ in range(6):
        s, d = rng.randrange(c.n), rng.randrange(c.n)
        rec(["route", s, d], c.route_query(s, d))
    c.run(30); rec(["run", 30], None)
    rec(["undo"], c.undo())
    rec(["undo"], c.undo())
    rec(["redo"], c.redo())
    rec(["state"], c.state_json())
    u, v = c.edge_list[10 % len(c.edge_list)]
    rec(["open", u, v], c.open_road(u, v))
    rec(["open", u, v], c.open_road(u, v))
    c.run(60); rec(["run", 60], None)
    rec(["state"], c.state_json())
    rec(["traffic", not c.traffic_routing], c.set_traffic_routing(not c.traffic_routing))
    c.run(40); rec(["run", 40], None)
    rec(["state"], c.state_json())
    rec(["traffic", not c.traffic_routing], c.set_traffic_routing(not c.traffic_routing))
    # isola um cruzamento de canto e pede rota até ele
    corner = 0
    for (a, b) in list(c.edge_list):
        if a == corner or b == corner:
            c.close_road(a, b)
            actions.append({"do": ["close", a, b], "out": True})
    rec(["route", corner, c.n - 1], c.route_query(corner, c.n - 1))
    rec(["emergency", corner, 5], c.add_emergency(corner, 5))
    c.run(120); rec(["run", 120], None)
    rec(["state"], c.state_json())
    for _ in range(4):
        rec(["undo"], c.undo())
    c.run(150); rec(["run", 150], None)
    rec(["state"], c.state_json())
    return {"config": cfg, "actions": actions}


def primitives():
    """Sequências do random.Random, math.hypot e hash_key para testes unitários."""
    out = {}
    for seed in (0, 1, 42, 7, 2 ** 40 + 12345, 123456789):
        r = random.Random(seed)
        seq = {"random": [r.random() for _ in range(20)],
               "randrange": [r.randrange(1000) for _ in range(20)],
               "randint": [r.randint(1, 50) for _ in range(10)],
               "uniform": [r.uniform(-18, 18) for _ in range(10)]}
        lst = list(range(50))
        r.shuffle(lst)
        seq["shuffle"] = lst
        seq["sample_pool"] = r.sample(range(1000), 40)
        seq["sample_set"] = r.sample(range(500), 3)
        seq["choices"] = [r.choices([1, 2, 3, 4, 5], weights=[5, 4, 3, 2, 1])[0] for _ in range(20)]
        out[str(seed)] = seq
    r = random.Random(5)
    pairs = [(r.uniform(-2000, 2000), r.uniform(-2000, 2000)) for _ in range(3000)]
    pairs += [(r.uniform(-1, 1) * 10 ** r.randint(-12, 12), r.uniform(-1, 1)) for _ in range(1000)]
    out["hypot"] = [[x, y, math.hypot(x, y)] for x, y in pairs]
    vals = [r.uniform(-1000, 1000) for _ in range(2000)] + [0.125, 2.675, 0.5, 1.5, 2.5, -2.5, 1e-5, 123.45]
    out["round"] = [[v, round(v, 1), round(v, 2), round(v, 3), round(v, 4)] for v in vals]
    keys = [0, 1, -1, 42, 2 ** 52 + 1, -(2 ** 40), "", "a", "rua das flores", "São Paulo ç", (1, 2), (0, (3, 4)),
            (5, 6, 7), ("x", 1)]
    out["hash"] = [[json.dumps(k), str(hash_key(k))] for k in keys]
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for cfg in CONFIGS:
        with open(os.path.join(OUT, "city_%s.json" % cfg["name"]), "w", encoding="utf-8") as f:
            json.dump(scenario(cfg), f, ensure_ascii=False)
    with open(os.path.join(OUT, "primitives.json"), "w", encoding="utf-8") as f:
        json.dump(primitives(), f)
    print("fixtures gravadas em", OUT)


if __name__ == "__main__":
    main()
