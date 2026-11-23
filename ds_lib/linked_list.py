"""Lista duplamente encadeada com sentinelas (cabeça e cauda).

Complexidade: push/pop/remove/move_to_front em O(1); iteração O(n).
"""


class DNode:
    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class DoublyLinkedList:
    def __init__(self):
        self.head = DNode()
        self.tail = DNode()
        self.head.next = self.tail
        self.tail.prev = self.head
        self._size = 0

    def __len__(self):
        return self._size

    def _insert_between(self, node, left, right):
        node.prev = left
        node.next = right
        left.next = node
        right.prev = node
        self._size += 1
        return node

    def push_front(self, key, value=None):
        return self._insert_between(DNode(key, value), self.head, self.head.next)

    def push_back(self, key, value=None):
        return self._insert_between(DNode(key, value), self.tail.prev, self.tail)

    def remove(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = node.next = None
        self._size -= 1
        return node

    def pop_front(self):
        if self._size == 0:
            return None
        return self.remove(self.head.next)

    def pop_back(self):
        if self._size == 0:
            return None
        return self.remove(self.tail.prev)

    def move_to_front(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = self.head
        node.next = self.head.next
        self.head.next.prev = node
        self.head.next = node

    def __iter__(self):
        node = self.head.next
        while node is not self.tail:
            yield node
            node = node.next

    def to_list(self):
        return [(n.key, n.value) for n in self]
