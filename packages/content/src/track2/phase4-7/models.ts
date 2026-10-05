/**
 * Models for the Track 2 levels of phases 4 to 7: the tests' expected values
 * come from these TypeScript functions, written independently of the
 * reference solutions (solutions/track2/phase4-7). Pure: no I/O, no clock,
 * no Math.random; random test inputs come from `prng`.
 */

export type Vec = number[];
export type Mat = number[][];

/** mulberry32: a small seeded generator returning floats in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A rows x cols matrix of values in [-1, 1), rounded to 2 decimals so tests stay readable. */
export function randMat(seed: number, rows: number, cols: number): Mat {
  const r = prng(seed);
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round((r() * 2 - 1) * 100) / 100));
}

export const randVec = (seed: number, n: number): Vec => randMat(seed, 1, n)[0]!;

// ------------------------------------------------------------------ phase 4

export const buildVocab = (text: string): string[] => [...new Set(text)].sort();

export const encodeChars = (vocab: string[], text: string): number[] => Array.from(text, (c) => vocab.indexOf(c));

export const decodeChars = (vocab: string[], ids: number[]): string => ids.map((i) => vocab[i]!).join('');

/** Replace every non-overlapping (a, b), left to right, with `id`. */
function mergePair(ids: number[], a: number, b: number, id: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (i + 1 < ids.length && ids[i] === a && ids[i + 1] === b) {
      out.push(id);
      i++;
    } else out.push(ids[i]!);
  }
  return out;
}

/** BPE training on character codes: most frequent adjacent pair (count >= 2), ties to the earliest first occurrence. */
export function trainBpe(text: string, numMerges: number): [number, number][] {
  let ids = Array.from(text, (c) => c.charCodeAt(0));
  const merges: [number, number][] = [];
  for (let m = 0; m < numMerges; m++) {
    const counts = new Map<string, { n: number; first: number; a: number; b: number }>();
    for (let i = 0; i + 1 < ids.length; i++) {
      const key = `${ids[i]},${ids[i + 1]}`;
      const e = counts.get(key);
      if (e) e.n++;
      else counts.set(key, { n: 1, first: i, a: ids[i]!, b: ids[i + 1]! });
    }
    let best: { n: number; first: number; a: number; b: number } | undefined;
    for (const e of counts.values()) if (e.n >= 2 && (!best || e.n > best.n || (e.n === best.n && e.first < best.first))) best = e;
    if (!best) break;
    merges.push([best.a, best.b]);
    ids = mergePair(ids, best.a, best.b, 256 + m);
  }
  return merges;
}

export function encodeBpe(text: string, merges: [number, number][]): number[] {
  let ids = Array.from(text, (c) => c.charCodeAt(0));
  merges.forEach(([a, b], m) => (ids = mergePair(ids, a, b, 256 + m)));
  return ids;
}

export const embed = (table: Mat, ids: number[]): Mat => ids.map((i) => [...table[i]!]);

export function embedBackward(ids: number[], dOut: Mat, vocabSize: number): Mat {
  const dim = dOut[0]?.length ?? 0;
  const d: Mat = Array.from({ length: vocabSize }, () => new Array<number>(dim).fill(0));
  ids.forEach((id, row) => dOut[row]!.forEach((v, j) => (d[id]![j]! += v)));
  return d;
}

export const dot = (a: Vec, b: Vec): number => a.reduce((s, x, i) => s + x * b[i]!, 0);
export const cosine = (a: Vec, b: Vec): number => dot(a, b) / Math.sqrt(dot(a, a) * dot(b, b));

export function countBigrams(ids: number[], V: number): Mat {
  const c: Mat = Array.from({ length: V }, () => new Array<number>(V).fill(0));
  for (let i = 0; i + 1 < ids.length; i++) c[ids[i]!]![ids[i + 1]!]!++;
  return c;
}

export const bigramProbs = (counts: Mat, alpha: number): Mat =>
  counts.map((row) => {
    const total = row.reduce((s, c) => s + c, 0) + alpha * row.length;
    return row.map((c) => (c + alpha) / total);
  });

export function meanNll(probs: Mat, ids: number[]): number {
  let s = 0;
  for (let i = 0; i + 1 < ids.length; i++) s -= Math.log(probs[ids[i]!]![ids[i + 1]!]!);
  return s / (ids.length - 1);
}

// ------------------------------------------------------------------ phase 5

export function positionalEncoding(T: number, d: number): Mat {
  return Array.from({ length: T }, (_, pos) =>
    Array.from({ length: d }, (_, j) => {
      const angle = pos / 10000 ** ((j - (j % 2)) / d);
      return j % 2 === 0 ? Math.sin(angle) : Math.cos(angle);
    }),
  );
}

export const transpose = (A: Mat): Mat => A[0]!.map((_, j) => A.map((r) => r[j]!));
export const matmul = (A: Mat, B: Mat): Mat => {
  const Bt = transpose(B);
  return A.map((r) => Bt.map((c) => dot(r, c)));
};
export const addMat = (A: Mat, B: Mat): Mat => A.map((r, i) => r.map((v, j) => v + B[i]![j]!));

