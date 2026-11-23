"""Vetor dinâmico, pilha, deque e fila circular.

A "memória" é uma lista pré-alocada de tamanho fixo; o crescimento (dobrar a
capacidade) é feito manualmente, o que permite medir o custo amortizado.
"""


class DynamicArray:
    """Append amortizado O(1) (dobra a capacidade); acesso por índice O(1)."""

    def __init__(self, capacity=4):
        self._cap = max(1, capacity)
        self._buf = [None] * self._cap
        self._n = 0
        self.resizes = 0
        self.copies = 0  # elementos copiados em redimensionamentos

    def __len__(self):
        return self._n

    def _resize(self, new_cap):
        new = [None] * new_cap
        for i in range(self._n):
            new[i] = self._buf[i]
        self.copies += self._n
        self.resizes += 1
        self._buf = new
        self._cap = new_cap

    def append(self, value):
        if self._n == self._cap:
            self._resize(self._cap * 2)
        self._buf[self._n] = value
        self._n += 1

    def pop(self):
        if self._n == 0:
            raise IndexError("pop from empty array")
        self._n -= 1
        v = self._buf[self._n]
        self._buf[self._n] = None
        if self._cap > 4 and self._n <= self._cap // 4:
            self._resize(self._cap // 2)
        return v

    def _check(self, i):
        if i < 0:
            i += self._n
        if not 0 <= i < self._n:
            raise IndexError("index out of range")
        return i

    def __getitem__(self, i):
        return self._buf[self._check(i)]

    def __setitem__(self, i, v):
        self._buf[self._check(i)] = v

    def __iter__(self):
        for i in range(self._n):
            yield self._buf[i]

    @property
    def capacity(self):
        return self._cap


class Stack:
    """Pilha (LIFO) sobre vetor dinâmico. Todas as operações O(1) amortizado."""

    def __init__(self):
        self._a = DynamicArray()

    def push(self, v):
        self._a.append(v)

    def pop(self):
        if len(self._a) == 0:
            raise IndexError("pop from empty stack")
        return self._a.pop()

    def peek(self):
        if len(self._a) == 0:
            raise IndexError("peek from empty stack")
        return self._a[-1]

    def clear(self):
        self._a = DynamicArray()

    def is_empty(self):
        return len(self._a) == 0

    def __len__(self):
        return len(self._a)

    def to_list(self):
        return list(self._a)


class Deque:
    """Deque sobre buffer circular que dobra de tamanho quando enche."""

    def __init__(self, capacity=8):
        self._cap = max(2, capacity)
        self._buf = [None] * self._cap
        self._head = 0
        self._n = 0

    def __len__(self):
        return self._n

    def _grow(self):
        new = [None] * (self._cap * 2)
        for i in range(self._n):
            new[i] = self._buf[(self._head + i) % self._cap]
        self._buf = new
        self._cap *= 2
        self._head = 0

    def push_back(self, v):
        if self._n == self._cap:
            self._grow()
        self._buf[(self._head + self._n) % self._cap] = v
        self._n += 1

    def push_front(self, v):
        if self._n == self._cap:
            self._grow()
        self._head = (self._head - 1) % self._cap
        self._buf[self._head] = v
        self._n += 1

    def pop_front(self):
        if self._n == 0:
            raise IndexError("pop from empty deque")
        v = self._buf[self._head]
        self._buf[self._head] = None
        self._head = (self._head + 1) % self._cap
        self._n -= 1
        return v

    def pop_back(self):
        if self._n == 0:
            raise IndexError("pop from empty deque")
        idx = (self._head + self._n - 1) % self._cap
        v = self._buf[idx]
        self._buf[idx] = None
        self._n -= 1
        return v

    def peek_front(self):
        if self._n == 0:
            raise IndexError("peek from empty deque")
        return self._buf[self._head]

    def peek_back(self):
        if self._n == 0:
            raise IndexError("peek from empty deque")
        return self._buf[(self._head + self._n - 1) % self._cap]

    def __iter__(self):
        for i in range(self._n):
            yield self._buf[(self._head + i) % self._cap]

    def to_list(self):
        return list(self)


class CircularQueue(Deque):
    """Fila FIFO (enqueue no fim, dequeue no início) sobre o buffer circular."""

    def enqueue(self, v):
        self.push_back(v)

    def dequeue(self):
        return self.pop_front()

    def peek(self):
        return self.peek_front()
