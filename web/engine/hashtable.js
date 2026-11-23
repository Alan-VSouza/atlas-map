// Tabelas hash: encadeamento e endereçamento aberto (linear, quadrático, duplo).
// Mesma função de hash do Python (FNV-1a + mixer de 64 bits), em BigInt.
import { pyEq } from "./pycompat.js";

const M64 = (1n << 64n) - 1n;
const enc = new TextEncoder();

export function mix64(x) {
  x &= M64;
  x ^= x >> 33n;
  x = (x * 0xFF51AFD7ED558CCDn) & M64;
  x ^= x >> 33n;
  x = (x * 0xC4CEB9FE1A85EC53n) & M64;
  x ^= x >> 33n;
  return x;
}

function fnv(bytes) {
  let h = 0xCBF29CE484222325n;
  for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001B3n) & M64; }
  return mix64(h);
}

/** hash_key do Python: int, str, tuple (array) e bigint. */
export function hashKey(k) {
  if (typeof k === "number") {
    if (!Number.isInteger(k)) throw new TypeError("hashKey: só inteiros (floats não são usados como chave)");
    return mix64(BigInt(k));
  }
  if (typeof k === "bigint") return mix64(k);
  if (typeof k === "boolean") return mix64(k ? 1n : 0n);
  if (typeof k === "string") return fnv(enc.encode(k));
  if (k instanceof Uint8Array) return fnv(k);
  if (Array.isArray(k)) {
    let h = 0x9E3779B97F4A7C15n;
    for (const item of k) {
      h = mix64(h ^ hashKey(item));
      h = (h + 0x9E3779B97F4A7C15n) & M64;
    }
    return h;
  }
  throw new TypeError("hashKey: tipo não suportado");
}

function pow2AtLeast(n) { let c = 8; while (c < n) c *= 2; return c; }
const keyEq = (a, b) => (Array.isArray(a) ? pyEq(a, b) : a === b);

export class ChainingHashTable {
  constructor(capacity = 8, maxLoad = 0.75) {
    this._cap = pow2AtLeast(capacity);
    this._mask = BigInt(this._cap - 1);
    this._buckets = new Array(this._cap).fill(null);
    this._n = 0;
    this.maxLoad = maxLoad;
    this.collisions = 0;
    this.resizes = 0;
  }
  get length() { return this._n; }
  get capacity() { return this._cap; }
  loadFactor() { return this._n / this._cap; }

  _resize(newCap) {
    const old = this._buckets;
    this._buckets = new Array(newCap).fill(null);
    this._cap = newCap; this._mask = BigInt(newCap - 1);
    this.resizes++;
    for (let node of old) {
      while (node !== null) {
        const nxt = node.next, i = Number(node.hash & this._mask);
        node.next = this._buckets[i]; this._buckets[i] = node;
        node = nxt;
      }
    }
  }
  put(key, value) {
    const h = hashKey(key), i = Number(h & this._mask);
    for (let node = this._buckets[i]; node !== null; node = node.next) {
      if (node.hash === h && keyEq(node.key, key)) { node.value = value; return; }
    }
    if (this._buckets[i] !== null) this.collisions++;
    this._buckets[i] = { key, value, hash: h, next: this._buckets[i] };
    this._n++;
    if (this._n / this._cap > this.maxLoad) this._resize(this._cap * 2);
  }
  _node(key) {
    const h = hashKey(key);
    for (let node = this._buckets[Number(h & this._mask)]; node !== null; node = node.next) {
      if (node.hash === h && keyEq(node.key, key)) return node;
    }
    return null;
  }
  get(key, dflt = undefined) { const n = this._node(key); return n ? n.value : dflt; }
  has(key) { return this._node(key) !== null; }
  remove(key) {
    const h = hashKey(key), i = Number(h & this._mask);
    let prev = null;
    for (let node = this._buckets[i]; node !== null; prev = node, node = node.next) {
      if (node.hash === h && keyEq(node.key, key)) {
        if (prev === null) this._buckets[i] = node.next; else prev.next = node.next;
        this._n--;
        return true;
      }
    }
    return false;
  }
  *items() { for (let node of this._buckets) for (; node !== null; node = node.next) yield [node.key, node.value]; }
  *keys() { for (const [k] of this.items()) yield k; }
  *values() { for (const [, v] of this.items()) yield v; }
  bucketLengths() { return this._buckets.map((n) => { let c = 0; for (; n; n = n.next) c++; return c; }); }
  maxChainLength() { return Math.max(...this.bucketLengths()); }
}