export function softmax(xs: Vec): Vec {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** Attention weights softmax(Q K^T / sqrt(d)), with future positions masked when `causal`. */
export function attentionWeights(Q: Mat, K: Mat, causal: boolean): Mat {
  const scale = 1 / Math.sqrt(K[0]!.length);
  return Q.map((q, t) => {
    const n = causal ? t + 1 : K.length;
    const w = softmax(K.slice(0, n).map((k) => dot(q, k) * scale));
    return [...w, ...new Array<number>(K.length - n).fill(0)];
  });
}

export const attention = (Q: Mat, K: Mat, V: Mat, causal = false): Mat => matmul(attentionWeights(Q, K, causal), V);

export const selfAttention = (x: Mat, Wq: Mat, Wk: Mat, Wv: Mat): Mat => attention(matmul(x, Wq), matmul(x, Wk), matmul(x, Wv));

const cols = (X: Mat, from: number, to: number): Mat => X.map((r) => r.slice(from, to));

export function multiHeadAttention(x: Mat, Wq: Mat, Wk: Mat, Wv: Mat, Wo: Mat, nHead: number): Mat {
  const Q = matmul(x, Wq);
  const K = matmul(x, Wk);
  const V = matmul(x, Wv);
  const hs = Q[0]!.length / nHead;
  const heads: Mat[] = [];
  for (let h = 0; h < nHead; h++) heads.push(attention(cols(Q, h * hs, (h + 1) * hs), cols(K, h * hs, (h + 1) * hs), cols(V, h * hs, (h + 1) * hs), true));
  return matmul(
    x.map((_, t) => heads.flatMap((hd) => hd[t]!)),
    Wo,
  );
}

export function layerNorm(x: Mat, gamma: Vec, beta: Vec, eps = 1e-5): Mat {
  return x.map((r) => {
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length;
    return r.map((x, j) => ((x - mean) / Math.sqrt(v + eps)) * gamma[j]! + beta[j]!);
  });
}

export const gelu = (v: number): number => 0.5 * v * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (v + 0.044715 * v * v * v)));

export function mlp(x: Mat, W1: Mat, b1: Vec, W2: Mat, b2: Vec): Mat {
  const h = matmul(x, W1).map((r) => r.map((v, j) => gelu(v + b1[j]!)));
  return matmul(h, W2).map((r) => r.map((v, j) => v + b2[j]!));
}

export interface MlpParams {
  gamma: Vec;
  beta: Vec;
  W1: Mat;
  b1: Vec;
  W2: Mat;
  b2: Vec;
}
export const residualMlp = (x: Mat, p: MlpParams): Mat => addMat(x, mlp(layerNorm(x, p.gamma, p.beta), p.W1, p.b1, p.W2, p.b2));

export interface BlockParams {
  ln1: { gamma: Vec; beta: Vec };
  Wq: Mat;
  Wk: Mat;
  Wv: Mat;
  Wo: Mat;
  ln2: { gamma: Vec; beta: Vec };
  W1: Mat;
  b1: Vec;
  W2: Mat;
  b2: Vec;
}

export function transformerBlock(x: Mat, p: BlockParams, nHead: number): Mat {
  const h = addMat(x, multiHeadAttention(layerNorm(x, p.ln1.gamma, p.ln1.beta), p.Wq, p.Wk, p.Wv, p.Wo, nHead));
  return addMat(h, mlp(layerNorm(h, p.ln2.gamma, p.ln2.beta), p.W1, p.b1, p.W2, p.b2));
}

/** Seeded block parameters for d_model C and an MLP of width 4C. */
export function randomBlock(seed: number, C: number): BlockParams {
  const s = (k: number, r: number, c: number, scale = 0.5) => randMat(seed * 100 + k, r, c).map((row) => row.map((v) => Math.round(v * scale * 100) / 100));
  return {
    ln1: { gamma: s(1, 1, C, 1).map((r) => r.map((v) => 1 + v / 4))[0]!, beta: s(2, 1, C, 0.2)[0]! },
    Wq: s(3, C, C),
    Wk: s(4, C, C),
    Wv: s(5, C, C),
    Wo: s(6, C, C),
    ln2: { gamma: s(7, 1, C, 1).map((r) => r.map((v) => 1 + v / 4))[0]!, beta: s(8, 1, C, 0.2)[0]! },
    W1: s(9, C, 4 * C),
    b1: s(10, 1, 4 * C, 0.2)[0]!,
    W2: s(11, 4 * C, C),
    b2: s(12, 1, C, 0.2)[0]!,
  };
}

// ------------------------------------------------------------------ phase 6

export const splitData = (ids: number[], frac: number) => {
  const n = Math.floor(ids.length * frac);
  return { train: ids.slice(0, n), val: ids.slice(n) };
};

export const makeBatch = (ids: number[], starts: number[], T: number) => ({
  x: starts.map((s) => ids.slice(s, s + T)),
  y: starts.map((s) => ids.slice(s + 1, s + T + 1)),
});

export function windowStarts(length: number, T: number): number[] {
  const out: number[] = [];
  for (let s = 0; s + T + 1 <= length; s += T) out.push(s);
  return out;
}

