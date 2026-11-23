// Lista duplamente encadeada, vetor dinâmico, pilha, deque e fila circular.

export class DNode {
  constructor(key = null, value = null) { this.key = key; this.value = value; this.prev = null; this.next = null; }
}

export class DoublyLinkedList {
  constructor() {
    this.head = new DNode(); this.tail = new DNode();
    this.head.next = this.tail; this.tail.prev = this.head; this._size = 0;
  }
  get length() { return this._size; }
  _insertBetween(node, left, right) {
    node.prev = left; node.next = right; left.next = node; right.prev = node; this._size++;
    return node;
  }
  pushFront(key, value = null) { return this._insertBetween(new DNode(key, value), this.head, this.head.next); }
  pushBack(key, value = null) { return this._insertBetween(new DNode(key, value), this.tail.prev, this.tail); }
  remove(node) {
    node.prev.next = node.next; node.next.prev = node.prev; node.prev = node.next = null; this._size--;
    return node;
  }
  popFront() { return this._size ? this.remove(this.head.next) : null; }
  popBack() { return this._size ? this.remove(this.tail.prev) : null; }
  moveToFront(node) {
    node.prev.next = node.next; node.next.prev = node.prev;
    node.prev = this.head; node.next = this.head.next;
    this.head.next.prev = node; this.head.next = node;
  }
  *[Symbol.iterator]() { for (let n = this.head.next; n !== this.tail; n = n.next) yield n; }
  toList() { return [...this].map((n) => [n.key, n.value]); }
}

export class DynamicArray {
  constructor(capacity = 4) {
    this._cap = Math.max(1, capacity); this._buf = new Array(this._cap).fill(null);
    this._n = 0; this.resizes = 0; this.copies = 0;
  }
  get length() { return this._n; }
  get capacity() { return this._cap; }
  _resize(newCap) {
    const nb = new Array(newCap).fill(null);
    for (let i = 0; i < this._n; i++) nb[i] = this._buf[i];
    this.copies += this._n; this.resizes++; this._buf = nb; this._cap = newCap;
  }
  append(v) { if (this._n === this._cap) this._resize(this._cap * 2); this._buf[this._n++] = v; }
  pop() {
    if (!this._n) throw new RangeError("pop from empty array");
    const v = this._buf[--this._n]; this._buf[this._n] = null;
    if (this._cap > 4 && this._n <= Math.floor(this._cap / 4)) this._resize(Math.floor(this._cap / 2));
    return v;
  }
  _check(i) { if (i < 0) i += this._n; if (!(i >= 0 && i < this._n)) throw new RangeError("index out of range"); return i; }
  get(i) { return this._buf[this._check(i)]; }
  set(i, v) { this._buf[this._check(i)] = v; }
  *[Symbol.iterator]() { for (let i = 0; i < this._n; i++) yield this._buf[i]; }
}

export class Stack {
  constructor() { this._a = new DynamicArray(); }
  push(v) { this._a.append(v); }
  pop() { if (!this._a.length) throw new RangeError("pop from empty stack"); return this._a.pop(); }
  peek() { if (!this._a.length) throw new RangeError("peek from empty stack"); return this._a.get(-1); }
  clear() { this._a = new DynamicArray(); }
  isEmpty() { return this._a.length === 0; }
  get length() { return this._a.length; }
  toList() { return [...this._a]; }
}

export class Deque {
  constructor(capacity = 8) { this._cap = Math.max(2, capacity); this._buf = new Array(this._cap).fill(null); this._head = 0; this._n = 0; }
  get length() { return this._n; }
  _grow() {
    const nb = new Array(this._cap * 2).fill(null);
    for (let i = 0; i < this._n; i++) nb[i] = this._buf[(this._head + i) % this._cap];
    this._buf = nb; this._cap *= 2; this._head = 0;
  }
  pushBack(v) { if (this._n === this._cap) this._grow(); this._buf[(this._head + this._n) % this._cap] = v; this._n++; }
  pushFront(v) { if (this._n === this._cap) this._grow(); this._head = (this._head - 1 + this._cap) % this._cap; this._buf[this._head] = v; this._n++; }
  popFront() {
    if (!this._n) throw new RangeError("pop from empty deque");
    const v = this._buf[this._head]; this._buf[this._head] = null;
    this._head = (this._head + 1) % this._cap; this._n--; return v;
  }
  popBack() {
    if (!this._n) throw new RangeError("pop from empty deque");
    const idx = (this._head + this._n - 1) % this._cap, v = this._buf[idx];
    this._buf[idx] = null; this._n--; return v;
  }
  peekFront() { if (!this._n) throw new RangeError("peek from empty deque"); return this._buf[this._head]; }
  peekBack() { if (!this._n) throw new RangeError("peek from empty deque"); return this._buf[(this._head + this._n - 1) % this._cap]; }
  *[Symbol.iterator]() { for (let i = 0; i < this._n; i++) yield this._buf[(this._head + i) % this._cap]; }
  toList() { return [...this]; }
}

export class CircularQueue extends Deque {
  enqueue(v) { this.pushBack(v); }
  dequeue() { return this.popFront(); }
  peek() { return this.peekFront(); }
}