const EMPTY = 0, USED = 1, DELETED = 2;

export class OpenAddressingHashTable {
  constructor(capacity = 8, probing = "linear", maxLoad = 0.5) {
    if (!["linear", "quadratic", "double"].includes(probing)) throw new Error("probing deve ser linear, quadratic ou double");
    this.probing = probing; this.maxLoad = maxLoad;
    this._alloc(pow2AtLeast(capacity));
    this._n = 0; this._filled = 0; this.probes = 0; this.resizes = 0;
  }
  _alloc(cap) {
    this._cap = cap; this._mask = cap - 1; this._bmask = BigInt(cap - 1);
    this._state = new Uint8Array(cap);
    this._keys = new Array(cap).fill(null); this._vals = new Array(cap).fill(null);
    this._hashes = new Array(cap).fill(0n); this._hlo = new Float64Array(cap);
  }
  get length() { return this._n; }
  get capacity() { return this._cap; }
  loadFactor() { return this._n / this._cap; }
  static _step(h) { return Number((((h >> 32n) ^ (h * 0x9E3779B1n)) & 0xFFFFFFFFn) | 1n); }
  _find(key, h) {
    const hl = Number(h & this._bmask);
    const step = this.probing === "double" ? OpenAddressingHashTable._step(h) : 0;
    let firstDel = -1;
    for (let i = 0; i < this._cap; i++) {
      let idx;
      if (this.probing === "linear") idx = (hl + i) & this._mask;
      else if (this.probing === "quadratic") idx = (hl + (i * (i + 1)) / 2) & this._mask;
      else idx = Number((BigInt(hl) + BigInt(i) * BigInt(step)) & this._bmask);
      this.probes++;
      const s = this._state[idx];
      if (s === EMPTY) return [-1, firstDel !== -1 ? firstDel : idx];
      if (s === DELETED) { if (firstDel === -1) firstDel = idx; }
      else if (this._hashes[idx] === h && keyEq(this._keys[idx], key)) return [idx, idx];
    }
    return [-1, firstDel];
  }
  _rehash(newCap) {
    const old = [];
    for (let i = 0; i < this._cap; i++) if (this._state[i] === USED) old.push([this._keys[i], this._vals[i], this._hashes[i]]);
    this._alloc(newCap); this._n = 0; this._filled = 0; this.resizes++;
    for (const [k, v, h] of old) {
      const [, free] = this._find(k, h);
      this._state[free] = USED; this._keys[free] = k; this._vals[free] = v; this._hashes[free] = h;
      this._n++; this._filled++;
    }
  }
  put(key, value) {
    const h = hashKey(key), [idx, free] = this._find(key, h);
    if (idx >= 0) { this._vals[idx] = value; return; }
    if (this._state[free] === EMPTY) this._filled++;
    this._state[free] = USED; this._keys[free] = key; this._vals[free] = value; this._hashes[free] = h;
    this._n++;
    if (this._filled / this._cap > this.maxLoad) {
      const grow = this._n / this._cap >= this.maxLoad * 0.6;
      this._rehash(grow ? this._cap * 2 : this._cap);
    }
  }
  get(key, dflt = undefined) { const [idx] = this._find(key, hashKey(key)); return idx >= 0 ? this._vals[idx] : dflt; }
  has(key) { return this._find(key, hashKey(key))[0] >= 0; }
  remove(key) {
    const [idx] = this._find(key, hashKey(key));
    if (idx < 0) return false;
    this._state[idx] = DELETED; this._keys[idx] = null; this._vals[idx] = null; this._n--;
    return true;
  }
  *items() { for (let i = 0; i < this._cap; i++) if (this._state[i] === USED) yield [this._keys[i], this._vals[i]]; }
  tombstones() { return this._filled - this._n; }
}
