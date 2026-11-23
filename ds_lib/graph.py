"""Grafos (lista de adjacência) e algoritmos clássicos.

Dijkstra, A*, Bellman-Ford, Floyd-Warshall, Union-Find, Kruskal, BFS, DFS,
ordenação topológica (Kahn), SCC (Tarjan iterativo) e componentes conexas.
"""

from .heap import BinaryHeap
from .stack_queue import CircularQueue

INF = float("inf")


class Graph:
    def __init__(self, n, directed=False):
        self.n = n
        self.directed = directed
        self.adj = [[] for _ in range(n)]
        self.m = 0

    def add_edge(self, u, v, w=1.0):
        self.adj[u].append((v, w))
        if not self.directed and u != v:
            self.adj[v].append((u, w))
        self.m += 1

    def has_edge(self, u, v):
        return any(x == v for x, _ in self.adj[u])

    def weight(self, u, v):
        best = None
        for x, w in self.adj[u]:
            if x == v and (best is None or w < best):
                best = w
        return best

    def set_weight(self, u, v, w):
        """Muda o peso de u-v (e v-u se não dirigido), mantendo a ordem da lista."""
        self.adj[u] = [(x, w if x == v else wx) for x, wx in self.adj[u]]
        if not self.directed:
            self.adj[v] = [(x, w if x == u else wx) for x, wx in self.adj[v]]

    def remove_edge(self, u, v):
        """Remove u-v (e v-u se não dirigido). Retorna o peso removido ou None."""
        w = self.weight(u, v)
        if w is None:
            return None
        self.adj[u] = [e for e in self.adj[u] if e[0] != v]
        if not self.directed:
            self.adj[v] = [e for e in self.adj[v] if e[0] != u]
        self.m -= 1
        return w

    def edges(self):
        for u in range(self.n):
            for v, w in self.adj[u]:
                if self.directed or u <= v:
                    yield u, v, w


def _path(prev, s, t):
    path, x = [], t
    while x != -1:
        path.append(x)
        if x == s:
            break
        x = prev[x]
    path.reverse()
    return path if path and path[0] == s else []


def dijkstra(g, src, dst=None):
    """Retorna (dist, prev, nós_assentados). Para cedo se dst for informado."""
    dist = [INF] * g.n
    prev = [-1] * g.n
    dist[src] = 0.0
    heap = BinaryHeap()
    heap.push((0.0, src))
    done = [False] * g.n
    settled = 0
    while len(heap):
        d, u = heap.pop()
        if done[u]:
            continue
        done[u] = True
        settled += 1
        if u == dst:
            break
        for v, w in g.adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heap.push((nd, v))
    return dist, prev, settled


def shortest_path(g, s, t):
    """(custo, caminho, nós_assentados). Custo INF e caminho [] se inalcançável."""
    dist, prev, settled = dijkstra(g, s, t)
    if dist[t] == INF:
        return INF, [], settled
    return dist[t], _path(prev, s, t), settled


def astar(g, s, t, h):
    """A* com heurística h(u, t). Admissível+consistente => ótimo.
    Retorna (custo, caminho, nós_expandidos)."""
    dist = [INF] * g.n
    prev = [-1] * g.n
    dist[s] = 0.0
    heap = BinaryHeap()
    heap.push((h(s, t), 0.0, s))
    closed = [False] * g.n
    expanded = 0
    while len(heap):
        _, d, u = heap.pop()
        if closed[u]:
            continue
        closed[u] = True
        expanded += 1
        if u == t:
            return d, _path(prev, s, t), expanded
        for v, w in g.adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heap.push((nd + h(v, t), nd, v))
    return INF, [], expanded


def bellman_ford(n, edges, src):
    """edges: lista de (u, v, w) dirigidas. Aceita pesos negativos.
    Levanta ValueError se houver ciclo negativo alcançável. O(V*E)."""
    dist = [INF] * n
    dist[src] = 0.0
    for _ in range(n - 1):
        changed = False
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:
            break
    for u, v, w in edges:
        if dist[u] != INF and dist[u] + w < dist[v]:
            raise ValueError("ciclo de peso negativo")
    return dist


