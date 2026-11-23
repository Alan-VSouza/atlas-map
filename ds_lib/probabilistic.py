"""Estruturas probabilísticas: Bloom Filter e Count-Min Sketch."""

import math

from .hashtable import hash_key


class BloomFilter:
    """Pertinência aproximada: sem falsos negativos, falsos positivos possíveis."""

    def __init__(self, num_bits, num_hashes):
        self.m = max(8, int(num_bits))
        self.k = max(1, int(num_hashes))
        self._bits = bytearray((self.m + 7) // 8)
        self.count = 0

    @classmethod
    def from_capacity(cls, n, fp_rate=0.01):
        n = max(1, n)
        m = math.ceil(-n * math.log(fp_rate) / (math.log(2) ** 2))
        k = max(1, round(m / n * math.log(2)))
        return cls(m, k)

    def _indexes(self, item):
        h1 = hash_key(item)
        h2 = hash_key(h1) | 1
        for i in range(self.k):
            yield (h1 + i * h2) % self.m

    def add(self, item):
        for idx in self._indexes(item):
            self._bits[idx >> 3] |= 1 << (idx & 7)
        self.count += 1

    def __contains__(self, item):
        for idx in self._indexes(item):
            if not self._bits[idx >> 3] & (1 << (idx & 7)):
                return False
        return True

    def bits_set(self):
        return sum(bin(b).count("1") for b in self._bits)

    def estimated_fp_rate(self):
        fill = self.bits_set() / self.m
        return fill ** self.k


class CountMinSketch:
    """Contagem aproximada de frequências em memória fixa (nunca subestima)."""

    def __init__(self, width=256, depth=4):
        self.width = width
        self.depth = depth
        self._rows = [[0] * width for _ in range(depth)]
        self.total = 0

    def add(self, item, count=1):
        for d in range(self.depth):
            self._rows[d][hash_key((d, item)) % self.width] += count
        self.total += count

    def estimate(self, item):
        best = None
        for d in range(self.depth):
            v = self._rows[d][hash_key((d, item)) % self.width]
            if best is None or v < best:
                best = v
        return best
