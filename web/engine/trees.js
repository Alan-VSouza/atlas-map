// AVL, Skip List e Trie (autocompletar por peso).
import { BinaryHeap } from "./heap.js";
import { PyRandom } from "./pycompat.js";

// --------------------------------------------------------------------- AVL
const H = (n) => (n ? n.h : 0);
export class AVLTree {
  constructor() { this.root = null; this._n = 0; this.rotations = 0; this.comparisons = 0; this._removed = false; }
  get length() { return this._n; }
  _fix(n) { const hl = H(n.left), hr = H(n.right); n.h = 1 + (hl > hr ? hl : hr); }
  _bal(n) { return H(n.left) - H(n.right); }
  _rotRight(y) { const x = y.left; y.left = x.right; x.right = y; this._fix(y); this._fix(x); this.rotations++; return x; }
  _rotLeft(x) { const y = x.right; x.right = y.left; y.left = x; this._fix(x); this._fix(y); this.rotations++; return y; }
  _rebalance(n) {
    this._fix(n);
    const b = this._bal(n);
    if (b > 1) { if (this._bal(n.left) < 0) n.left = this._rotLeft(n.left); return this._rotRight(n); }
    if (b < -1) { if (this._bal(n.right) > 0) n.right = this._rotRight(n.right); return this._rotLeft(n); }
    return n;
  }
  insert(key, value = null) { this.root = this._insert(this.root, key, value); }
  _insert(n, key, value) {
    if (!n) { this._n++; return { key, value, h: 1, left: null, right: null }; }
    this.comparisons++;
    if (key < n.key) n.left = this._insert(n.left, key, value);
    else if (key > n.key) n.right = this._insert(n.right, key, value);
    else { n.value = value; return n; }
    return this._rebalance(n);
  }
  delete(key) { this._removed = false; this.root = this._delete(this.root, key); return this._removed; }
  _deleteMin(n) {
    if (!n.left) { this._n--; return n.right; }
    n.left = this._deleteMin(n.left); return this._rebalance(n);
  }
  _delete(n, key) {
    if (!n) return null;
    this.comparisons++;
    if (key < n.key) n.left = this._delete(n.left, key);
    else if (key > n.key) n.right = this._delete(n.right, key);
    else {
      this._removed = true;
      if (!n.left) { this._n--; return n.right; }
      if (!n.right) { this._n--; return n.left; }
      let s = n.right; while (s.left) s = s.left;
      n.key = s.key; n.value = s.value;
      n.right = this._deleteMin(n.right);
    }
    return this._rebalance(n);
  }
  get(key, dflt = null) {
    let n = this.root;
    while (n) {
      this.comparisons++;
      if (key < n.key) n = n.left; else if (key > n.key) n = n.right; else return n.value;
    }
    return dflt;
  }
  has(key) {
    let n = this.root;
    while (n) {
      this.comparisons++;
      if (key < n.key) n = n.left; else if (key > n.key) n = n.right; else return true;
    }
    return false;
  }
  minKey() { let n = this.root; if (!n) throw new Error("árvore vazia"); while (n.left) n = n.left; return n.key; }
  maxKey() { let n = this.root; if (!n) throw new Error("árvore vazia"); while (n.right) n = n.right; return n.key; }
  height() { return H(this.root); }
  *items() {
    const stack = []; let n = this.root;
    while (stack.length || n) {
      while (n) { stack.push(n); n = n.left; }
      n = stack.pop(); yield [n.key, n.value]; n = n.right;
    }
  }
  range(lo, hi) { const out = []; this._range(this.root, lo, hi, out); return out; }
  _range(n, lo, hi, out) {
    if (!n) return;
    if (lo < n.key) this._range(n.left, lo, hi, out);
    if (lo <= n.key && n.key <= hi) out.push([n.key, n.value]);
    if (n.key < hi) this._range(n.right, lo, hi, out);
  }
  checkInvariants() {
    const walk = (n, lo, hi) => {
      if (!n) return 0;
      if ((lo !== null && n.key <= lo) || (hi !== null && n.key >= hi)) throw new Error("violação da ordem BST");
      const hl = walk(n.left, lo, n.key), hr = walk(n.right, n.key, hi);
      if (Math.abs(hl - hr) > 1) throw new Error("árvore desbalanceada");
      const h = 1 + Math.max(hl, hr);
      if (n.h !== h) throw new Error("altura armazenada incorreta");
      return h;
    };
    walk(this.root, null, null);
    return true;
  }
}

