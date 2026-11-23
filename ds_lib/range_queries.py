"""Consultas em intervalo: Segment Tree, Fenwick Tree (BIT) e Sparse Table."""


class SegmentTree:
    """Árvore de segmentos iterativa para qualquer operação associativa.

    build O(n), update O(log n), query O(log n). Consulta em [l, r) (r exclusivo).
    """

    def __init__(self, data, op=lambda a, b: a + b, identity=0):
        self.n = len(data)
        self.op = op
        self.identity = identity
        self.t = [identity] * (2 * self.n)
        for i, v in enumerate(data):
            self.t[self.n + i] = v
        for i in range(self.n - 1, 0, -1):
            self.t[i] = op(self.t[2 * i], self.t[2 * i + 1])

    def update(self, i, value):
        i += self.n
        self.t[i] = value
        while i > 1:
            i >>= 1
            self.t[i] = self.op(self.t[2 * i], self.t[2 * i + 1])

    def get(self, i):
        return self.t[self.n + i]

    def query(self, l, r):
        res_l, res_r = self.identity, self.identity
        l += self.n
        r += self.n
        while l < r:
            if l & 1:
                res_l = self.op(res_l, self.t[l])
                l += 1
            if r & 1:
                r -= 1
                res_r = self.op(self.t[r], res_r)
            l >>= 1
            r >>= 1
        return self.op(res_l, res_r)


class FenwickTree:
    """Somas de prefixo com atualização pontual. add/prefix em O(log n)."""

    def __init__(self, n_or_data):
        if isinstance(n_or_data, int):
            self.n = n_or_data
            self.t = [0] * (self.n + 1)
        else:
            self.n = len(n_or_data)
            self.t = [0] * (self.n + 1)
            for i, v in enumerate(n_or_data):
                self.t[i + 1] += v
                j = (i + 1) + ((i + 1) & -(i + 1))
                if j <= self.n:
                    self.t[j] += self.t[i + 1]

    def add(self, i, delta):
        i += 1
        while i <= self.n:
            self.t[i] += delta
            i += i & -i

    def prefix(self, i):
        """Soma de [0, i) ."""
        s = 0
        while i > 0:
            s += self.t[i]
            i -= i & -i
        return s

    def range_sum(self, l, r):
        """Soma de [l, r)."""
        return self.prefix(r) - self.prefix(l)


class SparseTable:
    """Consulta de mínimo/máximo (op idempotente) em O(1) após build O(n log n)."""

    def __init__(self, data, op=min):
        self.op = op
        n = len(data)
        self.table = [list(data)]
        j = 1
        while (1 << j) <= n:
            prev = self.table[-1]
            half = 1 << (j - 1)
            self.table.append([op(prev[i], prev[i + half]) for i in range(n - (1 << j) + 1)])
            j += 1

    def query(self, l, r):
        """Consulta [l, r) com r > l."""
        if r <= l:
            raise ValueError("intervalo vazio")
        k = (r - l).bit_length() - 1
        return self.op(self.table[k][l], self.table[k][r - (1 << k)])
