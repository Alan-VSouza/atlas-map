"""Instrumentação simples: contadores de operações (comparações, rotações...).

Serve para comparar a teoria (Big-O) com a prática nos benchmarks.
"""


class OpCounter:
    def __init__(self):
        self.c = {}

    def reset(self):
        self.c = {}

    def add(self, name, n=1):
        self.c[name] = self.c.get(name, 0) + n

    def get(self, name):
        return self.c.get(name, 0)

    def snapshot(self):
        return dict(self.c)


OPS = OpCounter()
