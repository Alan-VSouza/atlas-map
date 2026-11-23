"""Codificação de Huffman (usa a heap própria). Build O(k log k), k = símbolos."""

from .heap import BinaryHeap


class _HNode:
    __slots__ = ("freq", "symbol", "left", "right")

    def __init__(self, freq, symbol=None, left=None, right=None):
        self.freq = freq
        self.symbol = symbol
        self.left = left
        self.right = right


class HuffmanCodec:
    def __init__(self):
        self.root = None
        self.codes = {}

    def fit(self, text):
        freq = {}
        for ch in text:
            freq[ch] = freq.get(ch, 0) + 1
        self.root = None
        self.codes = {}
        if not freq:
            return self
        heap = BinaryHeap(key=lambda t: (t[0], t[1]))
        counter = 0
        for sym in sorted(freq):
            heap.push((freq[sym], counter, _HNode(freq[sym], symbol=sym)))
            counter += 1
        while len(heap) > 1:
            f1, _, a = heap.pop()
            f2, _, b = heap.pop()
            heap.push((f1 + f2, counter, _HNode(f1 + f2, left=a, right=b)))
            counter += 1
        self.root = heap.pop()[2]
        if self.root.symbol is not None:  # um único símbolo
            self.codes[self.root.symbol] = "0"
        else:
            stack = [(self.root, "")]
            while stack:
                node, code = stack.pop()
                if node.symbol is not None:
                    self.codes[node.symbol] = code
                else:
                    stack.append((node.right, code + "1"))
                    stack.append((node.left, code + "0"))
        return self

    def encode(self, text):
        return "".join(self.codes[ch] for ch in text)

    def decode(self, bits):
        if self.root is None:
            return ""
        if self.root.symbol is not None:
            return self.root.symbol * len(bits)
        out, node = [], self.root
        for b in bits:
            node = node.left if b == "0" else node.right
            if node.symbol is not None:
                out.append(node.symbol)
                node = self.root
        return "".join(out)

    def compression_ratio(self, text):
        """bits codificados / bits originais (8 por byte UTF-8). Menor é melhor."""
        if not text:
            return 1.0
        return len(self.encode(text)) / (8 * len(text.encode("utf-8")))
