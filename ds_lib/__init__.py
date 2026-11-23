"""ds_lib: estruturas de dados implementadas do zero (somente biblioteca padrão)."""

from .counter import OPS, OpCounter
from .linked_list import DoublyLinkedList, DNode
from .stack_queue import DynamicArray, Stack, Deque, CircularQueue
from .hashtable import (ChainingHashTable, OpenAddressingHashTable, hash_key)
from .heap import BinaryHeap, IndexedPriorityQueue
from .probabilistic import BloomFilter, CountMinSketch
from .lru import LRUCache
from .avl import AVLTree
from .skiplist import SkipList
from .range_queries import SegmentTree, FenwickTree, SparseTable
from .trie import Trie
from .huffman import HuffmanCodec
from .strings import levenshtein, kmp_search, kmp_table
from .graph import (Graph, INF, dijkstra, shortest_path, astar, bellman_ford,
                    floyd_warshall, UnionFind, kruskal, bfs, dfs,
                    topological_sort, tarjan_scc, connected_components)
from .spatial import Quadtree, KDTree

__all__ = [n for n in dir() if not n.startswith("_")]
