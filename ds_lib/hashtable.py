"""Tabelas hash: encadeamento e endereçamento aberto (linear, quadrático, duplo).

A função de hash é própria (FNV-1a para strings, mixer tipo murmur para
inteiros). Capacidade sempre potência de 2 -> índice = hash & (cap - 1).
Complexidade média O(1) para put/get/remove; pior caso O(n).
"""

_M = 0xFFFFFFFFFFFFFFFF


def _mix64(x):
    x &= _M
    x ^= x >> 33
    x = (x * 0xFF51AFD7ED558CCD) & _M
    x ^= x >> 33
    x = (x * 0xC4CEB9FE1A85EC53) & _M
    x ^= x >> 33
    return x


def hash_key(k):
    """Hash de 64 bits para int, str, bytes, tuple (recursivo) e demais objetos."""
    if isinstance(k, int):
        return _mix64(k)
    if isinstance(k, str):
        h = 0xCBF29CE484222325
        for b in k.encode("utf-8"):
            h ^= b
            h = (h * 0x100000001B3) & _M
        return _mix64(h)
    if isinstance(k, bytes):
        h = 0xCBF29CE484222325
        for b in k:
            h ^= b
            h = (h * 0x100000001B3) & _M
        return _mix64(h)
    if isinstance(k, tuple):
        h = 0x9E3779B97F4A7C15
        for item in k:
            h = _mix64(h ^ hash_key(item))
            h = (h + 0x9E3779B97F4A7C15) & _M
        return h
    return _mix64(hash(k))


def _pow2_at_least(n):
    c = 8
    while c < n:
        c *= 2
    return c


class _CNode:
    __slots__ = ("key", "value", "hash", "next")

    def __init__(self, key, value, h, nxt):
        self.key = key
        self.value = value
        self.hash = h
        self.next = nxt


class ChainingHashTable:
    """Hash com encadeamento separado (lista ligada por balde)."""

    def __init__(self, capacity=8, max_load=0.75):
        self._cap = _pow2_at_least(capacity)
        self._buckets = [None] * self._cap
        self._n = 0
        self.max_load = max_load
        self.collisions = 0
        self.resizes = 0

    def __len__(self):
        return self._n

    def load_factor(self):
        return self._n / self._cap

    @property
    def capacity(self):
        return self._cap

    def _resize(self, new_cap):
        old = self._buckets
        self._buckets = [None] * new_cap
        self._cap = new_cap
        self.resizes += 1
        mask = new_cap - 1
        for node in old:
            while node is not None:
                nxt = node.next
                i = node.hash & mask
                node.next = self._buckets[i]
                self._buckets[i] = node
                node = nxt

    def put(self, key, value):
        h = hash_key(key)
        i = h & (self._cap - 1)
        node = self._buckets[i]
        while node is not None:
            if node.hash == h and node.key == key:
                node.value = value
                return
            node = node.next
        if self._buckets[i] is not None:
            self.collisions += 1
        self._buckets[i] = _CNode(key, value, h, self._buckets[i])
        self._n += 1
        if self._n / self._cap > self.max_load:
            self._resize(self._cap * 2)

    def get(self, key, default=None):
        h = hash_key(key)
        node = self._buckets[h & (self._cap - 1)]
        while node is not None:
            if node.hash == h and node.key == key:
                return node.value
            node = node.next
        return default

    def __getitem__(self, key):
        h = hash_key(key)
        node = self._buckets[h & (self._cap - 1)]
        while node is not None:
            if node.hash == h and node.key == key:
                return node.value
            node = node.next
        raise KeyError(key)

    def __setitem__(self, key, value):
        self.put(key, value)

    def __contains__(self, key):
        h = hash_key(key)
        node = self._buckets[h & (self._cap - 1)]
        while node is not None:
            if node.hash == h and node.key == key:
                return True
            node = node.next
        return False

    def remove(self, key):
        h = hash_key(key)
        i = h & (self._cap - 1)
        prev = None
        node = self._buckets[i]
        while node is not None:
            if node.hash == h and node.key == key:
                if prev is None:
                    self._buckets[i] = node.next
                else:
                    prev.next = node.next
                self._n -= 1
                return True
            prev = node
            node = node.next
        return False

    def __delitem__(self, key):
        if not self.remove(key):
            raise KeyError(key)

    def items(self):
        for node in self._buckets:
            while node is not None:
                yield node.key, node.value
                node = node.next

    def keys(self):
        for k, _ in self.items():
            yield k

    def values(self):
        for _, v in self.items():
            yield v

    def bucket_lengths(self):
        out = []
        for node in self._buckets:
            c = 0
            while node is not None:
                c += 1
                node = node.next
            out.append(c)
        return out

    def max_chain_length(self):
        return max(self.bucket_lengths())


