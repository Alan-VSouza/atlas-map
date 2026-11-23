// Compatibilidade bit a bit com o Python: random.Random (Mersenne Twister),
// math.hypot (algoritmo do CPython 3.10+), round(x, n) e comparação de tuplas.
// É isso que garante que a mesma seed gere o mesmo mapa e as mesmas rotas.

const N = 624, M = 397;

export class PyRandom {
  constructor(seed = 0) { this.mt = new Uint32Array(N); this.mti = N + 1; this.seed(seed); }

  _initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
    }
    this.mti = N;
  }

  _initByArray(key) {
    const mt = this.mt;
    this._initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(N, key.length); k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  /** random.seed(int): a chave são os blocos de 32 bits de abs(seed). */
  seed(a) {
    let n = BigInt(a); if (n < 0n) n = -n;
    const key = [];
    if (n === 0n) key.push(0);
    while (n > 0n) { key.push(Number(n & 0xffffffffn)); n >>= 32n; }
    this._initByArray(key);
  }

  _u32() {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0, y;
      for (; kk < N - M; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random() {
    const a = this._u32() >>> 5, b = this._u32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  getrandbits(k) {
    if (k === 0) return 0;
    if (k > 32) throw new Error("getrandbits > 32 não suportado");
    return this._u32() >>> (32 - k);
  }

  _randbelow(n) {
    const k = bitLength(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  randrange(start, stop) {
    if (stop === undefined) {
      if (start > 0) return this._randbelow(start);
      throw new Error("randrange vazio");
    }
    const width = stop - start;
    if (width > 0) return start + this._randbelow(width);
    throw new Error("randrange vazio");
  }

  randint(a, b) { return this.randrange(a, b + 1); }
  uniform(a, b) { return a + (b - a) * this.random(); }

  choice(seq) {
    if (!seq.length) throw new Error("choice de sequência vazia");
    return seq[this._randbelow(seq.length)];
  }

  shuffle(x) {
    for (let i = x.length - 1; i >= 1; i--) {
      const j = this._randbelow(i + 1);
      const t = x[i]; x[i] = x[j]; x[j] = t;
    }
  }

  /** random.sample(population, k), mesmo algoritmo (pool ou conjunto) do CPython. */
  sample(population, k) {
    const n = population.length;
    if (!(k >= 0 && k <= n)) throw new Error("amostra maior que a população");
    const result = new Array(k);
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    if (n <= setsize) {
      const pool = Array.from(population);
      for (let i = 0; i < k; i++) {
        const j = this._randbelow(n - i);
        result[i] = pool[j];
        pool[j] = pool[n - i - 1];
      }
    } else {
      const selected = new Set();
      for (let i = 0; i < k; i++) {
        let j = this._randbelow(n);
        while (selected.has(j)) j = this._randbelow(n);
        selected.add(j);
        result[i] = population[j];
      }
    }
    return result;
  }

  /** random.choices(population, weights, k=1) com pesos (bisect sobre acumulados). */
  choices(population, weights, k = 1) {
    const cum = []; let acc = 0;
    for (const w of weights) { acc += w; cum.push(acc); }
    const total = cum[cum.length - 1] + 0.0, hi = population.length - 1, out = [];
    for (let i = 0; i < k; i++) out.push(population[bisectRight(cum, this.random() * total, 0, hi)]);
    return out;
  }
}

export function bitLength(n) {
  if (n <= 0) return 0;
  if (n <= 0xffffffff) return 32 - Math.clz32(n);
  return n.toString(2).length;
}

export function bisectRight(a, x, lo = 0, hi = a.length) {
  while (lo < hi) { const mid = (lo + hi) >> 1; if (x < a[mid]) hi = mid; else lo = mid + 1; }
  return lo;
}

// ------------------------------------------------------------- math.hypot
// Porte direto de vector_norm() do CPython: escala sem perda, quadrados exatos
// (produto de Dekker) e correção diferencial. Resultado idêntico ao do Python.
const SPLIT = 134217729; // 2^27 + 1
function twoProd(a, b) {
  const p = a * b;
  let t = SPLIT * a; const ah = t - (t - a), al = a - ah;
  t = SPLIT * b; const bh = t - (t - b), bl = b - bh;
  const e = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return [p, e];
}
function frexpExp(x) { // expoente e tal que x = m * 2^e, 0.5 <= m < 1
  let e = Math.floor(Math.log2(x)) + 1;
  while (x * 2 ** -e >= 1) e++;
  while (x * 2 ** -e < 0.5) e--;
  return e;
}
export function hypot(a, b) {
  const x0 = Math.abs(a), y0 = Math.abs(b);
  if (x0 === Infinity || y0 === Infinity) return Infinity;
  if (Number.isNaN(x0) || Number.isNaN(y0)) return NaN;
  const max = x0 > y0 ? x0 : y0;
  if (max === 0) return max;
  const scale = 2 ** -frexpExp(max);
  let csum = 1.0, frac1 = 0.0, frac2 = 0.0;
  for (const v of [x0, y0]) {
    const x = v * scale;
    const [hi, lo] = twoProd(x, x);
    const s = csum + hi, z = s - csum, y = hi - z;
    csum = s; frac1 += lo; frac2 += y;
  }
  let h = Math.sqrt(csum - 1.0 + (frac1 + frac2));
  const [phi, plo] = twoProd(-h, h);
  const s = csum + phi, z = s - csum, y = phi - z;
  csum = s; frac1 += plo; frac2 += y;
  const x = csum - 1.0 + (frac1 + frac2);
  h += x / (2.0 * h);
  return h / scale;
}

// ------------------------------------------------------------- round(x, n)
/** round() do Python: arredonda o valor decimal exato, empate para o par. */
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return x;
  const neg = x < 0, ax = Math.abs(x);
  if (ax >= 1e21) return x;
  const exact = ax.toFixed(100);
  const dot = exact.indexOf(".");
  const intPart = exact.slice(0, dot), frac = exact.slice(dot + 1);
  let digits = intPart + frac.slice(0, nd);
  const next = frac.charCodeAt(nd) - 48, rest = frac.slice(nd + 1);
  const restZero = !/[1-9]/.test(rest);
  let up = next > 5 || (next === 5 && !restZero) ||
    (next === 5 && restZero && ((digits.charCodeAt(digits.length - 1) - 48) & 1) === 1);
  if (up) {
    const arr = digits.split(""); let i = arr.length - 1;
    while (i >= 0) { if (arr[i] === "9") { arr[i] = "0"; i--; } else { arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1); break; } }
    digits = (i < 0 ? "1" : "") + arr.join("");
  }
  const ip = digits.slice(0, digits.length - nd) || "0", fp = digits.slice(digits.length - nd);
  const v = Number(ip + (nd ? "." + fp : ""));
  return neg ? -v : v;
}

/** round(x) sem casas: inteiro com empate para o par. */
export function pyRoundInt(x) { return pyRound(x, 0); }

// ------------------------------------------------------- comparação de tuplas
/** a < b com a semântica do Python para números, strings e tuplas (arrays). */
export function pyLt(a, b) {
  if (Array.isArray(a)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (!pyEq(a[i], b[i])) return pyLt(a[i], b[i]);
    }
    return a.length < b.length;
  }
  return a < b;
}
export function pyEq(a, b) {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!pyEq(a[i], b[i])) return false;
    return true;
  }
  return a === b;
}
/** Comparador para Array.sort (estável, como sorted() do Python). */
export const pyCmp = (a, b) => (pyLt(a, b) ? -1 : pyLt(b, a) ? 1 : 0);
