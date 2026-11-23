"""Trie (árvore de prefixos) com autocompletar por peso (top-K via heap).

insert/contains/delete em O(L) (L = tamanho da palavra).
autocomplete visita a subárvore do prefixo: O(L + S log K).
"""

from .heap import BinaryHeap


class _TNode:
    __slots__ = ("children", "weight", "end")

    def __init__(self):
        self.children = {}
        self.weight = 0
        self.end = False


class _Rank:
    """Ordenação 'pior primeiro' para manter os K melhores num min-heap.

    Melhor = maior peso; empate -> ordem alfabética crescente.
    """
    __slots__ = ("w", "word")

    def __init__(self, item):
        self.w, self.word = item

    def __lt__(self, other):  # self é pior que other
        if self.w != other.w:
            return self.w < other.w
        return self.word > other.word


class Trie:
    def __init__(self):
        self.root = _TNode()
        self._n = 0
        self._nodes = 1

    def __len__(self):
        return self._n

    @property
    def node_count(self):
        return self._nodes

    def insert(self, word, weight=1):
        node = self.root
        for ch in word:
            nxt = node.children.get(ch)
            if nxt is None:
                nxt = _TNode()
                node.children[ch] = nxt
                self._nodes += 1
            node = nxt
        if not node.end:
            node.end = True
            self._n += 1
        node.weight += weight

    def _walk(self, s):
        node = self.root
        for ch in s:
            node = node.children.get(ch)
            if node is None:
                return None
        return node

    def contains(self, word):
        n = self._walk(word)
        return n is not None and n.end

    __contains__ = contains

    def has_prefix(self, prefix):
        return self._walk(prefix) is not None

    def weight(self, word):
        n = self._walk(word)
        return n.weight if n is not None and n.end else 0

    def path(self, prefix):
        """Caracteres percorridos (útil para animar a busca no front)."""
        out, node = [], self.root
        for ch in prefix:
            node = node.children.get(ch)
            if node is None:
                break
            out.append(ch)
        return out

    def delete(self, word):
        stack = []
        node = self.root
        for ch in word:
            nxt = node.children.get(ch)
            if nxt is None:
                return False
            stack.append((node, ch))
            node = nxt
        if not node.end:
            return False
        node.end = False
        node.weight = 0
        self._n -= 1
        while stack and not node.end and not node.children:
            parent, ch = stack.pop()
            del parent.children[ch]
            self._nodes -= 1
            node = parent
        return True

    def words(self, prefix=""):
        start = self._walk(prefix)
        out = []
        if start is None:
            return out
        stack = [(start, prefix)]
        while stack:
            node, acc = stack.pop()
            if node.end:
                out.append((acc, node.weight))
            for ch in node.children:
                stack.append((node.children[ch], acc + ch))
        return out

    def autocomplete(self, prefix, k=5):
        """Top-K palavras com o prefixo, por peso desc e depois alfabética."""
        start = self._walk(prefix)
        if start is None or k <= 0:
            return []
        heap = BinaryHeap(key=lambda it: _Rank(it))  # topo = pior dos K
        stack = [(start, prefix)]
        while stack:
            node, acc = stack.pop()
            if node.end:
                item = (node.weight, acc)
                if len(heap) < k:
                    heap.push(item)
                elif _Rank(heap.peek()) < _Rank(item):
                    heap.pop()
                    heap.push(item)
            for ch in node.children:
                stack.append((node.children[ch], acc + ch))
        out = []
        while len(heap):
            out.append(heap.pop())
        out.reverse()
        return [(word, w) for (w, word) in out]
