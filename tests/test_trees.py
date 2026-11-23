import bisect
import math
import random
import unittest

from ds_lib import AVLTree, FenwickTree, SegmentTree, SkipList, SparseTable


class TestAVL(unittest.TestCase):
    def test_random_against_sorted_dict(self):
        rng = random.Random(20)
        t, ref = AVLTree(), {}
        for step in range(6000):
            k = rng.randrange(800)
            op = rng.randrange(3)
            if op == 0:
                t.insert(k, step)
                ref[k] = step
            elif op == 1:
                self.assertEqual(t.delete(k), k in ref)
                ref.pop(k, None)
            else:
                self.assertEqual(t.get(k, "none"), ref.get(k, "none"))
            self.assertEqual(len(t), len(ref))
            if step % 500 == 0:
                t.check_invariants()
        t.check_invariants()
        self.assertEqual(list(t.items()), sorted(ref.items()))

    def test_sequential_insert_stays_balanced(self):
        t = AVLTree()
        n = 10000
        for i in range(n):
            t.insert(i)
        t.check_invariants()
        self.assertLessEqual(t.height(), 1.45 * math.log2(n + 2))
        self.assertGreater(t.rotations, 0)

    def test_range_min_max(self):
        rng = random.Random(21)
        keys = rng.sample(range(5000), 500)
        t = AVLTree()
        for k in keys:
            t.insert(k, k)
        sk = sorted(keys)
        for _ in range(100):
            lo, hi = sorted((rng.randrange(5000), rng.randrange(5000)))
            expected = sk[bisect.bisect_left(sk, lo):bisect.bisect_right(sk, hi)]
            self.assertEqual([k for k, _ in t.range(lo, hi)], expected)
        self.assertEqual(t.min_key(), sk[0])
        self.assertEqual(t.max_key(), sk[-1])

    def test_delete_all_and_empty_errors(self):
        t = AVLTree()
        keys = list(range(300))
        random.Random(22).shuffle(keys)
        for k in keys:
            t.insert(k)
        random.Random(23).shuffle(keys)
        for k in keys:
            self.assertTrue(t.delete(k))
            t.check_invariants()
        self.assertEqual(len(t), 0)
        self.assertFalse(t.delete(1))
        with self.assertRaises(ValueError):
            t.min_key()

    def test_string_keys(self):
        t = AVLTree()
        for w in ["pera", "uva", "maçã", "banana"]:
            t.insert(w, len(w))
        self.assertEqual([k for k, _ in t.items()], sorted(["pera", "uva", "maçã", "banana"]))


class TestSkipList(unittest.TestCase):
    def test_random_against_dict(self):
        rng = random.Random(30)
        s, ref = SkipList(seed=5), {}
        for step in range(6000):
            k = rng.randrange(700)
            op = rng.randrange(3)
            if op == 0:
                s.insert(k, step)
                ref[k] = step
            elif op == 1:
                self.assertEqual(s.delete(k), k in ref)
                ref.pop(k, None)
            else:
                self.assertEqual(s.get(k, "none"), ref.get(k, "none"))
                self.assertEqual(k in s, k in ref)
            self.assertEqual(len(s), len(ref))
        self.assertEqual(list(s.items()), sorted(ref.items()))

    def test_range(self):
        s = SkipList(seed=1)
        for k in range(0, 100, 3):
            s.insert(k, k)
        self.assertEqual([k for k, _ in s.range(10, 30)], [12, 15, 18, 21, 24, 27, 30])
        self.assertEqual(s.range(1000, 2000), [])

    def test_logarithmic_comparisons(self):
        s = SkipList(seed=2)
        n = 20000
        for k in random.Random(3).sample(range(n * 5), n):
            s.insert(k, k)
        s.comparisons = 0
        for k in range(0, n * 5, 25):
            s.get(k)
        per_query = s.comparisons / (n * 5 // 25)
        self.assertLess(per_query, 8 * math.log2(n))


class TestRangeStructures(unittest.TestCase):
    def test_segment_tree_sum_min_max(self):
        rng = random.Random(40)
        for n in (1, 2, 7, 64, 100, 333):
            data = [rng.randint(-50, 50) for _ in range(n)]
            ssum = SegmentTree(data)
            smin = SegmentTree(data, op=min, identity=float("inf"))
            smax = SegmentTree(data, op=max, identity=float("-inf"))
            for _ in range(200):
                if rng.random() < 0.3:
                    i, v = rng.randrange(n), rng.randint(-50, 50)
                    data[i] = v
                    ssum.update(i, v)
                    smin.update(i, v)
                    smax.update(i, v)
                l = rng.randrange(n)
                r = rng.randrange(l, n) + 1
                self.assertEqual(ssum.query(l, r), sum(data[l:r]))
                self.assertEqual(smin.query(l, r), min(data[l:r]))
                self.assertEqual(smax.query(l, r), max(data[l:r]))

    def test_segment_tree_non_commutative(self):
        data = list("abcdefgh")
        s = SegmentTree(data, op=lambda a, b: a + b, identity="")
        self.assertEqual(s.query(2, 6), "cdef")
        self.assertEqual(s.query(0, 8), "abcdefgh")

    def test_fenwick(self):
        rng = random.Random(41)
        n = 500
        data = [rng.randint(0, 100) for _ in range(n)]
        fw = FenwickTree(data)
        fw2 = FenwickTree(n)
        for i, v in enumerate(data):
            fw2.add(i, v)
        for _ in range(300):
            if rng.random() < 0.4:
                i, d = rng.randrange(n), rng.randint(-20, 20)
                data[i] += d
                fw.add(i, d)
                fw2.add(i, d)
            l = rng.randrange(n)
            r = rng.randrange(l, n) + 1
            self.assertEqual(fw.range_sum(l, r), sum(data[l:r]))
            self.assertEqual(fw2.range_sum(l, r), sum(data[l:r]))
        self.assertEqual(fw.prefix(0), 0)
        self.assertEqual(fw.prefix(n), sum(data))

    def test_sparse_table(self):
        rng = random.Random(42)
        data = [rng.randint(0, 1000) for _ in range(300)]
        mn, mx = SparseTable(data, min), SparseTable(data, max)
        for _ in range(500):
            l = rng.randrange(300)
            r = rng.randrange(l, 300) + 1
            self.assertEqual(mn.query(l, r), min(data[l:r]))
            self.assertEqual(mx.query(l, r), max(data[l:r]))
        with self.assertRaises(ValueError):
            mn.query(5, 5)


if __name__ == "__main__":
    unittest.main()
