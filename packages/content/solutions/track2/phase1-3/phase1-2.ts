import { AUTOGRAD_CHECKS } from '../../../src/track2/phase1-3/phase2';

/**
 * Reference main.js for Track 2 phases 1 and 2 (plain JavaScript). Loaded by
 * the game only on "Show solution" (ADR-007).
 */

const VALUE = `export class Value {
  constructor(data, children = [], op = '') {
    this.data = data;
    this.grad = 0;
    this._children = children;
    this._backward = () => {};
    this.op = op;
  }

  add(other) {
    other = other instanceof Value ? other : new Value(other);
    const out = new Value(this.data + other.data, [this, other], '+');
    out._backward = () => {
      this.grad += out.grad;
      other.grad += out.grad;
    };
    return out;
  }

  mul(other) {
    other = other instanceof Value ? other : new Value(other);
    const out = new Value(this.data * other.data, [this, other], '*');
    out._backward = () => {
      this.grad += other.data * out.grad;
      other.grad += this.data * out.grad;
    };
    return out;
  }

  pow(n) {
    const out = new Value(this.data ** n, [this], '**');
    out._backward = () => {
      this.grad += n * this.data ** (n - 1) * out.grad;
    };
    return out;
  }

  tanh() {
    const t = Math.tanh(this.data);
    const out = new Value(t, [this], 'tanh');
    out._backward = () => {
      this.grad += (1 - t * t) * out.grad;
    };
    return out;
  }

  relu() {
    const out = new Value(Math.max(0, this.data), [this], 'relu');
    out._backward = () => {
      this.grad += (out.data > 0 ? 1 : 0) * out.grad;
    };
    return out;
  }

  neg() {
    return this.mul(-1);
  }

  sub(other) {
    return this.add(other instanceof Value ? other.neg() : -other);
  }

  backward() {
    const topo = [];
    const seen = new Set();
    const build = (v) => {
      if (seen.has(v)) return;
      seen.add(v);
      for (const c of v._children) build(c);
      topo.push(v);
    };
    build(this);
    this.grad = 1;
    for (let i = topo.length - 1; i >= 0; i--) topo[i]._backward();
  }
}

export function numericalGrad(f, xs, h = 1e-5) {
  return xs.map((_, i) => {
    const plus = xs.slice();
    const minus = xs.slice();
    plus[i] += h;
    minus[i] -= h;
    return (f(plus) - f(minus)) / (2 * h);
  });
}
`;

export const PHASE1_2_SOLUTIONS: Record<string, string> = {
  'vectors-dot': `export function add(a, b) {
  return a.map((x, i) => x + b[i]);
}

export function scale(k, a) {
  return a.map((x) => k * x);
}

export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function norm(a) {
  return Math.sqrt(dot(a, a));
}
`,

  matmul: `export function transpose(A) {
  return A[0].map((_, j) => A.map((row) => row[j]));
}

export function matmul(A, B) {
  const m = A.length, k = B.length, n = B[0].length;
  const C = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++)
    for (let t = 0; t < k; t++)
      for (let j = 0; j < n; j++) C[i][j] += A[i][t] * B[t][j];
  return C;
}
`,

  broadcasting: `export function shape(x) {
  if (typeof x === 'number') return [];
  return Array.isArray(x[0]) ? [x.length, x[0].length] : [x.length];
}

const as2d = (x) => (typeof x === 'number' ? [[x]] : Array.isArray(x[0]) ? x : [x]);
const pick = (M, i, j) => M[M.length === 1 ? 0 : i][M[0].length === 1 ? 0 : j];

function broadcast(a, b, f) {
  const rank = Math.max(shape(a).length, shape(b).length);
  const A = as2d(a), B = as2d(b);
  const rows = Math.max(A.length, B.length);
  const cols = Math.max(A[0].length, B[0].length);
  const out = [];
  for (let i = 0; i < rows; i++) {
    const r = [];
    for (let j = 0; j < cols; j++) r.push(f(pick(A, i, j), pick(B, i, j)));
    out.push(r);
  }
  return rank === 0 ? out[0][0] : rank === 1 ? out[0] : out;
}

export const add = (a, b) => broadcast(a, b, (x, y) => x + y);
export const mul = (a, b) => broadcast(a, b, (x, y) => x * y);
`,

  softmax: `export function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

export function softmaxRows(M) {
  return M.map(softmax);
}
`,

  'a-neuron': `export const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const relu = (z) => Math.max(0, z);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const neuron = (x, w, b) => sigmoid(dot(x, w) + b);
export const layer = (x, W, b) => W.map((w, i) => neuron(x, w, b[i]));
`,

  'loss-functions': `export function mse(pred, target) {
  let s = 0;
  for (let i = 0; i < pred.length; i++) s += (pred[i] - target[i]) ** 2;
  return s / pred.length;
}

export function bce(p, y) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = Math.min(Math.max(p[i], 1e-7), 1 - 1e-7);
    s += y[i] * Math.log(q) + (1 - y[i]) * Math.log(1 - q);
  }
  return -s / p.length;
}

export function crossEntropy(logits, label) {
  const m = Math.max(...logits);
  const lse = m + Math.log(logits.reduce((s, x) => s + Math.exp(x - m), 0));
  return lse - logits[label];
}
`,

  'gradient-descent-1d': `export function descend(x0, lr, steps) {
  let x = x0;
  for (let i = 0; i < steps; i++) x -= lr * 2 * (x - 3);
  return { x, loss: (x - 3) ** 2 };
}

export function fitSlope(xs, ys, lr, steps) {
  let w = 0;
  for (let s = 0; s < steps; s++) {
    let g = 0;
    for (let i = 0; i < xs.length; i++) g += 2 * (w * xs[i] - ys[i]) * xs[i];
    w -= (lr * g) / xs.length;
  }
  return w;
}
`,

  'chain-rule': `const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export function forwardBackward(x, w, b, y) {
  const z = w * x + b;
  const a = sigmoid(z);
  const loss = (a - y) ** 2;
  const da = 2 * (a - y);
  const dz = da * a * (1 - a);
  return { loss, dw: dz * x, db: dz, dx: dz * w };
}

export function twoLayer(x, w1, w2, y) {
  const h = Math.tanh(w1 * x);
  const out = w2 * h;
  const dout = 2 * (out - y);
  const dh = dout * w2;
  return { loss: (out - y) ** 2, dw1: dh * (1 - h * h) * x, dw2: dout * h };
}
`,

  autograd: VALUE + AUTOGRAD_CHECKS,
};
