import heapq
import math
import random
import unittest

from ds_lib import (BinaryHeap, BloomFilter, ChainingHashTable, CountMinSketch,
                    IndexedPriorityQueue, LRUCache, OpenAddressingHashTable, hash_key)


class TestBinaryHeap(unittest.TestCase):
    def test_min_heap_against_heapq(self):
        rng = random.Random(3)
        h, ref = BinaryHeap(), []
        for _ in range(4000):
            if ref and rng.random() < 0.4:
                self.assertEqual(h.pop(), heapq.heappop(ref))
            else:
                v = rng.randint(0, 500)
                h.push(v)
                heapq.heappush(ref, v)
            self.assertEqual(len(h), len(ref))
            if ref:
                self.assertEqual(h.peek(), ref[0])
        self.assertTrue(h.is_valid())

    def test_max_heap_and_key(self):
        h = BinaryHeap(key=lambda t: t[0], max_heap=True)
        for v in [(3, "c"), (9, "z"), (1, "a"), (7, "q")]:
            h.push(v)
        self.assertEqual([h.pop()[0] for _ in range(4)], [9, 7, 3, 1])

    def test_heapify_and_sort(self):
        rng = random.Random(4)
        data = [rng.random() for _ in range(1000)]
        h = BinaryHeap(items=data)
        self.assertTrue(h.is_valid())
        self.assertEqual([h.pop() for _ in range(len(data))], sorted(data))

    def test_empty_errors(self):
        h = BinaryHeap()
        with self.assertRaises(IndexError):
            h.pop()
        with self.assertRaises(IndexError):
            h.peek()


class TestIndexedPQ(unittest.TestCase):
    def test_update_and_remove(self):
        pq = IndexedPriorityQueue()
        for name, p in [("a", 5), ("b", 3), ("c", 8), ("d", 1)]:
            pq.push(name, p)
        pq.update("c", 0)
        pq.update("d", 10)
        self.assertEqual(pq.peek(), ("c", 0))
        pq.remove("b")
        self.assertNotIn("b", pq)
        self.assertEqual([pq.pop()[0] for _ in range(3)], ["c", "a", "d"])
        with self.assertRaises(IndexError):
            pq.pop()

    def test_random_against_dict_model(self):
        rng = random.Random(5)
        pq, model = IndexedPriorityQueue(), {}
        for _ in range(3000):
            op = rng.randrange(4)
            k = rng.randrange(60)
            if op == 0 and k not in model:
                p = rng.randint(0, 100)
                pq.push(k, p)
                model[k] = p
            elif op == 1 and k in model:
                p = rng.randint(0, 100)
                pq.update(k, p)
                model[k] = p
            elif op == 2 and k in model:
                pq.remove(k)
                del model[k]
            elif op == 3 and model:
                item, p = pq.pop()
                self.assertEqual(p, min(model.values()))
                self.assertEqual(model[item], p)
                del model[item]
            self.assertEqual(len(pq), len(model))


class TestHashTables(unittest.TestCase):
    def _random_test(self, make, seed):
        rng = random.Random(seed)
        t, ref = make(), {}
        for _ in range(6000):
            op = rng.randrange(4)
            k = rng.choice([rng.randrange(400), "k%d" % rng.randrange(400), (rng.randrange(20), rng.randrange(20))])
            if op <= 1:
                v = rng.random()
                t.put(k, v)
                ref[k] = v
            elif op == 2:
                self.assertEqual(t.remove(k), k in ref)
                ref.pop(k, None)
            else:
                self.assertEqual(t.get(k, "x"), ref.get(k, "x"))
                self.assertEqual(k in t, k in ref)
            self.assertEqual(len(t), len(ref))
        self.assertEqual(dict(t.items()), ref)

    def test_chaining(self):
        self._random_test(ChainingHashTable, 10)

    def test_open_addressing_linear(self):
        self._random_test(lambda: OpenAddressingHashTable(probing="linear"), 11)

    def test_open_addressing_quadratic(self):
        self._random_test(lambda: OpenAddressingHashTable(probing="quadratic"), 12)

    def test_open_addressing_double(self):
        self._random_test(lambda: OpenAddressingHashTable(probing="double"), 13)

    def test_load_factor_stays_bounded(self):
        for t in (ChainingHashTable(), OpenAddressingHashTable()):
            for i in range(10000):
                t.put(i, i)
            self.assertLessEqual(t.load_factor(), 0.75)
        c = ChainingHashTable()
        for i in range(10000):
            c.put(i, i)
        self.assertLess(c.max_chain_length(), 20)  # boa dispersão

    def test_tombstones_cleaned_on_rehash(self):
        t = OpenAddressingHashTable(probing="linear")
        for r in range(30):
            for i in range(50):
                t.put(i + r * 1000, 1)
            for i in range(50):
                t.remove(i + r * 1000)
        self.assertEqual(len(t), 0)
        self.assertLess(t.capacity, 4096)

    def test_missing_key_raises(self):
        for t in (ChainingHashTable(), OpenAddressingHashTable(probing="double")):
            with self.assertRaises(KeyError):
                t["nada"]
            with self.assertRaises(KeyError):
                del t["nada"]

    def test_invalid_probing(self):
        with self.assertRaises(ValueError):
            OpenAddressingHashTable(probing="xyz")

    def test_hash_key_properties(self):
        self.assertEqual(hash_key("abc"), hash_key("abc"))
        self.assertNotEqual(hash_key("abc"), hash_key("abd"))
        self.assertNotEqual(hash_key((1, 2)), hash_key((2, 1)))
        # dispersão razoável dos baldes para inteiros sequenciais
        buckets = [0] * 64
        for i in range(6400):
            buckets[hash_key(i) & 63] += 1
        self.assertLess(max(buckets), 160)
        self.assertGreater(min(buckets), 50)