export function smoothCurve(values: Vec, beta: number): Vec {
  let m = 0;
  return values.map((v, i) => {
    m = beta * m + (1 - beta) * v;
    return m / (1 - beta ** (i + 1));
  });
}

export interface SampleOpts {
  temperature?: number;
  topK?: number;
  topP?: number;
}

/**
 * The sampling rule the level specifies: temperature 0 is argmax (lowest id
 * on ties); otherwise softmax(logits / temperature), tokens ordered by
 * probability (ties: lower id first), cut to topK, then to the shortest
 * prefix whose renormalized mass reaches topP, renormalized, and the first
 * token whose running total exceeds u.
 */
export function sampleNext(logits: Vec, opts: SampleOpts, u: number): number {
  const temperature = opts.temperature ?? 1;
  if (temperature === 0) return logits.reduce((best, v, i) => (v > logits[best]! ? i : best), 0);
  const p = softmax(logits.map((v) => v / temperature));
  let order = p.map((_, i) => i).sort((a, b) => p[b]! - p[a]! || a - b);
  if (opts.topK) order = order.slice(0, opts.topK);
  if (opts.topP) {
    const total = order.reduce((s, i) => s + p[i]!, 0);
    let cum = 0;
    let keep = 0;
    while (keep < order.length) {
      cum += p[order[keep]!]! / total;
      keep++;
      if (cum >= opts.topP) break;
    }
    order = order.slice(0, keep);
  }
  const total = order.reduce((s, i) => s + p[i]!, 0);
  let cum = 0;
  for (const i of order) {
    cum += p[i]! / total;
    if (u < cum) return i;
  }
  return order[order.length - 1]!;
}

/** n evenly spaced values of u in (0, 1): (i + 0.5) / n. */
export const uGrid = (n: number): number[] => Array.from({ length: n }, (_, i) => (i + 0.5) / n);

// ------------------------------------------------------------------ phase 7

export function loraRow(W0: Mat, A: Mat, B: Mat, scale: number, x: number): Vec {
  return W0[x]!.map((w, j) => w + scale * B.reduce((s, bk, k) => s + A[x]![k]! * bk[j]!, 0));
}

export function loraBackward(A: Mat, B: Mat, scale: number, x: number, dRow: Vec): { dAx: Vec; dB: Mat } {
  return {
    dAx: B.map((bk) => scale * dot(bk, dRow)),
    dB: B.map((_, k) => dRow.map((d) => scale * A[x]![k]! * d)),
  };
}

export interface Pair {
  chosen: Vec;
  rejected: Vec;
}

export const softplusNeg = (d: number): number => (d > 0 ? Math.log1p(Math.exp(-d)) : -d + Math.log1p(Math.exp(d)));
export const pairLoss = (w: Vec, chosen: Vec, rejected: Vec): number => softplusNeg(dot(w, chosen) - dot(w, rejected));

/** Full-batch gradient descent on the mean pairwise loss, from w = 0. */
export function trainRewardModel(pairs: Pair[], steps: number, lr: number): Vec {
  const dim = pairs[0]!.chosen.length;
  const w = new Array<number>(dim).fill(0);
  for (let s = 0; s < steps; s++) {
    const g = new Array<number>(dim).fill(0);
    for (const { chosen, rejected } of pairs) {
      const d = dot(w, chosen) - dot(w, rejected);
      const k = -1 / (1 + Math.exp(d));
      for (let i = 0; i < dim; i++) g[i]! += (k * (chosen[i]! - rejected[i]!)) / pairs.length;
    }
    for (let i = 0; i < dim; i++) w[i]! -= lr * g[i]!;
  }
  return w;
}

/** Feature names of the toy responses in the preference level. */
export const PREFERENCE_FEATURES = ['answers the question', 'polite', 'length (hundreds of words)', 'typos'];
/** The hidden taste of the toy labeller: rewards answering and politeness, dislikes rambling and typos. */
export const PREFERENCE_TRUE_W = [2, 1, -0.5, -1.5];

/** Seeded preference pairs: responses with random features, the labeller picks by true reward plus noise. */
export function preferencePairs(seed: number, n: number): Pair[] {
  const r = prng(seed);
  const response = (): Vec => [r() < 0.6 ? 1 : 0, r() < 0.5 ? 1 : 0, Math.round(r() * 30) / 10, Math.floor(r() * 4)];
  const pairs: Pair[] = [];
  while (pairs.length < n) {
    const a = response();
    const b = response();
    const noise = (r() - 0.5) * 1.5;
    const d = dot(PREFERENCE_TRUE_W, a) - dot(PREFERENCE_TRUE_W, b) + noise;
    if (d === 0) continue;
    pairs.push(d > 0 ? { chosen: a, rejected: b } : { chosen: b, rejected: a });
  }
  return pairs;
}

/** Least-squares fit of log L = a + b log N. */
export function fitPowerLaw(ns: Vec, losses: Vec): { a: number; b: number } {
  const xs = ns.map(Math.log);
  const ys = losses.map(Math.log);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return { a: my - b * mx, b };
}
