import random
import unittest

from ds_lib import HuffmanCodec, Trie, kmp_search, levenshtein


def ref_levenshtein(a, b):
    m, n = len(a), len(b)
    d = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        d[i][0] = i
    for j in range(n + 1):
        d[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
    return d[m][n]


class TestTrie(unittest.TestCase):
    def test_insert_contains_prefix_delete(self):
        t = Trie()
        for w in ["rua", "ruas", "rural", "avenida", "av"]:
            t.insert(w)
        self.assertEqual(len(t), 5)
        self.assertTrue(t.contains("rua"))
        self.assertFalse(t.contains("ru"))
        self.assertTrue(t.has_prefix("ru"))
        self.assertFalse(t.has_prefix("rx"))
        self.assertTrue(t.delete("rua"))
        self.assertFalse(t.contains("rua"))
        self.assertTrue(t.contains("ruas"))
        self.assertFalse(t.delete("rua"))
        self.assertFalse(t.delete("zzz"))
        self.assertEqual(len(t), 4)

    def test_delete_prunes_nodes(self):
        t = Trie()
        before = t.node_count
        t.insert("abcdef")
        self.assertEqual(t.node_count, before + 6)
        t.delete("abcdef")
        self.assertEqual(t.node_count, before)

    def test_autocomplete_matches_bruteforce(self):
        rng = random.Random(50)
        letters = "abc"
        words = {"".join(rng.choice(letters) for _ in range(rng.randint(1, 6))) for _ in range(300)}
        weights = {w: rng.randint(1, 20) for w in words}
        t = Trie()
        for w in words:
            t.insert(w, weights[w])
        for prefix in ["", "a", "b", "ab", "abc", "cc", "zzz"]:
            for k in (1, 3, 10):
                cands = sorted(((w, weights[w]) for w in words if w.startswith(prefix)),
                               key=lambda p: (-p[1], p[0]))[:k]
                self.assertEqual(t.autocomplete(prefix, k), cands, (prefix, k))

    def test_weights_accumulate(self):
        t = Trie()
        t.insert("oi", 2)
        t.insert("oi", 3)
        self.assertEqual(t.weight("oi"), 5)
        self.assertEqual(len(t), 1)

    def test_path_and_unicode(self):
        t = Trie()
        t.insert("praça")
        self.assertEqual(t.path("pra"), ["p", "r", "a"])
        self.assertEqual(t.path("prx"), ["p", "r"])
        self.assertTrue(t.contains("praça"))


class TestHuffman(unittest.TestCase):
    def test_roundtrip_and_compression(self):
        text = "abracadabra alakazam " * 50
        c = HuffmanCodec().fit(text)
        bits = c.encode(text)
        self.assertEqual(c.decode(bits), text)
        self.assertLess(c.compression_ratio(text), 0.6)

    def test_prefix_free(self):
        c = HuffmanCodec().fit("the quick brown fox jumps over the lazy dog")
        codes = list(c.codes.values())
        for a in codes:
            for b in codes:
                if a is not b:
                    self.assertFalse(b.startswith(a) and a != b)

    def test_optimal_lengths_frequent_symbol_shorter(self):
        c = HuffmanCodec().fit("a" * 100 + "b" * 10 + "c" * 5 + "d" * 1)
        self.assertLessEqual(len(c.codes["a"]), len(c.codes["d"]))

    def test_edge_cases(self):
        c = HuffmanCodec().fit("")
        self.assertEqual(c.decode(""), "")
        c = HuffmanCodec().fit("zzzz")
        self.assertEqual(c.decode(c.encode("zzzz")), "zzzz")
        c = HuffmanCodec().fit("ab")
        self.assertEqual(c.decode(c.encode("abba")), "abba")

    def test_random_roundtrip(self):
        rng = random.Random(51)
        text = "".join(rng.choice("abcdefgh çã\n") for _ in range(5000))
        c = HuffmanCodec().fit(text)
        self.assertEqual(c.decode(c.encode(text)), text)


class TestStrings(unittest.TestCase):
    def test_levenshtein_known(self):
        self.assertEqual(levenshtein("kitten", "sitting"), 3)
        self.assertEqual(levenshtein("", "abc"), 3)
        self.assertEqual(levenshtein("abc", "abc"), 0)
        self.assertEqual(levenshtein("flaw", "lawn"), 2)

    def test_levenshtein_random_against_full_matrix(self):
        rng = random.Random(52)
        for _ in range(300):
            a = "".join(rng.choice("abc") for _ in range(rng.randint(0, 9)))
            b = "".join(rng.choice("abc") for _ in range(rng.randint(0, 9)))
            self.assertEqual(levenshtein(a, b), ref_levenshtein(a, b))
            self.assertEqual(levenshtein(a, b), levenshtein(b, a))

    def test_kmp_against_naive(self):
        rng = random.Random(53)
        for _ in range(400):
            text = "".join(rng.choice("ab") for _ in range(rng.randint(0, 40)))
            pat = "".join(rng.choice("ab") for _ in range(rng.randint(1, 5)))
            expected = [i for i in range(len(text) - len(pat) + 1) if text.startswith(pat, i)]
            self.assertEqual(kmp_search(text, pat), expected)
        self.assertEqual(kmp_search("aaaa", "aa"), [0, 1, 2])
        self.assertEqual(kmp_search("abc", ""), [])


if __name__ == "__main__":
    unittest.main()
