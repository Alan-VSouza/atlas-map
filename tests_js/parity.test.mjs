// Paridade Python ↔ JS: repete os cenários gravados por gen_fixtures.py e compara
// cada saída. Rode: node --test tests_js/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { City } from "../web/engine/city.js";
import { PyRandom, hypot, pyRound } from "../web/engine/pycompat.js";
import { hashKey } from "../web/engine/hashtable.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (f) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));

/** Normaliza para comparar como JSON (o Python grava 1.0, o JS 1: depois do parse são iguais). */
const norm = (x) => JSON.parse(JSON.stringify(x));

function firstDiff(a, b, path = "$") {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: tipo diferente`;
    if (a.length !== b.length) return `${path}: tamanho ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${path}: chaves ${ka} != ${kb}`;
    for (const k of ka) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return Object.is(a, b) || a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

function cityFromConfig(cfg) {
  const { name, ...kw } = cfg;
  return new City(kw);
}

function replay(c, [op, ...args]) {
  switch (op) {
    case "map": return c.map_json();
    case "state": return c.state_json();
    case "route": return c.route_query(args[0], args[1]);
    case "autocomplete": return c.autocomplete(args[0]);
    case "resident": return c.lookup_resident(args[0]);
    case "residents": return c.residents_range(args[0], args[1]);
    case "run": c.run(args[0]); return null;
    case "emergency": return c.add_emergency(args[0], args[1]);
    case "close": return c.close_road(args[0], args[1]);
    case "open": return c.open_road(args[0], args[1]);
    case "undo": return c.undo();
    case "redo": return c.redo();
    case "traffic": return c.set_traffic_routing(args[0]);
    default: throw new Error("ação desconhecida " + op);
  }
}

for (const file of readdirSync(DIR).filter((f) => f.startsWith("city_")).sort()) {
  test(`paridade da cidade: ${file}`, () => {
    const fx = load(file);
    const c = cityFromConfig(fx.config);
    let checked = 0;
    fx.actions.forEach((a, i) => {
      const got = norm(replay(c, a.do));
      const diff = firstDiff(got, a.out);
      assert.equal(diff, null, `ação #${i} ${JSON.stringify(a.do)} difere do Python: ${diff}`);
      checked++;
    });
    assert.ok(checked > 50);
  });
}

const P = load("primitives.json");

test("random.Random: mesmas sequências do Python", () => {
  for (const [seed, exp] of Object.entries(P)) {
    if (!/^\d+$/.test(seed)) continue;
    const r = new PyRandom(BigInt(seed));
    const got = {
      random: Array.from({ length: 20 }, () => r.random()),
      randrange: Array.from({ length: 20 }, () => r.randrange(1000)),
      randint: Array.from({ length: 10 }, () => r.randint(1, 50)),
      uniform: Array.from({ length: 10 }, () => r.uniform(-18, 18)),
    };
    const lst = Array.from({ length: 50 }, (_, i) => i); r.shuffle(lst); got.shuffle = lst;
    got.sample_pool = r.sample(Array.from({ length: 1000 }, (_, i) => i), 40);
    got.sample_set = r.sample(Array.from({ length: 500 }, (_, i) => i), 3);
    got.choices = Array.from({ length: 20 }, () => r.choices([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])[0]);
    assert.equal(firstDiff(got, exp), null, `seed ${seed}`);
  }
});

test("math.hypot: resultado idêntico ao do CPython", () => {
  let bad = 0;
  for (const [x, y, h] of P.hypot) if (hypot(x, y) !== h) bad++;
  assert.equal(bad, 0, `${bad} de ${P.hypot.length} diferem`);
});

test("round(x, n): empate para o par, como no Python", () => {
  for (const [v, r1, r2, r3, r4] of P.round) {
    assert.deepEqual([pyRound(v, 1), pyRound(v, 2), pyRound(v, 3), pyRound(v, 4)], [r1, r2, r3, r4], `valor ${v}`);
  }
});

test("hash_key: mesmos 64 bits do Python", () => {
  for (const [k, h] of P.hash) assert.equal(hashKey(JSON.parse(k)).toString(), h, `chave ${k}`);
});
