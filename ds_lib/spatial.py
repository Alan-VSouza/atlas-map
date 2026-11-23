"""Índices espaciais 2D: Quadtree e KD-Tree.

Quadtree: insert/remove O(log n) médio; consulta por retângulo e k-vizinhos
mais próximos com poda por distância. KD-Tree: build O(n log^2 n), nearest
O(log n) médio.
"""

from .heap import BinaryHeap


def _rect_dist2(x, y, x0, y0, x1, y1):
    dx = max(x0 - x, 0.0, x - x1)
    dy = max(y0 - y, 0.0, y - y1)
    return dx * dx + dy * dy


class Quadtree:
    def __init__(self, x0, y0, x1, y1, capacity=4, max_depth=12, _depth=0):
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1
        self.capacity = capacity
        self.max_depth = max_depth
        self.depth = _depth
        self.points = []  # (x, y, data)
        self.children = None
        self._size = 0

    def __len__(self):
        return self._size

    def _child_index(self, x, y):
        mx, my = (self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0
        return (1 if x >= mx else 0) + (2 if y >= my else 0)

    def _subdivide(self):
        mx, my = (self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0
        d = self.depth + 1
        c, md = self.capacity, self.max_depth
        self.children = [
            Quadtree(self.x0, self.y0, mx, my, c, md, d),
            Quadtree(mx, self.y0, self.x1, my, c, md, d),
            Quadtree(self.x0, my, mx, self.y1, c, md, d),
            Quadtree(mx, my, self.x1, self.y1, c, md, d),
        ]
        pts, self.points = self.points, []
        self._size = 0
        for (x, y, data) in pts:
            self.insert(x, y, data)

    def contains_point(self, x, y):
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1

    def insert(self, x, y, data=None):
        if not self.contains_point(x, y):
            return False
        node = self
        node._size += 1
        while node.children is not None:
            node = node.children[node._child_index(x, y)]
            node._size += 1
        node.points.append((x, y, data))
        if len(node.points) > node.capacity and node.depth < node.max_depth:
            node._size -= len(node.points)  # _subdivide recontará
            node._subdivide()
        return True

    def remove(self, x, y, data=None):
        path, node = [self], self
        while node.children is not None:
            node = node.children[node._child_index(x, y)]
            path.append(node)
        for i, (px, py, pd) in enumerate(node.points):
            if px == x and py == y and pd == data:
                node.points.pop(i)
                for n in path:
                    n._size -= 1
                return True
        return False

    def query(self, qx0, qy0, qx1, qy1):
        out = []
        stack = [self]
        while stack:
            n = stack.pop()
            if qx1 < n.x0 or qx0 > n.x1 or qy1 < n.y0 or qy0 > n.y1:
                continue
            if n.children is not None:
                stack.extend(n.children)
            else:
                for (x, y, d) in n.points:
                    if qx0 <= x <= qx1 and qy0 <= y <= qy1:
                        out.append((x, y, d))
        return out

    def nearest(self, x, y, k=1):
        """k pontos mais próximos: lista de (dist2, px, py, data) crescente."""
        if k <= 0 or self._size == 0:
            return []
        heap = BinaryHeap(key=lambda t: t[0], max_heap=True)  # topo = pior dos k

        def visit(n):
            if n._size == 0:
                return
            if len(heap) == k and _rect_dist2(x, y, n.x0, n.y0, n.x1, n.y1) >= heap.peek()[0]:
                return
            if n.children is None:
                for (px, py, d) in n.points:
                    d2 = (px - x) ** 2 + (py - y) ** 2
                    if len(heap) < k:
                        heap.push((d2, px, py, d))
                    elif d2 < heap.peek()[0]:
                        heap.pop()
                        heap.push((d2, px, py, d))
            else:
                order = sorted(n.children, key=lambda c: _rect_dist2(x, y, c.x0, c.y0, c.x1, c.y1))
                for c in order:
                    visit(c)

        visit(self)
        out = []
        while len(heap):
            out.append(heap.pop())
        out.reverse()
        return out

    def rects(self):
        """Retângulos das folhas (para desenhar a subdivisão no front)."""
        out, stack = [], [self]
        while stack:
            n = stack.pop()
            if n.children is not None:
                stack.extend(n.children)
            else:
                out.append((n.x0, n.y0, n.x1, n.y1))
        return out


class _KDNode:
    __slots__ = ("pt", "axis", "left", "right")

    def __init__(self, pt, axis, left, right):
        self.pt = pt
        self.axis = axis
        self.left = left
        self.right = right


class KDTree:
    def __init__(self, points):
        """points: lista de (x, y, data). Estrutura estática (reconstruir para mudar)."""
        self.size = len(points)
        self.root = self._build(list(points), 0)

    def __len__(self):
        return self.size

    def _build(self, pts, depth):
        if not pts:
            return None
        axis = depth % 2
        pts.sort(key=lambda p: p[axis])
        mid = len(pts) // 2
        return _KDNode(pts[mid], axis,
                       self._build(pts[:mid], depth + 1),
                       self._build(pts[mid + 1:], depth + 1))

    def nearest(self, x, y, k=1):
        if k <= 0 or self.root is None:
            return []
        heap = BinaryHeap(key=lambda t: t[0], max_heap=True)

        def visit(n):
            if n is None:
                return
            px, py, d = n.pt
            d2 = (px - x) ** 2 + (py - y) ** 2
            if len(heap) < k:
                heap.push((d2, px, py, d))
            elif d2 < heap.peek()[0]:
                heap.pop()
                heap.push((d2, px, py, d))
            diff = (x - px) if n.axis == 0 else (y - py)
            near, far = (n.left, n.right) if diff < 0 else (n.right, n.left)
            visit(near)
            if len(heap) < k or diff * diff < heap.peek()[0]:
                visit(far)

        visit(self.root)
        out = []
        while len(heap):
            out.append(heap.pop())
        out.reverse()
        return out