def floyd_warshall(g):
    """Matriz de menores distâncias entre todos os pares. O(V^3)."""
    n = g.n
    d = [[INF] * n for _ in range(n)]
    for i in range(n):
        d[i][i] = 0.0
    for u, v, w in g.edges():
        if w < d[u][v]:
            d[u][v] = w
        if not g.directed and w < d[v][u]:
            d[v][u] = w
    for k in range(n):
        dk = d[k]
        for i in range(n):
            dik = d[i][k]
            if dik == INF:
                continue
            di = d[i]
            for j in range(n):
                nd = dik + dk[j]
                if nd < di[j]:
                    di[j] = nd
    return d


class UnionFind:
    """Conjuntos disjuntos com compressão de caminho e união por posto.
    find/union em O(alpha(n)) amortizado."""

    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.components = n

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        self.components -= 1
        return True


def kruskal(g):
    """Árvore geradora mínima (floresta se desconexo). Retorna (arestas, custo)."""
    heap = BinaryHeap()
    for u, v, w in g.edges():
        if u != v:
            heap.push((w, u, v))
    uf = UnionFind(g.n)
    chosen, total = [], 0.0
    while len(heap):
        w, u, v = heap.pop()
        if uf.union(u, v):
            chosen.append((u, v, w))
            total += w
    return chosen, total


def bfs(g, s):
    """Retorna (ordem de visita, distância em arestas)."""
    dist = [-1] * g.n
    dist[s] = 0
    q = CircularQueue()
    q.enqueue(s)
    order = []
    while len(q):
        u = q.dequeue()
        order.append(u)
        for v, _ in g.adj[u]:
            if dist[v] == -1:
                dist[v] = dist[u] + 1
                q.enqueue(v)
    return order, dist


def dfs(g, s):
    """DFS iterativa; retorna a ordem de visita."""
    seen = [False] * g.n
    order, stack = [], [s]
    while stack:
        u = stack.pop()
        if seen[u]:
            continue
        seen[u] = True
        order.append(u)
        for v, _ in reversed(g.adj[u]):
            if not seen[v]:
                stack.append(v)
    return order


def topological_sort(g):
    """Algoritmo de Kahn. Levanta ValueError se houver ciclo."""
    indeg = [0] * g.n
    for u in range(g.n):
        for v, _ in g.adj[u]:
            indeg[v] += 1
    q = CircularQueue()
    for u in range(g.n):
        if indeg[u] == 0:
            q.enqueue(u)
    order = []
    while len(q):
        u = q.dequeue()
        order.append(u)
        for v, _ in g.adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.enqueue(v)
    if len(order) != g.n:
        raise ValueError("o grafo possui ciclo")
    return order


def tarjan_scc(g):
    """Componentes fortemente conexas (Tarjan, versão iterativa). O(V + E)."""
    n = g.n
    index = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    stack, comps = [], []
    counter = 0
    for root in range(n):
        if index[root] != -1:
            continue
        work = [(root, 0)]
        while work:
            v, pi = work.pop()
            if pi == 0:
                index[v] = low[v] = counter
                counter += 1
                stack.append(v)
                on_stack[v] = True
            adj = g.adj[v]
            descended = False
            while pi < len(adj):
                w = adj[pi][0]
                pi += 1
                if index[w] == -1:
                    work.append((v, pi))
                    work.append((w, 0))
                    descended = True
                    break
                elif on_stack[w]:
                    low[v] = min(low[v], index[w])
            if descended:
                continue
            if low[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    comp.append(w)
                    if w == v:
                        break
                comps.append(comp)
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[v])
    return comps


def connected_components(g):
    """Rótulo de componente (0..k-1) para cada nó, usando Union-Find."""
    uf = UnionFind(g.n)
    for u, v, _ in g.edges():
        uf.union(u, v)
    labels, ids = [0] * g.n, {}
    for i in range(g.n):
        r = uf.find(i)
        if r not in ids:
            ids[r] = len(ids)
        labels[i] = ids[r]
    return labels, len(ids)
