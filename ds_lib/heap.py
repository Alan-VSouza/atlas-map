"""Heap binária (min ou max) e fila de prioridade indexada.

push/pop O(log n); peek O(1); heapify (Floyd) O(n).
"""

from .hashtable import ChainingHashTable


class BinaryHeap:
    def __init__(self, key=None, max_heap=False, items=None):
        self._a = []
        self._key = key if key is not None else (lambda x: x)
        self._max = max_heap
        self.comparisons = 0
        self.swaps = 0
        if items is not None:
            self._a = list(items)
            self.heapify()

    def __len__(self):
        return len(self._a)

    def _better(self, i, j):
        """True se a[i] tem prioridade estritamente maior que a[j]."""
        self.comparisons += 1
        ki, kj = self._key(self._a[i]), self._key(self._a[j])
        return ki > kj if self._max else ki < kj

    def _swap(self, i, j):
        self._a[i], self._a[j] = self._a[j], self._a[i]
        self.swaps += 1

    def _sift_up(self, i):
        while i > 0:
            p = (i - 1) // 2
            if self._better(i, p):
                self._swap(i, p)
                i = p
            else:
                break

    def _sift_down(self, i):
        n = len(self._a)
        while True:
            l, r = 2 * i + 1, 2 * i + 2
            best = i
            if l < n and self._better(l, best):
                best = l
            if r < n and self._better(r, best):
                best = r
            if best == i:
                break
            self._swap(i, best)
            i = best

    def heapify(self):
        for i in range(len(self._a) // 2 - 1, -1, -1):
            self._sift_down(i)

    def push(self, item):
        self._a.append(item)
        self._sift_up(len(self._a) - 1)

    def peek(self):
        if not self._a:
            raise IndexError("peek from empty heap")
        return self._a[0]

    def pop(self):
        if not self._a:
            raise IndexError("pop from empty heap")
        top = self._a[0]
        last = self._a.pop()
        if self._a:
            self._a[0] = last
            self._sift_down(0)
        return top

    def pushpop(self, item):
        """Empurra e remove o topo numa só operação (útil para top-K)."""
        if not self._a:
            return item
        self._a.append(item)
        self._sift_up(len(self._a) - 1)
        return self.pop()

    def to_list(self):
        """Array interno (ordem de heap, útil para visualização)."""
        return list(self._a)

    def is_valid(self):
        for i in range(1, len(self._a)):
            p = (i - 1) // 2
            if self._better(i, p):
                return False
        return True


class IndexedPriorityQueue:
    """Fila de prioridade mínima que permite alterar a prioridade de um item.

    Usa uma tabela hash própria item -> posição no heap.
    push/update/remove/pop em O(log n); contains/priority em O(1).
    """

    def __init__(self):
        self._items = []
        self._prios = []
        self._pos = ChainingHashTable()

    def __len__(self):
        return len(self._items)

    def __contains__(self, item):
        return item in self._pos

    def priority(self, item):
        return self._prios[self._pos[item]]

    def _swap(self, i, j):
        self._items[i], self._items[j] = self._items[j], self._items[i]
        self._prios[i], self._prios[j] = self._prios[j], self._prios[i]
        self._pos.put(self._items[i], i)
        self._pos.put(self._items[j], j)

    def _up(self, i):
        while i > 0:
            p = (i - 1) // 2
            if self._prios[i] < self._prios[p]:
                self._swap(i, p)
                i = p
            else:
                break

    def _down(self, i):
        n = len(self._items)
        while True:
            l, r, best = 2 * i + 1, 2 * i + 2, i
            if l < n and self._prios[l] < self._prios[best]:
                best = l
            if r < n and self._prios[r] < self._prios[best]:
                best = r
            if best == i:
                break
            self._swap(i, best)
            i = best

    def push(self, item, priority):
        if item in self._pos:
            raise KeyError("item já existe; use update()")
        self._items.append(item)
        self._prios.append(priority)
        self._pos.put(item, len(self._items) - 1)
        self._up(len(self._items) - 1)

    def update(self, item, priority):
        i = self._pos[item]
        old = self._prios[i]
        self._prios[i] = priority
        if priority < old:
            self._up(i)
        else:
            self._down(i)

    def peek(self):
        if not self._items:
            raise IndexError("peek from empty queue")
        return self._items[0], self._prios[0]

    def _remove_at(self, i):
        last = len(self._items) - 1
        item, prio = self._items[i], self._prios[i]
        if i != last:
            self._swap(i, last)
        self._items.pop()
        self._prios.pop()
        self._pos.remove(item)
        if i < len(self._items):
            self._up(i)
            self._down(i)
        return item, prio

    def pop(self):
        if not self._items:
            raise IndexError("pop from empty queue")
        return self._remove_at(0)

    def remove(self, item):
        return self._remove_at(self._pos[item])
