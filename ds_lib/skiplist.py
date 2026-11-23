"""Skip List: alternativa probabilística à árvore balanceada.

Esperado O(log n) para insert/get/delete. Semente configurável (reprodutível).
"""

import random


class _SNode:
    __slots__ = ("key", "value", "forward")

    def __init__(self, key, value, level):
        self.key = key
        self.value = value
        self.forward = [None] * level


class SkipList:
    MAX_LEVEL = 20

    def __init__(self, seed=None, p=0.5):
        self.head = _SNode(None, None, self.MAX_LEVEL)
        self.level = 1
        self._n = 0
        self._rng = random.Random(seed)
        self.p = p
        self.comparisons = 0

    def __len__(self):
        return self._n

    def _random_level(self):
        lvl = 1
        while lvl < self.MAX_LEVEL and self._rng.random() < self.p:
            lvl += 1
        return lvl

    def _predecessors(self, key):
        update = [self.head] * self.MAX_LEVEL
        x = self.head
        for i in range(self.level - 1, -1, -1):
            while x.forward[i] is not None and x.forward[i].key < key:
                self.comparisons += 1
                x = x.forward[i]
            update[i] = x
        return update

    def insert(self, key, value=None):
        update = self._predecessors(key)
        cand = update[0].forward[0]
        if cand is not None and cand.key == key:
            cand.value = value
            return
        lvl = self._random_level()
        if lvl > self.level:
            self.level = lvl
        node = _SNode(key, value, lvl)
        for i in range(lvl):
            node.forward[i] = update[i].forward[i]
            update[i].forward[i] = node
        self._n += 1

    def get(self, key, default=None):
        cand = self._predecessors(key)[0].forward[0]
        if cand is not None and cand.key == key:
            return cand.value
        return default

    def __contains__(self, key):
        cand = self._predecessors(key)[0].forward[0]
        return cand is not None and cand.key == key

    def delete(self, key):
        update = self._predecessors(key)
        cand = update[0].forward[0]
        if cand is None or cand.key != key:
            return False
        for i in range(self.level):
            if update[i].forward[i] is not cand:
                break
            update[i].forward[i] = cand.forward[i]
        while self.level > 1 and self.head.forward[self.level - 1] is None:
            self.level -= 1
        self._n -= 1
        return True

    def items(self):
        x = self.head.forward[0]
        while x is not None:
            yield x.key, x.value
            x = x.forward[0]

    def range(self, lo, hi):
        out = []
        x = self._predecessors(lo)[0].forward[0]
        while x is not None and x.key <= hi:
            out.append((x.key, x.value))
            x = x.forward[0]
        return out
