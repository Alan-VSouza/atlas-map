import random
import unittest
from collections import deque

from ds_lib import CircularQueue, Deque, DoublyLinkedList, DynamicArray, Stack


class TestDoublyLinkedList(unittest.TestCase):
    def test_basic_operations(self):
        dl = DoublyLinkedList()
        a = dl.push_back("a", 1)
        b = dl.push_back("b", 2)
        c = dl.push_front("c", 3)
        self.assertEqual([k for k, _ in dl.to_list()], ["c", "a", "b"])
        dl.remove(a)
        self.assertEqual([k for k, _ in dl.to_list()], ["c", "b"])
        dl.move_to_front(b)
        self.assertEqual([k for k, _ in dl.to_list()], ["b", "c"])
        self.assertEqual(dl.pop_back().key, "c")
        self.assertEqual(dl.pop_front().key, "b")
        self.assertIsNone(dl.pop_front())
        self.assertIsNone(dl.pop_back())
        self.assertEqual(len(dl), 0)

    def test_random_against_deque(self):
        rng = random.Random(1)
        dl, ref = DoublyLinkedList(), deque()
        for i in range(3000):
            op = rng.randrange(4)
            if op == 0:
                dl.push_front(i)
                ref.appendleft(i)
            elif op == 1:
                dl.push_back(i)
                ref.append(i)
            elif op == 2 and ref:
                self.assertEqual(dl.pop_front().key, ref.popleft())
            elif op == 3 and ref:
                self.assertEqual(dl.pop_back().key, ref.pop())
            self.assertEqual(len(dl), len(ref))
        self.assertEqual([k for k, _ in dl.to_list()], list(ref))


class TestDynamicArray(unittest.TestCase):
    def test_growth_and_shrink(self):
        a = DynamicArray(2)
        for i in range(1000):
            a.append(i)
        self.assertEqual(len(a), 1000)
        self.assertEqual(a[0], 0)
        self.assertEqual(a[-1], 999)
        self.assertGreaterEqual(a.capacity, 1000)
        for i in range(990):
            a.pop()
        self.assertEqual(len(a), 10)
        self.assertLess(a.capacity, 100)
        self.assertEqual(list(a), list(range(10)))

    def test_amortized_copies_linear(self):
        a = DynamicArray(1)
        n = 100000
        for i in range(n):
            a.append(i)
        self.assertLess(a.copies, 2 * n)  # custo amortizado O(1)

    def test_errors(self):
        a = DynamicArray()
        with self.assertRaises(IndexError):
            a.pop()
        with self.assertRaises(IndexError):
            a[0]


class TestStack(unittest.TestCase):
    def test_lifo(self):
        s = Stack()
        for i in range(10):
            s.push(i)
        self.assertEqual(s.peek(), 9)
        self.assertEqual([s.pop() for _ in range(10)], list(range(9, -1, -1)))
        self.assertTrue(s.is_empty())
        with self.assertRaises(IndexError):
            s.pop()
        with self.assertRaises(IndexError):
            s.peek()


class TestDequeQueue(unittest.TestCase):
    def test_random_against_collections_deque(self):
        rng = random.Random(2)
        d, ref = Deque(2), deque()
        for i in range(5000):
            op = rng.randrange(4)
            if op == 0:
                d.push_back(i)
                ref.append(i)
            elif op == 1:
                d.push_front(i)
                ref.appendleft(i)
            elif op == 2 and ref:
                self.assertEqual(d.pop_front(), ref.popleft())
            elif op == 3 and ref:
                self.assertEqual(d.pop_back(), ref.pop())
            self.assertEqual(len(d), len(ref))
            if ref:
                self.assertEqual(d.peek_front(), ref[0])
                self.assertEqual(d.peek_back(), ref[-1])
        self.assertEqual(d.to_list(), list(ref))

    def test_fifo_queue(self):
        q = CircularQueue(2)
        for i in range(100):
            q.enqueue(i)
        self.assertEqual(q.peek(), 0)
        self.assertEqual([q.dequeue() for _ in range(100)], list(range(100)))
        with self.assertRaises(IndexError):
            q.dequeue()

    def test_wraparound(self):
        # entra 2, sai 2 por rodada: o início do buffer dá várias voltas
        q = CircularQueue(4)
        for r in range(50):
            q.enqueue(r)
            q.enqueue(r + 1000)
            self.assertEqual(q.dequeue(), r)
            self.assertEqual(q.dequeue(), r + 1000)
            self.assertEqual(len(q), 0)
        # mantém 3 elementos em circulação
        for i in range(3):
            q.enqueue(i)
        for i in range(3, 200):
            q.enqueue(i)
            self.assertEqual(q.dequeue(), i - 3)


if __name__ == "__main__":
    unittest.main()