class TestBloomAndCMS(unittest.TestCase):
    def test_no_false_negatives_and_low_fp(self):
        bf = BloomFilter.from_capacity(5000, 0.01)
        for i in range(5000):
            bf.add(i)
        self.assertTrue(all(i in bf for i in range(5000)))
        fp = sum(1 for i in range(5000, 25000) if i in bf) / 20000
        self.assertLess(fp, 0.03)
        self.assertLess(abs(bf.estimated_fp_rate() - 0.01), 0.01)

    def test_strings(self):
        bf = BloomFilter(2048, 4)
        for w in ["rua", "avenida", "praça"]:
            bf.add(w)
        self.assertIn("rua", bf)
        self.assertIn("praça", bf)

    def test_count_min_never_underestimates(self):
        rng = random.Random(6)
        cms, truth = CountMinSketch(512, 4), {}
        for _ in range(20000):
            k = int(rng.paretovariate(1.2)) % 300
            cms.add(k)
            truth[k] = truth.get(k, 0) + 1
        for k, c in truth.items():
            self.assertGreaterEqual(cms.estimate(k), c)
        # erro absoluto máximo esperado ~ e/width * N
        bound = math.e / 512 * 20000 * 3
        self.assertTrue(all(cms.estimate(k) - c <= bound for k, c in truth.items()))
        top = max(truth, key=truth.get)
        self.assertGreaterEqual(cms.estimate(top), truth[top])


class TestLRU(unittest.TestCase):
    def test_eviction_order(self):
        c = LRUCache(2)
        c.put("a", 1)
        c.put("b", 2)
        self.assertEqual(c.get("a"), 1)  # a vira o mais recente
        c.put("c", 3)                    # expulsa b
        self.assertIsNone(c.get("b"))
        self.assertEqual(c.get("a"), 1)
        self.assertEqual(c.get("c"), 3)
        self.assertEqual(c.evictions, 1)
        self.assertEqual(c.keys_mru_first(), ["c", "a"])

    def test_update_existing(self):
        c = LRUCache(2)
        c.put("a", 1)
        c.put("b", 2)
        c.put("a", 10)
        c.put("c", 3)  # expulsa b
        self.assertEqual(c.get("a"), 10)
        self.assertNotIn("b", c)

    def test_random_against_reference(self):
        from collections import OrderedDict
        rng = random.Random(7)
        cap = 20
        c, ref = LRUCache(cap), OrderedDict()
        for _ in range(5000):
            k = rng.randrange(40)
            if rng.random() < 0.5:
                c.put(k, k * 2)
                ref[k] = k * 2
                ref.move_to_end(k)
                if len(ref) > cap:
                    ref.popitem(last=False)
            else:
                got = c.get(k)
                if k in ref:
                    ref.move_to_end(k)
                    self.assertEqual(got, ref[k])
                else:
                    self.assertIsNone(got)
        self.assertEqual(c.keys_mru_first(), list(reversed(ref.keys())))

    def test_invalid_capacity(self):
        with self.assertRaises(ValueError):
            LRUCache(0)

    def test_hit_rate(self):
        c = LRUCache(4)
        c.put(1, 1)
        c.get(1)
        c.get(2)
        self.assertAlmostEqual(c.hit_rate(), 0.5)


if __name__ == "__main__":
    unittest.main()
