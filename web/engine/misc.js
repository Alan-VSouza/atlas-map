// Bloom Filter, Count-Min Sketch, LRU, Segment/Fenwick/Sparse, Levenshtein, KMP, Huffman.
import { hashKey, ChainingHashTable } from "./hashtable.js";
import { DoublyLinkedList } from "./linear.js";
import { BinaryHeap } from "./heap.js";
import { pyRoundInt } from "./pycompat.js";

// ----------------------------------------------------------------- Bloom
export class BloomFilter {
  constructor(numBits, numHashes) {
    this.m = Math.max(8, Math.trunc(numBits));
    this.k = Math.max(1, Math.trunc(numHashes));
    this._M = BigInt(this.m);
    this._bits = new Uint8Array((this.m + 7) >> 3);
    this.count = 0;
  }
  static fromCapacity(n, fpRate = 0.01) {
    n = Math.max(1, n);
    const m = Math.ceil(-n * Math.log(fpRate) / (Math.log(2) ** 2));
    const k = Math.max(1, pyRoundInt(m / n * Math.log(2)));
    return new BloomFilter(m, k);
  }
  _indexes(item) {
    const h1 = hashKey(item), h2 = hashKey(h1) | 1n, out = [];
    for (let i = 0n; i < BigInt(this.k); i++) out.push(Number((h1 + i * h2) % this._M));
    return out;
  }
  add(item) { for (const idx of this._indexes(item)) this._bits[idx >> 3] |= 1 << (idx & 7); this.count++; }
  has(item) {
    for (const idx of this._indexes(item)) if (!(this._bits[idx >> 3] & (1 << (idx & 7)))) return false;
    return true;
  }
  bitsSet() { let s = 0; for (let b of this._bits) { while (b) { s += b & 1; b >>= 1; } } return s; }
  estimatedFpRate() { return (this.bitsSet() / this.m) ** this.k; }
}

// ------------------------------------------------------- Count-Min Sketch
export class CountMinSketch {
  constructor(width = 256, depth = 4) {
    this.width = width; this.depth = depth; this._W = BigInt(width);
    this._rows = Array.from({ length: depth }, () => new Array(width).fill(0));
    this.total = 0;
    this._memo = new Map(); // item -> colunas (o hash é determinístico, então guardar não muda nada)
  }
  _cols(item) {
    const key = JSON.stringify(item);
    let c = this._memo.get(key);
    if (!c) {
      c = [];
      for (let d = 0; d < this.depth; d++) c.push(Number(hashKey([d, item]) % this._W));
      if (this._memo.size < 100000) this._memo.set(key, c);
    }
    return c;
  }
  add(item, count = 1) {
    const c = this._cols(item);
    for (let d = 0; d < this.depth; d++) this._rows[d][c[d]] += count;
    this.total += count;
  }
  estimate(item) {
    const c = this._cols(item); let best = null;
    for (let d = 0; d < this.depth; d++) { const v = this._rows[d][c[d]]; if (best === null || v < best) best = v; }
    return best;
  }
}

// -------------------------------------------------------------------- LRU
export class LRUCache {
  constructor(capacity) {
    if (capacity < 1) throw new Error("capacity deve ser >= 1");
    this.capacity = capacity; this._map = new ChainingHashTable(); this._list = new DoublyLinkedList();
    this.hits = 0; this.misses = 0; this.evictions = 0;
  }
  get length() { return this._list.length; }
  has(key) { return this._map.has(key); }
  get(key, dflt = null) {
    const node = this._map.get(key, null);
    if (node === null) { this.misses++; return dflt; }
    this.hits++; this._list.moveToFront(node); return node.value;
  }
  put(key, value) {
    const node = this._map.get(key, null);
    if (node !== null) { node.value = value; this._list.moveToFront(node); return; }
    if (this._list.length >= this.capacity) {
      const old = this._list.popBack(); this._map.remove(old.key); this.evictions++;
    }
    this._map.put(key, this._list.pushFront(key, value));
  }
  keysMruFirst() { return [...this._list].map((n) => n.key); }
  hitRate() { const t = this.hits + this.misses; return t ? this.hits / t : 0.0; }
}

// ---------------------------------------------------------- intervalos
const add = (a, b) => a + b;
export class SegmentTree {
  constructor(data, op = add, identity = 0) {
    this.n = data.length; this.op = op; this.identity = identity;
    this.t = new Array(2 * this.n).fill(identity);
    for (let i = 0; i < this.n; i++) this.t[this.n + i] = data[i];
    for (let i = this.n - 1; i > 0; i--) this.t[i] = op(this.t[2 * i], this.t[2 * i + 1]);
  }
  update(i, value) {
    i += this.n; this.t[i] = value;
    while (i > 1) { i >>= 1; this.t[i] = this.op(this.t[2 * i], this.t[2 * i + 1]); }
  }
  get(i) { return this.t[this.n + i]; }
  query(l, r) {
    let resL = this.identity, resR = this.identity;
    l += this.n; r += this.n;
    while (l < r) {
      if (l & 1) resL = this.op(resL, this.t[l++]);
      if (r & 1) resR = this.op(this.t[--r], resR);
      l >>= 1; r >>= 1;
    }
    return this.op(resL, resR);
  }
}

