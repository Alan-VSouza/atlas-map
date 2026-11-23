"""Cache LRU: lista duplamente encadeada + tabela hash. get/put em O(1)."""

from .hashtable import ChainingHashTable
from .linked_list import DoublyLinkedList


class LRUCache:
    def __init__(self, capacity):
        if capacity < 1:
            raise ValueError("capacity deve ser >= 1")
        self.capacity = capacity
        self._map = ChainingHashTable()
        self._list = DoublyLinkedList()  # frente = mais recente
        self.hits = 0
        self.misses = 0
        self.evictions = 0

    def __len__(self):
        return len(self._list)

    def __contains__(self, key):
        return key in self._map

    def get(self, key, default=None):
        node = self._map.get(key)
        if node is None:
            self.misses += 1
            return default
        self.hits += 1
        self._list.move_to_front(node)
        return node.value

    def put(self, key, value):
        node = self._map.get(key)
        if node is not None:
            node.value = value
            self._list.move_to_front(node)
            return
        if len(self._list) >= self.capacity:
            old = self._list.pop_back()
            self._map.remove(old.key)
            self.evictions += 1
        self._map.put(key, self._list.push_front(key, value))

    def keys_mru_first(self):
        return [n.key for n in self._list]

    def hit_rate(self):
        total = self.hits + self.misses
        return self.hits / total if total else 0.0
