// Índices espaciais 2D: Quadtree e KD-Tree (k vizinhos mais próximos com poda).
import { BinaryHeap } from "./heap.js";

function rectDist2(x, y, x0, y0, x1, y1) {
  const dx = Math.max(x0 - x, 0.0, x - x1), dy = Math.max(y0 - y, 0.0, y - y1);
  return dx * dx + dy * dy;
}
const ltFirst = (a, b) => a[0] < b[0];

export class Quadtree {
  constructor(x0, y0, x1, y1, capacity = 4, maxDepth = 12, depth = 0) {
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    this.capacity = capacity; this.maxDepth = maxDepth; this.depth = depth;
    this.points = []; this.children = null; this._size = 0;
  }
  get length() { return this._size; }
  _childIndex(x, y) {
    const mx = (this.x0 + this.x1) / 2.0, my = (this.y0 + this.y1) / 2.0;
    return (x >= mx ? 1 : 0) + (y >= my ? 2 : 0);
  }
  _subdivide() {
    const mx = (this.x0 + this.x1) / 2.0, my = (this.y0 + this.y1) / 2.0, d = this.depth + 1, c = this.capacity, md = this.maxDepth;
    this.children = [
      new Quadtree(this.x0, this.y0, mx, my, c, md, d), new Quadtree(mx, this.y0, this.x1, my, c, md, d),
      new Quadtree(this.x0, my, mx, this.y1, c, md, d), new Quadtree(mx, my, this.x1, this.y1, c, md, d),
    ];
    const pts = this.points; this.points = []; this._size = 0;
    for (const [x, y, data] of pts) this.insert(x, y, data);
  }
  containsPoint(x, y) { return this.x0 <= x && x <= this.x1 && this.y0 <= y && y <= this.y1; }
  insert(x, y, data = null) {
    if (!this.containsPoint(x, y)) return false;
    let node = this; node._size++;
    while (node.children !== null) { node = node.children[node._childIndex(x, y)]; node._size++; }
    node.points.push([x, y, data]);
    if (node.points.length > node.capacity && node.depth < node.maxDepth) {
      node._size -= node.points.length;
      node._subdivide();
    }
    return true;
  }
  remove(x, y, data = null) {
    const path = [this]; let node = this;
    while (node.children !== null) { node = node.children[node._childIndex(x, y)]; path.push(node); }
    for (let i = 0; i < node.points.length; i++) {
      const [px, py, pd] = node.points[i];
      if (px === x && py === y && pd === data) {
        node.points.splice(i, 1);
        for (const n of path) n._size--;
        return true;
      }
    }
    return false;
  }
  query(qx0, qy0, qx1, qy1) {
    const out = [], stack = [this];
    while (stack.length) {
      const n = stack.pop();
      if (qx1 < n.x0 || qx0 > n.x1 || qy1 < n.y0 || qy0 > n.y1) continue;
      if (n.children !== null) stack.push(...n.children);
      else for (const p of n.points) if (qx0 <= p[0] && p[0] <= qx1 && qy0 <= p[1] && p[1] <= qy1) out.push(p);
    }
    return out;
  }
  /** k pontos mais próximos: lista de [dist2, px, py, data] crescente. */
  nearest(x, y, k = 1) {
    if (k <= 0 || this._size === 0) return [];
    const heap = new BinaryHeap({ lt: ltFirst, max: true });
    const visit = (n) => {
      if (n._size === 0) return;
      if (heap.length === k && rectDist2(x, y, n.x0, n.y0, n.x1, n.y1) >= heap.peek()[0]) return;
      if (n.children === null) {
        for (const [px, py, d] of n.points) {
          const d2 = (px - x) * (px - x) + (py - y) * (py - y);
          if (heap.length < k) heap.push([d2, px, py, d]);
          else if (d2 < heap.peek()[0]) { heap.pop(); heap.push([d2, px, py, d]); }
        }
      } else {
        const order = n.children.map((c) => [rectDist2(x, y, c.x0, c.y0, c.x1, c.y1), c])
          .sort((a, b) => a[0] - b[0]);
        for (const [, c] of order) visit(c);
      }
    };
    visit(this);
    const out = [];
    while (heap.length) out.push(heap.pop());
    return out.reverse();
  }
  rects() {
    const out = [], stack = [this];
    while (stack.length) {
      const n = stack.pop();
      if (n.children !== null) stack.push(...n.children); else out.push([n.x0, n.y0, n.x1, n.y1]);
    }
    return out;
  }
}

export class KDTree {
  /** points: lista de [x, y, data]. Estrutura estática. */
  constructor(points) { this.size = points.length; this.root = this._build(Array.from(points), 0); }
  get length() { return this.size; }
  _build(pts, depth) {
    if (!pts.length) return null;
    const axis = depth % 2;
    pts.sort((a, b) => a[axis] - b[axis]);
    const mid = pts.length >> 1;
    return { pt: pts[mid], axis, left: this._build(pts.slice(0, mid), depth + 1), right: this._build(pts.slice(mid + 1), depth + 1) };
  }
  nearest(x, y, k = 1) {
    if (k <= 0 || this.root === null) return [];
    const heap = new BinaryHeap({ lt: ltFirst, max: true });
    const visit = (n) => {
      if (n === null) return;
      const [px, py, d] = n.pt, d2 = (px - x) * (px - x) + (py - y) * (py - y);
      if (heap.length < k) heap.push([d2, px, py, d]);
      else if (d2 < heap.peek()[0]) { heap.pop(); heap.push([d2, px, py, d]); }
      const diff = n.axis === 0 ? x - px : y - py;
      const [near, far] = diff < 0 ? [n.left, n.right] : [n.right, n.left];
      visit(near);
      if (heap.length < k || diff * diff < heap.peek()[0]) visit(far);
    };
    visit(this.root);
    const out = [];
    while (heap.length) out.push(heap.pop());
    return out.reverse();
  }
}
