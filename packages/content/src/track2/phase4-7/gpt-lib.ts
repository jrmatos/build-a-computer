/**
 * gpt.js, the read-only library of the Phase 6 and 7 levels: a reverse-mode
 * autograd over 2-D Float64Array tensors, a pre-norm decoder-only
 * transformer (createGPT, gptForward), Adam, and character/batch helpers.
 * Plain JavaScript so players can read every line. Gradients are checked
 * against finite differences in phase4-7.test.ts (E-ML-05: float64 on the CPU).
 */
export const GPT_JS = String.raw`// gpt.js: provided by the level (read only).
// A tiny GPT in plain JavaScript: a reverse-mode autograd over 2-D arrays of
// numbers, the layers of a decoder-only transformer and the Adam optimizer.
// Small and slow on purpose: it is here so you can read every line.
//
//   const r = rng(42);                       seeded random numbers in [0, 1)
//   const model = createGPT({ vocabSize, blockSize: 32, dModel: 32, nHead: 4, nLayer: 1, seed: 1 });
//   const { loss } = gptForward(model, x, B, T, y);   x, y: B*T token ids
//   zeroGrad(model); backward(loss); adamStep(model, opt, 0.01);
//   nextLogits(model, ids)                   logits for the token after ids

/** A seeded random number generator (mulberry32): returns () => [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal sample from a uniform generator (Box-Muller). */
export function randn(r) {
  let u = r();
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// ------------------------------------------------------------------ autograd

let tape = [];

/** A 2-D array of numbers (rows x cols), with a gradient after backward(). */
export class Tensor {
  constructor(data, rows, cols) {
    this.data = data;
    this.rows = rows;
    this.cols = cols;
    this.grad = null;
  }
  g() {
    if (!this.grad) this.grad = new Float64Array(this.data.length);
    return this.grad;
  }
  /** The value of a 1 x 1 tensor (a loss). */
  item() {
    return this.data[0];
  }
}

export const tensor = (rows, cols, data) => new Tensor(data || new Float64Array(rows * cols), rows, cols);

/** Run every recorded operation backwards, from loss (1 x 1) to the inputs. */
export function backward(loss) {
  loss.g()[0] = 1;
  for (let i = tape.length - 1; i >= 0; i--) tape[i]();
  tape = [];
}

/** Forget the recorded operations without computing gradients (evaluation). */
export function clearTape() {
  tape = [];
}

/** Rows of table picked by ids. */
export function embed(table, ids) {
  const C = table.cols;
  const out = tensor(ids.length, C);
  for (let i = 0; i < ids.length; i++) out.data.set(table.data.subarray(ids[i] * C, ids[i] * C + C), i * C);
  tape.push(() => {
    if (!out.grad) return;
    const tg = table.g();
    for (let i = 0; i < ids.length; i++) for (let c = 0; c < C; c++) tg[ids[i] * C + c] += out.grad[i * C + c];
  });
  return out;
}

/** Rows 0..n-1 of table, repeated times times (positions of a batch). */
export function embedPositions(table, times, n) {
  const ids = [];
  for (let b = 0; b < times; b++) for (let t = 0; t < n; t++) ids.push(t);
  return embed(table, ids);
}

/** a + b (same shape). */
export function add(a, b) {
  const out = tensor(a.rows, a.cols);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] + b.data[i];
  tape.push(() => {
    if (!out.grad) return;
    const ag = a.g();
    const bg = b.g();
    for (let i = 0; i < out.grad.length; i++) {
      ag[i] += out.grad[i];
      bg[i] += out.grad[i];
    }
  });
  return out;
}

/** x @ w + bias (x: n x k, w: k x m, bias: 1 x m or null). */
export function linear(x, w, bias) {
  const n = x.rows;
  const k = x.cols;
  const m = w.cols;
  const out = tensor(n, m);
  const X = x.data;
  const W = w.data;
  const O = out.data;
  for (let i = 0; i < n; i++) {
    const o = i * m;
    if (bias) for (let j = 0; j < m; j++) O[o + j] = bias.data[j];
    for (let p = 0; p < k; p++) {
      const xv = X[i * k + p];
      const wr = p * m;
      for (let j = 0; j < m; j++) O[o + j] += xv * W[wr + j];
    }
  }
  tape.push(() => {
    if (!out.grad) return;
    const G = out.grad;
    const xg = x.g();
    const wg = w.g();
    for (let i = 0; i < n; i++) {
      const o = i * m;
      for (let p = 0; p < k; p++) {
        const wr = p * m;
        const xv = X[i * k + p];
        let s = 0;
        for (let j = 0; j < m; j++) {
          s += G[o + j] * W[wr + j];
          wg[wr + j] += xv * G[o + j];
        }
        xg[i * k + p] += s;
      }
    }
    if (bias) {
      const bg = bias.g();
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) bg[j] += G[i * m + j];
    }
  });
  return out;
}

/** Layer norm over each row, then scale by gamma and shift by beta (1 x cols each). */
export function layerNorm(x, gamma, beta, eps = 1e-5) {
  const n = x.rows;
  const C = x.cols;
  const out = tensor(n, C);
  const xhat = new Float64Array(n * C);
  const rstd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let mean = 0;
    for (let c = 0; c < C; c++) mean += x.data[i * C + c];
    mean /= C;
    let v = 0;
    for (let c = 0; c < C; c++) v += (x.data[i * C + c] - mean) ** 2;
    rstd[i] = 1 / Math.sqrt(v / C + eps);
    for (let c = 0; c < C; c++) {
      const h = (x.data[i * C + c] - mean) * rstd[i];
      xhat[i * C + c] = h;
      out.data[i * C + c] = h * gamma.data[c] + beta.data[c];
    }
  }
  tape.push(() => {
    if (!out.grad) return;
    const G = out.grad;
    const xg = x.g();
    const gg = gamma.g();
    const bg = beta.g();
    for (let i = 0; i < n; i++) {
      let s1 = 0;
      let s2 = 0;
      for (let c = 0; c < C; c++) {
        const dh = G[i * C + c] * gamma.data[c];
        s1 += dh;
        s2 += dh * xhat[i * C + c];
        gg[c] += G[i * C + c] * xhat[i * C + c];
        bg[c] += G[i * C + c];
      }
      for (let c = 0; c < C; c++) {
        const dh = G[i * C + c] * gamma.data[c];
        xg[i * C + c] += rstd[i] * (dh - s1 / C - (xhat[i * C + c] * s2) / C);
      }
    }
  });
  return out;
}

/** GELU, tanh approximation (as in GPT-2). */
export function gelu(x) {
  const out = tensor(x.rows, x.cols);
  const K = Math.sqrt(2 / Math.PI);
  const th = new Float64Array(x.data.length);
  for (let i = 0; i < x.data.length; i++) {
    const v = x.data[i];
    th[i] = Math.tanh(K * (v + 0.044715 * v * v * v));
    out.data[i] = 0.5 * v * (1 + th[i]);
  }
  tape.push(() => {
    if (!out.grad) return;
    const xg = x.g();
    for (let i = 0; i < x.data.length; i++) {
      const v = x.data[i];
      const d = 0.5 * (1 + th[i]) + 0.5 * v * (1 - th[i] * th[i]) * K * (1 + 3 * 0.044715 * v * v);
      xg[i] += out.grad[i] * d;
    }
  });
  return out;
}

/**
 * Causal multi-head self-attention. qkv: (B*T) x (3*C), the queries, keys and
 * values side by side. Returns (B*T) x C, the heads joined back together.
 */
export function causalSelfAttention(qkv, B, T, nHead) {
  const C = qkv.cols / 3;
  const hs = C / nHead;
  const scale = 1 / Math.sqrt(hs);
  const Q = qkv.data;
  const out = tensor(B * T, C);
  const att = new Float64Array(B * nHead * T * T);
  for (let b = 0; b < B; b++)
    for (let h = 0; h < nHead; h++)
      for (let t = 0; t < T; t++) {
        const qo = (b * T + t) * 3 * C + h * hs;
        const ao = ((b * nHead + h) * T + t) * T;
        let max = -Infinity;
        for (let s = 0; s <= t; s++) {
          const ko = (b * T + s) * 3 * C + C + h * hs;
          let dot = 0;
          for (let d = 0; d < hs; d++) dot += Q[qo + d] * Q[ko + d];
          att[ao + s] = dot * scale;
          if (att[ao + s] > max) max = att[ao + s];
        }
        let sum = 0;
        for (let s = 0; s <= t; s++) {
          att[ao + s] = Math.exp(att[ao + s] - max);
          sum += att[ao + s];
        }
        const oo = (b * T + t) * C + h * hs;
        for (let s = 0; s <= t; s++) {
          att[ao + s] /= sum;
          const vo = (b * T + s) * 3 * C + 2 * C + h * hs;
          for (let d = 0; d < hs; d++) out.data[oo + d] += att[ao + s] * Q[vo + d];
        }
      }
  tape.push(() => {
    if (!out.grad) return;
    const G = out.grad;
    const QG = qkv.g();
    const da = new Float64Array(T);
    for (let b = 0; b < B; b++)
      for (let h = 0; h < nHead; h++)
        for (let t = 0; t < T; t++) {
          const qo = (b * T + t) * 3 * C + h * hs;
          const ao = ((b * nHead + h) * T + t) * T;
          const oo = (b * T + t) * C + h * hs;
          let dot = 0;
          for (let s = 0; s <= t; s++) {
            const vo = (b * T + s) * 3 * C + 2 * C + h * hs;
            let d1 = 0;
            for (let d = 0; d < hs; d++) {
              d1 += G[oo + d] * Q[vo + d];
              QG[vo + d] += att[ao + s] * G[oo + d];
            }
            da[s] = d1;
            dot += d1 * att[ao + s];
          }
          for (let s = 0; s <= t; s++) {
            const ds = att[ao + s] * (da[s] - dot) * scale;
            const ko = (b * T + s) * 3 * C + C + h * hs;
            for (let d = 0; d < hs; d++) {
              QG[qo + d] += ds * Q[ko + d];
              QG[ko + d] += ds * Q[qo + d];
            }
          }
        }
  });
  return out;
}

/** Mean cross-entropy of logits (n x V) against target ids: a 1 x 1 tensor. */
export function crossEntropy(logits, targets) {
  const n = logits.rows;
  const V = logits.cols;
  const probs = new Float64Array(n * V);
  let total = 0;
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    for (let j = 0; j < V; j++) if (logits.data[i * V + j] > max) max = logits.data[i * V + j];
    let sum = 0;
    for (let j = 0; j < V; j++) {
      probs[i * V + j] = Math.exp(logits.data[i * V + j] - max);
      sum += probs[i * V + j];
    }
    for (let j = 0; j < V; j++) probs[i * V + j] /= sum;
    total -= Math.log(probs[i * V + targets[i]]);
  }
  const out = tensor(1, 1);
  out.data[0] = total / n;
  tape.push(() => {
    const lg = logits.g();
    const s = out.grad[0] / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < V; j++) lg[i * V + j] += s * probs[i * V + j];
      lg[i * V + targets[i]] -= s;
    }
  });
  return out;
}

// --------------------------------------------------------------------- model

function param(model, name, rows, cols, init, r) {
  const t = tensor(rows, cols);
  if (init === 'ones') t.data.fill(1);
  else if (typeof init === 'number') for (let i = 0; i < t.data.length; i++) t.data[i] = randn(r) * init;
  model.params[name] = t;
  return t;
}

/**
 * A decoder-only transformer. cfg: { vocabSize, blockSize, dModel, nHead,
 * nLayer, seed }. Pre-norm blocks: x + attn(ln1(x)), then x + mlp(ln2(x)).
 */
export function createGPT(cfg) {
  const { vocabSize: V, blockSize, dModel: C, nHead, nLayer } = cfg;
  if (C % nHead !== 0) throw new Error('dModel must be a multiple of nHead');
  const r = rng(cfg.seed ?? 1);
  const model = { cfg: { ...cfg }, params: {} };
  const s = 0.02;
  const sOut = 0.02 / Math.sqrt(2 * nLayer);
  param(model, 'wte', V, C, s, r);
  param(model, 'wpe', blockSize, C, s, r);
  for (let l = 0; l < nLayer; l++) {
    param(model, 'h' + l + '.ln1.g', 1, C, 'ones', r);
    param(model, 'h' + l + '.ln1.b', 1, C, 'zeros', r);
    param(model, 'h' + l + '.attn.w', C, 3 * C, s, r);
    param(model, 'h' + l + '.attn.b', 1, 3 * C, 'zeros', r);
    param(model, 'h' + l + '.proj.w', C, C, sOut, r);
    param(model, 'h' + l + '.proj.b', 1, C, 'zeros', r);
    param(model, 'h' + l + '.ln2.g', 1, C, 'ones', r);
    param(model, 'h' + l + '.ln2.b', 1, C, 'zeros', r);
    param(model, 'h' + l + '.fc.w', C, 4 * C, s, r);
    param(model, 'h' + l + '.fc.b', 1, 4 * C, 'zeros', r);
    param(model, 'h' + l + '.out.w', 4 * C, C, sOut, r);
    param(model, 'h' + l + '.out.b', 1, C, 'zeros', r);
  }
  param(model, 'lnf.g', 1, C, 'ones', r);
  param(model, 'lnf.b', 1, C, 'zeros', r);
  param(model, 'head.w', C, V, s, r);
  return model;
}

/** How many numbers the model learns. */
export function numParams(model) {
  let n = 0;
  for (const k in model.params) n += model.params[k].data.length;
  return n;
}

/**
 * Forward pass on B sequences of T token ids (x, flattened). With targets
 * (y, same shape) also returns the mean cross-entropy loss.
 */
export function gptForward(model, x, B, T, y) {
  const p = model.params;
  const { nHead, nLayer } = model.cfg;
  if (T > model.cfg.blockSize) throw new Error('sequence longer than blockSize');
  let h = add(embed(p.wte, x), embedPositions(p.wpe, B, T));
  for (let l = 0; l < nLayer; l++) {
    const a = layerNorm(h, p['h' + l + '.ln1.g'], p['h' + l + '.ln1.b']);
    const att = causalSelfAttention(linear(a, p['h' + l + '.attn.w'], p['h' + l + '.attn.b']), B, T, nHead);
    h = add(h, linear(att, p['h' + l + '.proj.w'], p['h' + l + '.proj.b']));
    const m = layerNorm(h, p['h' + l + '.ln2.g'], p['h' + l + '.ln2.b']);
    h = add(h, linear(gelu(linear(m, p['h' + l + '.fc.w'], p['h' + l + '.fc.b'])), p['h' + l + '.out.w'], p['h' + l + '.out.b']));
  }
  const logits = linear(layerNorm(h, p['lnf.g'], p['lnf.b']), p['head.w'], null);
  if (!y) return { logits };
  return { logits, loss: crossEntropy(logits, y) };
}

/** Set every parameter's gradient to zero. */
export function zeroGrad(model) {
  for (const k in model.params) if (model.params[k].grad) model.params[k].grad.fill(0);
}

/** Adam state for a model's parameters (only names, when given: the rest stay frozen). */
export function createAdam(model, opts = {}) {
  const names = opts.names || Object.keys(model.params);
  const state = {};
  for (const k of names) {
    const n = model.params[k].data.length;
    state[k] = { m: new Float64Array(n), v: new Float64Array(n) };
  }
  return { names, state, t: 0, beta1: opts.beta1 ?? 0.9, beta2: opts.beta2 ?? 0.99, eps: 1e-8 };
}

/** One Adam step with learning rate lr. */
export function adamStep(model, opt, lr) {
  opt.t++;
  const c1 = 1 - opt.beta1 ** opt.t;
  const c2 = 1 - opt.beta2 ** opt.t;
  for (const k of opt.names) {
    const p = model.params[k];
    if (!p.grad) continue;
    const { m, v } = opt.state[k];
    for (let i = 0; i < p.data.length; i++) {
      const g = p.grad[i];
      m[i] = opt.beta1 * m[i] + (1 - opt.beta1) * g;
      v[i] = opt.beta2 * v[i] + (1 - opt.beta2) * g * g;
      p.data[i] -= (lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + opt.eps);
    }
  }
}

/** Logits (a plain array) for the token that follows ids (cropped to blockSize). */
export function nextLogits(model, ids) {
  const ctx = ids.slice(-model.cfg.blockSize);
  const { logits } = gptForward(model, ctx, 1, ctx.length);
  clearTape();
  return Array.from(logits.data.subarray((ctx.length - 1) * logits.cols));
}

/** A deep copy of a model (for fine-tuning without touching the original). */
export function cloneModel(model) {
  const copy = { cfg: { ...model.cfg }, params: {} };
  for (const k in model.params) {
    const p = model.params[k];
    copy.params[k] = tensor(p.rows, p.cols, Float64Array.from(p.data));
  }
  return copy;
}

// ---------------------------------------------------------------------- text

/** The sorted distinct characters of a text. */
export function charVocab(text) {
  return [...new Set(text)].sort();
}

/** Characters to ids, with a vocabulary from charVocab. */
export function encodeChars(vocab, text) {
  const index = new Map(vocab.map((c, i) => [c, i]));
  return Array.from(text, (c) => {
    const i = index.get(c);
    if (i === undefined) throw new Error('character not in vocabulary: ' + JSON.stringify(c));
    return i;
  });
}

/** Ids back to text. */
export function decodeChars(vocab, ids) {
  return ids.map((i) => vocab[i]).join('');
}

/** B random windows of T+1 tokens from ids: inputs x and targets y (shifted by one), flattened. */
export function randomBatch(ids, B, T, r) {
  const x = [];
  const y = [];
  for (let b = 0; b < B; b++) {
    const s = Math.floor(r() * (ids.length - T - 1));
    for (let t = 0; t < T; t++) {
      x.push(ids[s + t]);
      y.push(ids[s + t + 1]);
    }
  }
  return { x, y };
}

/**
 * Mean loss over batches fixed, evenly spaced windows of ids (no gradients):
 * the same windows every call, so two models compare fairly.
 */
export function evalLoss(model, ids, T, batches = 8, B = 8) {
  let total = 0;
  const n = batches * B;
  const stride = Math.max(1, Math.floor((ids.length - T - 1) / n));
  for (let k = 0; k < batches; k++) {
    const x = [];
    const y = [];
    for (let b = 0; b < B; b++) {
      const s = ((k * B + b) * stride) % (ids.length - T - 1);
      for (let t = 0; t < T; t++) {
        x.push(ids[s + t]);
        y.push(ids[s + t + 1]);
      }
    }
    total += gptForward(model, x, B, T, y).loss.item();
    clearTape();
  }
  return total / batches;
}
`;
