"""Árvore AVL (autobalanceada). insert/get/delete em O(log n) no pior caso.

Conta comparações e rotações para os benchmarks.
"""


class _AVLNode:
    __slots__ = ("key", "value", "h", "left", "right")

    def __init__(self, key, value):
        self.key = key
        self.value = value
        self.h = 1
        self.left = None
        self.right = None


class AVLTree:
    def __init__(self):
        self.root = None
        self._n = 0
        self.rotations = 0
        self.comparisons = 0
        self._removed = False

    def __len__(self):
        return self._n

    @staticmethod
    def _h(n):
        return n.h if n is not None else 0

    def _fix(self, n):
        hl, hr = self._h(n.left), self._h(n.right)
        n.h = 1 + (hl if hl > hr else hr)

    def _balance(self, n):
        return self._h(n.left) - self._h(n.right)

    def _rot_right(self, y):
        x = y.left
        y.left = x.right
        x.right = y
        self._fix(y)
        self._fix(x)
        self.rotations += 1
        return x

    def _rot_left(self, x):
        y = x.right
        x.right = y.left
        y.left = x
        self._fix(x)
        self._fix(y)
        self.rotations += 1
        return y

    def _rebalance(self, n):
        self._fix(n)
        b = self._balance(n)
        if b > 1:
            if self._balance(n.left) < 0:
                n.left = self._rot_left(n.left)
            return self._rot_right(n)
        if b < -1:
            if self._balance(n.right) > 0:
                n.right = self._rot_right(n.right)
            return self._rot_left(n)
        return n

    # ---- inserção ----
    def insert(self, key, value=None):
        self.root = self._insert(self.root, key, value)

    def _insert(self, n, key, value):
        if n is None:
            self._n += 1
            return _AVLNode(key, value)
        self.comparisons += 1
        if key < n.key:
            n.left = self._insert(n.left, key, value)
        elif key > n.key:
            n.right = self._insert(n.right, key, value)
        else:
            n.value = value
            return n
        return self._rebalance(n)

    # ---- remoção ----
    def delete(self, key):
        self._removed = False
        self.root = self._delete(self.root, key)
        return self._removed

    def _delete_min(self, n):
        if n.left is None:
            self._n -= 1
            return n.right
        n.left = self._delete_min(n.left)
        return self._rebalance(n)

    def _delete(self, n, key):
        if n is None:
            return None
        self.comparisons += 1
        if key < n.key:
            n.left = self._delete(n.left, key)
        elif key > n.key:
            n.right = self._delete(n.right, key)
        else:
            self._removed = True
            if n.left is None:
                self._n -= 1
                return n.right
            if n.right is None:
                self._n -= 1
                return n.left
            s = n.right
            while s.left is not None:
                s = s.left
            n.key, n.value = s.key, s.value
            n.right = self._delete_min(n.right)
        return self._rebalance(n)

    # ---- consultas ----
    def get(self, key, default=None):
        n = self.root
        while n is not None:
            self.comparisons += 1
            if key < n.key:
                n = n.left
            elif key > n.key:
                n = n.right
            else:
                return n.value
        return default

    def __contains__(self, key):
        n = self.root
        while n is not None:
            self.comparisons += 1
            if key < n.key:
                n = n.left
            elif key > n.key:
                n = n.right
            else:
                return True
        return False

    def min_key(self):
        n = self.root
        if n is None:
            raise ValueError("árvore vazia")
        while n.left is not None:
            n = n.left
        return n.key

    def max_key(self):
        n = self.root
        if n is None:
            raise ValueError("árvore vazia")
        while n.right is not None:
            n = n.right
        return n.key

    def height(self):
        return self._h(self.root)

    def items(self):
        stack, n = [], self.root
        while stack or n is not None:
            while n is not None:
                stack.append(n)
                n = n.left
            n = stack.pop()
            yield n.key, n.value
            n = n.right

    def range(self, lo, hi):
        """Itens com lo <= chave <= hi, em ordem. O(log n + k)."""
        out = []
        self._range(self.root, lo, hi, out)
        return out

    def _range(self, n, lo, hi, out):
        if n is None:
            return
        if lo < n.key:
            self._range(n.left, lo, hi, out)
        if lo <= n.key <= hi:
            out.append((n.key, n.value))
        if n.key < hi:
            self._range(n.right, lo, hi, out)

    def check_invariants(self):
        """Verifica ordem BST, alturas e fator de balanceamento. Para testes."""
        def walk(n, lo, hi):
            if n is None:
                return 0
            if (lo is not None and n.key <= lo) or (hi is not None and n.key >= hi):
                raise AssertionError("violação da ordem BST")
            hl = walk(n.left, lo, n.key)
            hr = walk(n.right, n.key, hi)
            if abs(hl - hr) > 1:
                raise AssertionError("árvore desbalanceada")
            h = 1 + max(hl, hr)
            if n.h != h:
                raise AssertionError("altura armazenada incorreta")
            return h
        walk(self.root, None, None)
        return True