_EMPTY, _USED, _DELETED = 0, 1, 2


class OpenAddressingHashTable:
    """Hash com endereçamento aberto. probing: 'linear' | 'quadratic' | 'double'.

    Remoções usam lápides (tombstones); o rehash limpa as lápides.
    """

    def __init__(self, capacity=8, probing="linear", max_load=0.5):
        if probing not in ("linear", "quadratic", "double"):
            raise ValueError("probing deve ser linear, quadratic ou double")
        self.probing = probing
        self.max_load = max_load
        self._cap = _pow2_at_least(capacity)
        self._alloc(self._cap)
        self._n = 0
        self._filled = 0  # usados + lápides
        self.probes = 0
        self.resizes = 0

    def _alloc(self, cap):
        self._cap = cap
        self._mask = cap - 1
        self._state = bytearray(cap)
        self._keys = [None] * cap
        self._vals = [None] * cap
        self._hashes = [0] * cap

    def __len__(self):
        return self._n

    def load_factor(self):
        return self._n / self._cap

    @property
    def capacity(self):
        return self._cap

    def _slot(self, h, i, step):
        if self.probing == "linear":
            return (h + i) & self._mask
        if self.probing == "quadratic":
            return (h + (i * (i + 1)) // 2) & self._mask
        return (h + i * step) & self._mask

    @staticmethod
    def _step(h):
        return ((h >> 32) ^ (h * 0x9E3779B1)) & 0xFFFFFFFF | 1  # ímpar -> cobre a tabela

    def _find(self, key, h):
        """Retorna (indice_da_chave ou -1, indice_livre_para_inserir)."""
        step = self._step(h) if self.probing == "double" else 0
        first_del = -1
        for i in range(self._cap):
            idx = self._slot(h, i, step)
            self.probes += 1
            s = self._state[idx]
            if s == _EMPTY:
                return -1, (first_del if first_del != -1 else idx)
            if s == _DELETED:
                if first_del == -1:
                    first_del = idx
            elif self._hashes[idx] == h and self._keys[idx] == key:
                return idx, idx
        return -1, first_del

    def _rehash(self, new_cap):
        old = [(self._keys[i], self._vals[i], self._hashes[i])
               for i in range(self._cap) if self._state[i] == _USED]
        self._alloc(new_cap)
        self._n = 0
        self._filled = 0
        self.resizes += 1
        for k, v, h in old:
            _, free = self._find(k, h)
            self._state[free] = _USED
            self._keys[free] = k
            self._vals[free] = v
            self._hashes[free] = h
            self._n += 1
            self._filled += 1

    def put(self, key, value):
        h = hash_key(key)
        idx, free = self._find(key, h)
        if idx >= 0:
            self._vals[idx] = value
            return
        if self._state[free] == _EMPTY:
            self._filled += 1
        self._state[free] = _USED
        self._keys[free] = key
        self._vals[free] = value
        self._hashes[free] = h
        self._n += 1
        if self._filled / self._cap > self.max_load:
            grow = self._n / self._cap >= self.max_load * 0.6
            self._rehash(self._cap * 2 if grow else self._cap)

    def get(self, key, default=None):
        h = hash_key(key)
        idx, _ = self._find(key, h)
        return self._vals[idx] if idx >= 0 else default

    def __getitem__(self, key):
        h = hash_key(key)
        idx, _ = self._find(key, h)
        if idx < 0:
            raise KeyError(key)
        return self._vals[idx]

    def __setitem__(self, key, value):
        self.put(key, value)

    def __contains__(self, key):
        idx, _ = self._find(key, hash_key(key))
        return idx >= 0

    def remove(self, key):
        h = hash_key(key)
        idx, _ = self._find(key, h)
        if idx < 0:
            return False
        self._state[idx] = _DELETED
        self._keys[idx] = None
        self._vals[idx] = None
        self._n -= 1
        return True

    def __delitem__(self, key):
        if not self.remove(key):
            raise KeyError(key)

    def items(self):
        for i in range(self._cap):
            if self._state[i] == _USED:
                yield self._keys[i], self._vals[i]

    def keys(self):
        for k, _ in self.items():
            yield k

    def values(self):
        for _, v in self.items():
            yield v

    def tombstones(self):
        return self._filled - self._n