// --------------------------------------------------------------- Skip List
export class SkipList {
  static MAX_LEVEL = 20;
  constructor(seed = 0, p = 0.5) {
    this.head = { key: null, value: null, forward: new Array(SkipList.MAX_LEVEL).fill(null) };
    this.level = 1; this._n = 0; this._rng = new PyRandom(seed); this.p = p; this.comparisons = 0;
  }
  get length() { return this._n; }
  _randomLevel() { let l = 1; while (l < SkipList.MAX_LEVEL && this._rng.random() < this.p) l++; return l; }
  _pred(key) {
    const update = new Array(SkipList.MAX_LEVEL).fill(this.head); let x = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] !== null && x.forward[i].key < key) { this.comparisons++; x = x.forward[i]; }
      update[i] = x;
    }
    return update;
  }
  insert(key, value = null) {
    const update = this._pred(key), cand = update[0].forward[0];
    if (cand !== null && cand.key === key) { cand.value = value; return; }
    const lvl = this._randomLevel();
    if (lvl > this.level) this.level = lvl;
    const node = { key, value, forward: new Array(lvl).fill(null) };
    for (let i = 0; i < lvl; i++) { node.forward[i] = update[i].forward[i]; update[i].forward[i] = node; }
    this._n++;
  }
  get(key, dflt = null) { const c = this._pred(key)[0].forward[0]; return c !== null && c.key === key ? c.value : dflt; }
  has(key) { const c = this._pred(key)[0].forward[0]; return c !== null && c.key === key; }
  delete(key) {
    const update = this._pred(key), cand = update[0].forward[0];
    if (cand === null || cand.key !== key) return false;
    for (let i = 0; i < this.level; i++) { if (update[i].forward[i] !== cand) break; update[i].forward[i] = cand.forward[i]; }
    while (this.level > 1 && this.head.forward[this.level - 1] === null) this.level--;
    this._n--; return true;
  }
  *items() { for (let x = this.head.forward[0]; x !== null; x = x.forward[0]) yield [x.key, x.value]; }
  range(lo, hi) {
    const out = [];
    for (let x = this._pred(lo)[0].forward[0]; x !== null && x.key <= hi; x = x.forward[0]) out.push([x.key, x.value]);
    return out;
  }
}

// -------------------------------------------------------------------- Trie
// pior primeiro: menor peso; empate -> palavra alfabeticamente maior
const rankLt = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] > b[1]);
const newNode = () => ({ children: new Map(), weight: 0, end: false });

export class Trie {
  constructor() { this.root = newNode(); this._n = 0; this._nodes = 1; }
  get length() { return this._n; }
  get nodeCount() { return this._nodes; }
  insert(word, weight = 1) {
    let node = this.root;
    for (const ch of word) {
      let nxt = node.children.get(ch);
      if (!nxt) { nxt = newNode(); node.children.set(ch, nxt); this._nodes++; }
      node = nxt;
    }
    if (!node.end) { node.end = true; this._n++; }
    node.weight += weight;
  }
  _walk(s) {
    let node = this.root;
    for (const ch of s) { node = node.children.get(ch); if (!node) return null; }
    return node;
  }
  contains(word) { const n = this._walk(word); return !!n && n.end; }
  hasPrefix(p) { return this._walk(p) !== null; }
  weight(word) { const n = this._walk(word); return n && n.end ? n.weight : 0; }
  path(prefix) {
    const out = []; let node = this.root;
    for (const ch of prefix) { node = node.children.get(ch); if (!node) break; out.push(ch); }
    return out;
  }
  delete(word) {
    const stack = []; let node = this.root;
    for (const ch of word) { const nxt = node.children.get(ch); if (!nxt) return false; stack.push([node, ch]); node = nxt; }
    if (!node.end) return false;
    node.end = false; node.weight = 0; this._n--;
    while (stack.length && !node.end && node.children.size === 0) {
      const [parent, ch] = stack.pop(); parent.children.delete(ch); this._nodes--; node = parent;
    }
    return true;
  }
  words(prefix = "") {
    const start = this._walk(prefix), out = [];
    if (!start) return out;
    const stack = [[start, prefix]];
    while (stack.length) {
      const [node, acc] = stack.pop();
      if (node.end) out.push([acc, node.weight]);
      for (const [ch, c] of node.children) stack.push([c, acc + ch]);
    }
    return out;
  }
  /** Top-K palavras com o prefixo, por peso desc e depois alfabética. */
  autocomplete(prefix, k = 5) {
    const start = this._walk(prefix);
    if (!start || k <= 0) return [];
    const heap = new BinaryHeap({ lt: rankLt });
    const stack = [[start, prefix]];
    while (stack.length) {
      const [node, acc] = stack.pop();
      if (node.end) {
        const item = [node.weight, acc];
        if (heap.length < k) heap.push(item);
        else if (rankLt(heap.peek(), item)) { heap.pop(); heap.push(item); }
      }
      for (const [ch, c] of node.children) stack.push([c, acc + ch]);
    }
    const out = [];
    while (heap.length) out.push(heap.pop());
    out.reverse();
    return out.map(([w, word]) => [word, w]);
  }
}
