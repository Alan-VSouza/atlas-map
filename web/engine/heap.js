// Heap binária (min ou max) e fila de prioridade indexada.
// `lt(a, b)` diz se a chave a é menor que b (padrão: semântica de tupla do Python).
import { pyLt } from "./pycompat.js";
import { ChainingHashTable } from "./hashtable.js";

export class BinaryHeap {
  constructor({ lt = pyLt, max = false, items = null } = {}) {
    this._a = []; this._lt = lt; this._max = max; this.comparisons = 0; this.swaps = 0;
    if (items) { this._a = Array.from(items); this.heapify(); }
  }
  get length() { return this._a.length; }
  _better(i, j) {
    this.comparisons++;
    const a = this._a;
    return this._max ? this._lt(a[j], a[i]) : this._lt(a[i], a[j]);
  }
  _swap(i, j) { const a = this._a, t = a[i]; a[i] = a[j]; a[j] = t; this.swaps++; }
  _siftUp(i) {
    while (i > 0) { const p = (i - 1) >> 1; if (this._better(i, p)) { this._swap(i, p); i = p; } else break; }
  }
  _siftDown(i) {
    const n = this._a.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let best = i;
      if (l < n && this._better(l, best)) best = l;
      if (r < n && this._better(r, best)) best = r;
      if (best === i) break;
      this._swap(i, best); i = best;
    }
  }
  heapify() { for (let i = (this._a.length >> 1) - 1; i >= 0; i--) this._siftDown(i); }
  push(item) { this._a.push(item); this._siftUp(this._a.length - 1); }
  peek() { if (!this._a.length) throw new RangeError("peek from empty heap"); return this._a[0]; }
  pop() {
    if (!this._a.length) throw new RangeError("pop from empty heap");
    const top = this._a[0], last = this._a.pop();
    if (this._a.length) { this._a[0] = last; this._siftDown(0); }
    return top;
  }
  pushpop(item) { if (!this._a.length) return item; this._a.push(item); this._siftUp(this._a.length - 1); return this.pop(); }
  toList() { return this._a.slice(); }
  isValid() { for (let i = 1; i < this._a.length; i++) if (this._better(i, (i - 1) >> 1)) return false; return true; }
}

export class IndexedPriorityQueue {
  constructor() { this._items = []; this._prios = []; this._pos = new ChainingHashTable(); }
  get length() { return this._items.length; }
  has(item) { return this._pos.has(item); }
  priority(item) { return this._prios[this._pos.get(item)]; }
  _swap(i, j) {
    const it = this._items, pr = this._prios;
    [it[i], it[j]] = [it[j], it[i]]; [pr[i], pr[j]] = [pr[j], pr[i]];
    this._pos.put(it[i], i); this._pos.put(it[j], j);
  }
  _up(i) { while (i > 0) { const p = (i - 1) >> 1; if (this._prios[i] < this._prios[p]) { this._swap(i, p); i = p; } else break; } }
  _down(i) {
    const n = this._items.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let best = i;
      if (l < n && this._prios[l] < this._prios[best]) best = l;
      if (r < n && this._prios[r] < this._prios[best]) best = r;
      if (best === i) break;
      this._swap(i, best); i = best;
    }
  }
  push(item, priority) {
    if (this._pos.has(item)) throw new Error("item já existe; use update()");
    this._items.push(item); this._prios.push(priority);
    this._pos.put(item, this._items.length - 1); this._up(this._items.length - 1);
  }
  update(item, priority) {
    const i = this._pos.get(item); if (i === undefined) throw new Error("item inexistente");
    const old = this._prios[i]; this._prios[i] = priority;
    if (priority < old) this._up(i); else this._down(i);
  }
  peek() { if (!this._items.length) throw new RangeError("peek from empty queue"); return [this._items[0], this._prios[0]]; }
  _removeAt(i) {
    const last = this._items.length - 1, item = this._items[i], prio = this._prios[i];
    if (i !== last) this._swap(i, last);
    this._items.pop(); this._prios.pop(); this._pos.remove(item);
    if (i < this._items.length) { this._up(i); this._down(i); }
    return [item, prio];
  }
  pop() { if (!this._items.length) throw new RangeError("pop from empty queue"); return this._removeAt(0); }
  remove(item) { return this._removeAt(this._pos.get(item)); }
}