export class FenwickTree {
  constructor(nOrData) {
    if (typeof nOrData === "number") { this.n = nOrData; this.t = new Array(this.n + 1).fill(0); }
    else {
      this.n = nOrData.length; this.t = new Array(this.n + 1).fill(0);
      for (let i = 0; i < this.n; i++) {
        this.t[i + 1] += nOrData[i];
        const j = (i + 1) + ((i + 1) & -(i + 1));
        if (j <= this.n) this.t[j] += this.t[i + 1];
      }
    }
  }
  add(i, delta) { for (i += 1; i <= this.n; i += i & -i) this.t[i] += delta; }
  prefix(i) { let s = 0; for (; i > 0; i -= i & -i) s += this.t[i]; return s; }
  rangeSum(l, r) { return this.prefix(r) - this.prefix(l); }
}

export class SparseTable {
  constructor(data, op = Math.min) {
    this.op = op; const n = data.length; this.table = [Array.from(data)];
    for (let j = 1; (1 << j) <= n; j++) {
      const prev = this.table[this.table.length - 1], half = 1 << (j - 1), row = [];
      for (let i = 0; i < n - (1 << j) + 1; i++) row.push(op(prev[i], prev[i + half]));
      this.table.push(row);
    }
  }
  query(l, r) {
    if (r <= l) throw new Error("intervalo vazio");
    const k = 31 - Math.clz32(r - l);
    return this.op(this.table[k][l], this.table[k][r - (1 << k)]);
  }
}

// --------------------------------------------------------------- texto
/** Distância de edição por programação dinâmica (por ponto de código, como no Python). */
export function levenshtein(a, b) {
  let A = Array.from(a), B = Array.from(b);
  if (A.length < B.length) [A, B] = [B, A];
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i], ca = A[i - 1];
    for (let j = 1; j <= B.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca !== B[j - 1] ? 1 : 0)));
    }
    prev = cur;
  }
  return prev[prev.length - 1];
}

export function kmpTable(p) {
  const P = Array.from(p), fail = new Array(P.length).fill(0);
  let k = 0;
  for (let i = 1; i < P.length; i++) {
    while (k && P[i] !== P[k]) k = fail[k - 1];
    if (P[i] === P[k]) k++;
    fail[i] = k;
  }
  return fail;
}
export function kmpSearch(text, pattern) {
  const P = Array.from(pattern); if (!P.length) return [];
  const fail = kmpTable(pattern), out = []; let k = 0, i = 0;
  for (const ch of text) {
    while (k && ch !== P[k]) k = fail[k - 1];
    if (ch === P[k]) k++;
    if (k === P.length) { out.push(i - k + 1); k = fail[k - 1]; }
    i++;
  }
  return out;
}

// --------------------------------------------------------------- Huffman
const enc = new TextEncoder();
export class HuffmanCodec {
  constructor() { this.root = null; this.codes = new Map(); }
  fit(text) {
    const freq = new Map();
    for (const ch of text) freq.set(ch, (freq.get(ch) || 0) + 1);
    this.root = null; this.codes = new Map();
    if (!freq.size) return this;
    const lt = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]);   // chave (freq, contador)
    const heap = new BinaryHeap({ lt });
    let counter = 0;
    const syms = [...freq.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    for (const s of syms) heap.push([freq.get(s), counter++, { freq: freq.get(s), symbol: s, left: null, right: null }]);
    while (heap.length > 1) {
      const [f1, , a] = heap.pop(), [f2, , b] = heap.pop();
      heap.push([f1 + f2, counter++, { freq: f1 + f2, symbol: null, left: a, right: b }]);
    }
    this.root = heap.pop()[2];
    if (this.root.symbol !== null) this.codes.set(this.root.symbol, "0");
    else {
      const stack = [[this.root, ""]];
      while (stack.length) {
        const [node, code] = stack.pop();
        if (node.symbol !== null) this.codes.set(node.symbol, code);
        else { stack.push([node.right, code + "1"]); stack.push([node.left, code + "0"]); }
      }
    }
    return this;
  }
  encode(text) { let s = ""; for (const ch of text) s += this.codes.get(ch); return s; }
  decode(bits) {
    if (!this.root) return "";
    if (this.root.symbol !== null) return this.root.symbol.repeat(bits.length);
    let out = "", node = this.root;
    for (const b of bits) {
      node = b === "0" ? node.left : node.right;
      if (node.symbol !== null) { out += node.symbol; node = this.root; }
    }
    return out;
  }
  encodedBits(text) { let n = 0; for (const ch of text) n += this.codes.get(ch).length; return n; }
  compressionRatio(text) { if (!text) return 1.0; return this.encodedBits(text) / (8 * enc.encode(text).length); }
}
