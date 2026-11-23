"""Algoritmos de texto: Levenshtein (programação dinâmica) e KMP."""


def levenshtein(a, b):
    """Distância de edição. Tempo O(|a||b|), memória O(min(|a|,|b|))."""
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def kmp_table(pattern):
    fail = [0] * len(pattern)
    k = 0
    for i in range(1, len(pattern)):
        while k and pattern[i] != pattern[k]:
            k = fail[k - 1]
        if pattern[i] == pattern[k]:
            k += 1
        fail[i] = k
    return fail


def kmp_search(text, pattern):
    """Índices de todas as ocorrências (inclusive sobrepostas). O(n + m)."""
    if not pattern:
        return []
    fail = kmp_table(pattern)
    out, k = [], 0
    for i, ch in enumerate(text):
        while k and ch != pattern[k]:
            k = fail[k - 1]
        if ch == pattern[k]:
            k += 1
        if k == len(pattern):
            out.append(i - k + 1)
            k = fail[k - 1]
    return out
