import type { Level } from '@build-a-computer/schema';

/**
 * Reference solutions (main.js) for the Track 2 levels of phases 4 to 7.
 * Library files (gpt.js) and datasets come from the level. Loaded by the
 * game only on "Show solution" (ADR-007); CI runs each one through
 * runJsTest (src/track2/phase4-7/phase4-7.test.ts).
 */
export const TRACK2_P4_7_SOLUTIONS: Record<string, string> = {
  'char-tokenizer': String.raw`// Character tokenizer: every distinct character gets an id.

export function buildVocab(text) {
  return [...new Set(text)].sort();
}

export function encode(vocab, text) {
  const index = new Map(vocab.map((c, i) => [c, i]));
  return Array.from(text, (c) => {
    if (!index.has(c)) throw new Error('unknown character: ' + JSON.stringify(c));
    return index.get(c);
  });
}

export function decode(vocab, ids) {
  return ids.map((i) => vocab[i]).join('');
}
`,
  'bpe-tokenizer': String.raw`// Byte-pair encoding: start from character codes, merge the most frequent pair again and again.

function countPairs(ids) {
  const counts = new Map();
  for (let i = 0; i + 1 < ids.length; i++) {
    const key = ids[i] + ',' + ids[i + 1];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function mergePair(ids, a, b, id) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    if (i + 1 < ids.length && ids[i] === a && ids[i + 1] === b) {
      out.push(id);
      i++;
    } else {
      out.push(ids[i]);
    }
  }
  return out;
}

export function trainBpe(text, numMerges) {
  let ids = Array.from(text, (c) => c.charCodeAt(0));
  const merges = [];
  for (let m = 0; m < numMerges; m++) {
    const counts = countPairs(ids);
    let best = null;
    let bestCount = 1;
    // A Map keeps insertion order: the first pair seen wins a tie.
    for (const [key, n] of counts) {
      if (n > bestCount) {
        best = key;
        bestCount = n;
      }
    }
    if (best === null) break;
    const [a, b] = best.split(',').map(Number);
    merges.push([a, b]);
    ids = mergePair(ids, a, b, 256 + m);
  }
  return merges;
}

export function encodeBpe(text, merges) {
  let ids = Array.from(text, (c) => c.charCodeAt(0));
  merges.forEach(([a, b], m) => {
    ids = mergePair(ids, a, b, 256 + m);
  });
  return ids;
}

export function decodeBpe(ids, merges) {
  const expand = (id) => (id < 256 ? String.fromCharCode(id) : expand(merges[id - 256][0]) + expand(merges[id - 256][1]));
  return ids.map(expand).join('');
}
`,
  'token-embeddings': String.raw`// Embeddings: a table with one learned vector per token id.

export function embed(table, ids) {
  return ids.map((id) => table[id].slice());
}

export function embedBackward(ids, dOut, vocabSize) {
  const dim = dOut.length > 0 ? dOut[0].length : 0;
  const dTable = Array.from({ length: vocabSize }, () => new Array(dim).fill(0));
  ids.forEach((id, row) => {
    for (let j = 0; j < dim; j++) dTable[id][j] += dOut[row][j];
  });
  return dTable;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}
`,
  'bigram-lm': String.raw`// Bigram language model: predict the next character from the current one by counting.
import { load } from 'data';

export function countBigrams(ids, vocabSize) {
  const counts = Array.from({ length: vocabSize }, () => new Array(vocabSize).fill(0));
  for (let i = 0; i + 1 < ids.length; i++) counts[ids[i]][ids[i + 1]]++;
  return counts;
}

export function bigramProbs(counts, alpha) {
  return counts.map((row) => {
    const total = row.reduce((s, c) => s + c, 0) + alpha * row.length;
    return row.map((c) => (c + alpha) / total);
  });
}

export function meanNll(probs, ids) {
  let sum = 0;
  for (let i = 0; i + 1 < ids.length; i++) sum -= Math.log(probs[ids[i]][ids[i + 1]]);
  return sum / (ids.length - 1);
}

export async function macbethBigram(alpha) {
  const text = await load('text-macbeth');
  const vocab = [...new Set(text)].sort();
  const index = new Map(vocab.map((c, i) => [c, i]));
  const ids = Array.from(text, (c) => index.get(c));
  const n = Math.floor(ids.length * 0.9);
  const probs = bigramProbs(countBigrams(ids.slice(0, n), vocab.length), alpha);
  return { trainLoss: meanNll(probs, ids.slice(0, n)), valLoss: meanNll(probs, ids.slice(n)) };
}
`,
  'positional-encoding': String.raw`// Sinusoidal positional encoding (Attention Is All You Need, section 3.5).

export function positionalEncoding(T, d) {
  const pe = [];
  for (let pos = 0; pos < T; pos++) {
    const row = new Array(d);
    for (let i = 0; i < d; i += 2) {
      const angle = pos / Math.pow(10000, i / d);
      row[i] = Math.sin(angle);
      if (i + 1 < d) row[i + 1] = Math.cos(angle);
    }
    pe.push(row);
  }
  return pe;
}

export function addPositions(x) {
  const pe = positionalEncoding(x.length, x.length > 0 ? x[0].length : 0);
  return x.map((row, t) => row.map((v, j) => v + pe[t][j]));
}
`,
  'self-attention': String.raw`// Scaled dot-product self-attention.

export function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

export function transpose(A) {
  return A[0].map((_, j) => A.map((row) => row[j]));
}

export function softmaxRows(S) {
  return S.map((row) => {
    const max = Math.max(...row);
    const e = row.map((v) => Math.exp(v - max));
    const sum = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / sum);
  });
}

export function attention(Q, K, V) {
  const scale = 1 / Math.sqrt(K[0].length);
  const scores = matmul(Q, transpose(K)).map((row) => row.map((s) => s * scale));
  return matmul(softmaxRows(scores), V);
}

export function selfAttention(x, Wq, Wk, Wv) {
  return attention(matmul(x, Wq), matmul(x, Wk), matmul(x, Wv));
}
`,
  'causal-mask': String.raw`// Causal attention: position t may only look at positions 0..t.

function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

export function causalWeights(Q, K) {
  const scale = 1 / Math.sqrt(K[0].length);
  return Q.map((q, t) => {
    const scores = K.map((k, s) => (s <= t ? q.reduce((acc, v, d) => acc + v * k[d], 0) * scale : -Infinity));
    const max = Math.max(...scores);
    const e = scores.map((v) => Math.exp(v - max));
    const sum = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / sum);
  });
}

export function causalAttention(Q, K, V) {
  return matmul(causalWeights(Q, K), V);
}
`,
  'multi-head-attention': String.raw`// Multi-head causal self-attention: several small attentions side by side.

function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

function causalAttention(Q, K, V) {
  const scale = 1 / Math.sqrt(K[0].length);
  const W = Q.map((q, t) => {
    const scores = K.map((k, s) => (s <= t ? q.reduce((acc, v, d) => acc + v * k[d], 0) * scale : -Infinity));
    const max = Math.max(...scores);
    const e = scores.map((v) => Math.exp(v - max));
    const sum = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / sum);
  });
  return matmul(W, V);
}

export function splitHeads(X, nHead) {
  const hs = X[0].length / nHead;
  const heads = [];
  for (let h = 0; h < nHead; h++) heads.push(X.map((row) => row.slice(h * hs, (h + 1) * hs)));
  return heads;
}

export function multiHeadAttention(x, Wq, Wk, Wv, Wo, nHead) {
  const Q = splitHeads(matmul(x, Wq), nHead);
  const K = splitHeads(matmul(x, Wk), nHead);
  const V = splitHeads(matmul(x, Wv), nHead);
  const heads = Q.map((q, h) => causalAttention(q, K[h], V[h]));
  const joined = x.map((_, t) => heads.flatMap((head) => head[t]));
  return matmul(joined, Wo);
}
`,
  'layer-norm-residual': String.raw`// Layer norm, a GELU MLP and a residual connection around them.

function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

export function layerNorm(x, gamma, beta, eps = 1e-5) {
  return x.map((row) => {
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    const variance = row.reduce((a, b) => a + (b - mean) ** 2, 0) / row.length;
    const inv = 1 / Math.sqrt(variance + eps);
    return row.map((v, j) => (v - mean) * inv * gamma[j] + beta[j]);
  });
}

export function gelu(v) {
  return 0.5 * v * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (v + 0.044715 * v ** 3)));
}

export function mlp(x, W1, b1, W2, b2) {
  const h = matmul(x, W1).map((row) => row.map((v, j) => gelu(v + b1[j])));
  return matmul(h, W2).map((row) => row.map((v, j) => v + b2[j]));
}

export function residualMlp(x, p) {
  const y = mlp(layerNorm(x, p.gamma, p.beta), p.W1, p.b1, p.W2, p.b2);
  return x.map((row, t) => row.map((v, j) => v + y[t][j]));
}
`,
  'transformer-block': String.raw`// A full pre-norm transformer block: x + attention(ln1(x)), then + mlp(ln2(.)).

function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

function add(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function layerNorm(x, gamma, beta, eps = 1e-5) {
  return x.map((row) => {
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    const variance = row.reduce((a, b) => a + (b - mean) ** 2, 0) / row.length;
    const inv = 1 / Math.sqrt(variance + eps);
    return row.map((v, j) => (v - mean) * inv * gamma[j] + beta[j]);
  });
}

function gelu(v) {
  return 0.5 * v * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (v + 0.044715 * v ** 3)));
}

function causalAttention(Q, K, V) {
  const scale = 1 / Math.sqrt(K[0].length);
  const W = Q.map((q, t) => {
    const scores = K.map((k, s) => (s <= t ? q.reduce((acc, v, d) => acc + v * k[d], 0) * scale : -Infinity));
    const max = Math.max(...scores);
    const e = scores.map((v) => Math.exp(v - max));
    const sum = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / sum);
  });
  return matmul(W, V);
}

function multiHeadAttention(x, p, nHead) {
  const hs = p.Wq[0].length / nHead;
  const Q = matmul(x, p.Wq);
  const K = matmul(x, p.Wk);
  const V = matmul(x, p.Wv);
  const cols = (X, h) => X.map((row) => row.slice(h * hs, (h + 1) * hs));
  const heads = [];
  for (let h = 0; h < nHead; h++) heads.push(causalAttention(cols(Q, h), cols(K, h), cols(V, h)));
  return matmul(x.map((_, t) => heads.flatMap((head) => head[t])), p.Wo);
}

function mlp(x, p) {
  const h = matmul(x, p.W1).map((row) => row.map((v, j) => gelu(v + p.b1[j])));
  return matmul(h, p.W2).map((row) => row.map((v, j) => v + p.b2[j]));
}

export function transformerBlock(x, p, nHead) {
  const h = add(x, multiHeadAttention(layerNorm(x, p.ln1.gamma, p.ln1.beta), p, nHead));
  return add(h, mlp(layerNorm(h, p.ln2.gamma, p.ln2.beta), p));
}

export function transformer(x, blocks, nHead) {
  return blocks.reduce((h, p) => transformerBlock(h, p, nHead), x);
}
`,
  'batching-pipeline': String.raw`// The data pipeline: split the token ids, cut them into windows, stack windows into batches.

export function splitData(ids, frac) {
  const n = Math.floor(ids.length * frac);
  return { train: ids.slice(0, n), val: ids.slice(n) };
}

export function makeBatch(ids, starts, T) {
  return {
    x: starts.map((s) => ids.slice(s, s + T)),
    y: starts.map((s) => ids.slice(s + 1, s + T + 1)),
  };
}

export function windowStarts(length, T) {
  const starts = [];
  for (let s = 0; s + T + 1 <= length; s += T) starts.push(s);
  return starts;
}
`,
  'train-tiny-gpt': String.raw`// Train a tiny GPT on Macbeth, one character at a time.
import { load } from 'data';
import { adamStep, backward, charVocab, createAdam, createGPT, encodeChars, evalLoss, gptForward, numParams, randomBatch, rng, zeroGrad } from './gpt.js';

const T = 32; // context length
const B = 8; // sequences per batch

export async function train(steps) {
  const text = await load('text-macbeth');
  const vocab = charVocab(text);
  const ids = encodeChars(vocab, text);
  const n = Math.floor(ids.length * 0.9);
  const trainIds = ids.slice(0, n);
  const valIds = ids.slice(n);

  const model = createGPT({ vocabSize: vocab.length, blockSize: T, dModel: 32, nHead: 4, nLayer: 1, seed: 1 });
  const opt = createAdam(model);
  const r = rng(1);
  for (let step = 0; step < steps; step++) {
    const { x, y } = randomBatch(trainIds, B, T, r);
    const { loss } = gptForward(model, x, B, T, y);
    zeroGrad(model);
    backward(loss);
    adamStep(model, opt, 0.01);
  }
  return { params: numParams(model), trainLoss: evalLoss(model, trainIds, T), valLoss: evalLoss(model, valIds, T) };
}
`,
  'loss-perplexity': String.raw`// Loss curves and perplexity.
import { load } from 'data';
import { adamStep, backward, charVocab, createAdam, createGPT, encodeChars, evalLoss, gptForward, randomBatch, rng, zeroGrad } from './gpt.js';

export function perplexity(meanLoss) {
  return Math.exp(meanLoss);
}

export function smoothCurve(values, beta) {
  let m = 0;
  return values.map((v, i) => {
    m = beta * m + (1 - beta) * v;
    return m / (1 - Math.pow(beta, i + 1));
  });
}

export async function trainWithCurve(steps) {
  const T = 32;
  const B = 8;
  const text = await load('text-macbeth');
  const vocab = charVocab(text);
  const ids = encodeChars(vocab, text);
  const n = Math.floor(ids.length * 0.9);
  const model = createGPT({ vocabSize: vocab.length, blockSize: T, dModel: 32, nHead: 4, nLayer: 1, seed: 1 });
  const opt = createAdam(model);
  const r = rng(2);
  const losses = [];
  for (let step = 0; step < steps; step++) {
    const { x, y } = randomBatch(ids.slice(0, n), B, T, r);
    const { loss } = gptForward(model, x, B, T, y);
    losses.push(loss.item());
    zeroGrad(model);
    backward(loss);
    adamStep(model, opt, 0.01);
  }
  const smooth = smoothCurve(losses, 0.9);
  const valLoss = evalLoss(model, ids.slice(n), T);
  return {
    start: smooth[0],
    end: smooth[smooth.length - 1],
    drop: smooth[0] - smooth[smooth.length - 1],
    valLoss,
    valPerplexity: perplexity(valLoss),
  };
}
`,
  'sampling': String.raw`// Turning logits into a next token: greedy, temperature, top-k and top-p.

export function softmax(logits, temperature) {
  const scaled = logits.map((v) => v / temperature);
  const max = Math.max(...scaled);
  const e = scaled.map((v) => Math.exp(v - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

export function sampleNext(logits, opts, u) {
  const temperature = opts.temperature ?? 1;
  if (temperature === 0) {
    let best = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
    return best;
  }
  const probs = softmax(logits, temperature);
  let order = probs.map((p, i) => i).sort((a, b) => probs[b] - probs[a] || a - b);
  if (opts.topK) order = order.slice(0, opts.topK);
  if (opts.topP) {
    const total = order.reduce((s, i) => s + probs[i], 0);
    let cum = 0;
    let keep = 0;
    while (keep < order.length) {
      cum += probs[order[keep]] / total;
      keep++;
      if (cum >= opts.topP) break;
    }
    order = order.slice(0, keep);
  }
  const total = order.reduce((s, i) => s + probs[i], 0);
  let cum = 0;
  for (const i of order) {
    cum += probs[i] / total;
    if (u < cum) return i;
  }
  return order[order.length - 1];
}

// Provided: one token for each u (the tests call this with many values of u).
export function sampleMany(logits, opts, us) {
  return us.map((u) => sampleNext(logits, opts, u));
}
`,
  'fine-tuning': String.raw`// Fine-tuning: pretrain on Macbeth, then keep training on the Sonnets with a smaller learning rate.
import { load } from 'data';
import { adamStep, backward, charVocab, cloneModel, createAdam, createGPT, encodeChars, evalLoss, gptForward, randomBatch, rng, zeroGrad } from './gpt.js';

const T = 32;
const B = 8;

function trainSteps(model, ids, steps, lr, r) {
  const opt = createAdam(model);
  for (let step = 0; step < steps; step++) {
    const { x, y } = randomBatch(ids, B, T, r);
    const { loss } = gptForward(model, x, B, T, y);
    zeroGrad(model);
    backward(loss);
    adamStep(model, opt, lr);
  }
}

export async function finetune(preSteps, ftSteps) {
  const macbeth = await load('text-macbeth');
  const vocab = charVocab(macbeth);
  const split = (text) => {
    const ids = encodeChars(vocab, text);
    const n = Math.floor(ids.length * 0.9);
    return [ids.slice(0, n), ids.slice(n)];
  };
  const [macTrain, macVal] = split(macbeth);
  const [sonTrain, sonVal] = split(await load('text-sonnets'));
  const r = rng(1);

  const base = createGPT({ vocabSize: vocab.length, blockSize: T, dModel: 32, nHead: 4, nLayer: 1, seed: 1 });
  trainSteps(base, macTrain, preSteps, 0.01, r);
  const before = evalLoss(base, sonVal, T);
  const macbethBefore = evalLoss(base, macVal, T);

  const tuned = cloneModel(base);
  trainSteps(tuned, sonTrain, ftSteps, 0.003, r);
  const after = evalLoss(tuned, sonVal, T);
  return { before, after, gain: before - after, macbethBefore, macbethAfter: evalLoss(tuned, macVal, T) };
}
`,
  'lora': String.raw`// LoRA: freeze the pretrained table W0 and learn a low-rank change scale * A B.
import { load } from 'data';
import { rng } from './gpt.js';

export function loraRow(W0, A, B, scale, x) {
  const row = W0[x].slice();
  for (let k = 0; k < B.length; k++) {
    const a = scale * A[x][k];
    for (let j = 0; j < row.length; j++) row[j] += a * B[k][j];
  }
  return row;
}

export function loraBackward(A, B, scale, x, dRow) {
  const dAx = B.map((bk) => scale * bk.reduce((s, v, j) => s + v * dRow[j], 0));
  const dB = B.map((_, k) => dRow.map((d) => scale * A[x][k] * d));
  return { dAx, dB };
}

function counts(ids, V) {
  const C = Array.from({ length: V }, () => new Array(V).fill(0));
  for (let i = 0; i + 1 < ids.length; i++) C[ids[i]][ids[i + 1]]++;
  return C;
}

// Mean cross-entropy over all bigrams, grouped by the previous character, and its gradient per row.
function lossAndGrads(rowOf, C, V, wantGrads) {
  let total = 0;
  let n = 0;
  const grads = [];
  for (let i = 0; i < V; i++) {
    const ni = C[i].reduce((a, b) => a + b, 0);
    n += ni;
    if (ni === 0) {
      grads.push(null);
      continue;
    }
    const logits = rowOf(i);
    const max = Math.max(...logits);
    const e = logits.map((v) => Math.exp(v - max));
    const sum = e.reduce((a, b) => a + b, 0);
    const lse = max + Math.log(sum);
    for (let j = 0; j < V; j++) total += C[i][j] * (lse - logits[j]);
    if (wantGrads) grads.push(e.map((v, j) => (ni * v) / sum - C[i][j]));
  }
  return { loss: total / n, grads: grads.map((g) => g && g.map((v) => v / n)) };
}

export async function finetuneLora(rank, steps) {
  const macbeth = await load('text-macbeth');
  const vocab = [...new Set(macbeth)].sort();
  const index = new Map(vocab.map((c, i) => [c, i]));
  const V = vocab.length;
  const enc = (t) => Array.from(t, (c) => index.get(c));
  const sonnets = enc(await load('text-sonnets'));
  const n = Math.floor(sonnets.length * 0.9);
  const Ctrain = counts(sonnets.slice(0, n), V);
  const Cval = counts(sonnets.slice(n), V);

  // The "pretrained" model: smoothed bigram log-probabilities of Macbeth. Frozen.
  const W0 = counts(enc(macbeth), V).map((row) => {
    const total = row.reduce((a, b) => a + b, 0) + V;
    return row.map((c) => Math.log((c + 1) / total));
  });

  // Adapters: A small and random, B zero, so training starts exactly at W0.
  const r = rng(7);
  const rand = () => r() - 0.5;
  const A = Array.from({ length: V }, () => Array.from({ length: rank }, () => rand() * 0.2));
  const B = Array.from({ length: rank }, () => new Array(V).fill(0));
  const scale = 1;
  const rowOf = (i) => loraRow(W0, A, B, scale, i);
  const before = lossAndGrads(rowOf, Cval, V, false).loss;

  // Adam on A and B only.
  const params = [...A, ...B];
  const m = params.map((p) => new Array(p.length).fill(0));
  const v = params.map((p) => new Array(p.length).fill(0));
  const lr = 0.02;
  for (let t = 1; t <= steps; t++) {
    const { grads } = lossAndGrads(rowOf, Ctrain, V, true);
    const gA = A.map(() => new Array(rank).fill(0));
    const gB = B.map(() => new Array(V).fill(0));
    for (let i = 0; i < V; i++) {
      if (!grads[i]) continue;
      const { dAx, dB } = loraBackward(A, B, scale, i, grads[i]);
      gA[i] = dAx;
      for (let k = 0; k < rank; k++) for (let j = 0; j < V; j++) gB[k][j] += dB[k][j];
    }
    const g = [...gA, ...gB];
    params.forEach((p, pi) => {
      for (let q = 0; q < p.length; q++) {
        m[pi][q] = 0.9 * m[pi][q] + 0.1 * g[pi][q];
        v[pi][q] = 0.999 * v[pi][q] + 0.001 * g[pi][q] ** 2;
        p[q] -= (lr * m[pi][q]) / (1 - 0.9 ** t) / (Math.sqrt(v[pi][q] / (1 - 0.999 ** t)) + 1e-8);
      }
    });
  }
  const after = lossAndGrads(rowOf, Cval, V, false).loss;
  return { trainable: 2 * V * rank, full: V * V, before, after, gain: before - after };
}
`,
  'preference-model': String.raw`// A toy reward model trained on preference pairs (Bradley-Terry loss).

export function reward(w, features) {
  return w.reduce((s, wi, i) => s + wi * features[i], 0);
}

// -log(sigmoid(d)) = log(1 + exp(-d)), written so that it never overflows.
function softplusNeg(d) {
  return d > 0 ? Math.log1p(Math.exp(-d)) : -d + Math.log1p(Math.exp(d));
}

export function pairLoss(w, chosen, rejected) {
  return softplusNeg(reward(w, chosen) - reward(w, rejected));
}

export function trainRewardModel(pairs, steps, lr) {
  const dim = pairs[0].chosen.length;
  const w = new Array(dim).fill(0);
  for (let step = 0; step < steps; step++) {
    const grad = new Array(dim).fill(0);
    for (const { chosen, rejected } of pairs) {
      const d = reward(w, chosen) - reward(w, rejected);
      const g = -1 / (1 + Math.exp(d)); // d/dd of -log(sigmoid(d))
      for (let i = 0; i < dim; i++) grad[i] += (g * (chosen[i] - rejected[i])) / pairs.length;
    }
    for (let i = 0; i < dim; i++) w[i] -= lr * grad[i];
  }
  return w;
}

export function evaluateRewardModel(trainPairs, testPairs, steps, lr) {
  const w = trainRewardModel(trainPairs, steps, lr);
  let correct = 0;
  let loss = 0;
  for (const { chosen, rejected } of testPairs) {
    if (reward(w, chosen) > reward(w, rejected)) correct++;
    loss += pairLoss(w, chosen, rejected);
  }
  return { accuracy: correct / testPairs.length, testLoss: loss / testPairs.length };
}
`,
  'scaling-experiment': String.raw`// A scaling experiment: the same model at several sizes, loss against parameter count.
import { load } from 'data';
import { rng } from './gpt.js';

export function fitPowerLaw(ns, losses) {
  const xs = ns.map(Math.log);
  const ys = losses.map(Math.log);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

function counts(ids, V) {
  const C = Array.from({ length: V }, () => new Array(V).fill(0));
  for (let i = 0; i + 1 < ids.length; i++) C[ids[i]][ids[i + 1]]++;
  return C;
}

// A factorized bigram model of width d: logits(prev) = E[prev] U + b.
function trainModel(d, Ctrain, Cval, V, steps) {
  const r = rng(11 + d);
  const rand = () => r() - 0.5;
  const E = Array.from({ length: V }, () => Array.from({ length: d }, () => rand() * 0.2));
  const U = Array.from({ length: d }, () => Array.from({ length: V }, () => rand() * 0.2));
  const b = new Array(V).fill(0);
  const rowOf = (i) => {
    const row = b.slice();
    for (let k = 0; k < d; k++) for (let j = 0; j < V; j++) row[j] += E[i][k] * U[k][j];
    return row;
  };
  const loss = (C, grads) => {
    let total = 0;
    let n = 0;
    for (let i = 0; i < V; i++) n += C[i].reduce((a, c) => a + c, 0);
    for (let i = 0; i < V; i++) {
      const ni = C[i].reduce((a, c) => a + c, 0);
      if (ni === 0) continue;
      const l = rowOf(i);
      const max = Math.max(...l);
      const e = l.map((v) => Math.exp(v - max));
      const sum = e.reduce((a, c) => a + c, 0);
      const lse = max + Math.log(sum);
      for (let j = 0; j < V; j++) total += C[i][j] * (lse - l[j]);
      if (!grads) continue;
      for (let j = 0; j < V; j++) {
        const g = ((ni * e[j]) / sum - C[i][j]) / n;
        grads.b[j] += g;
        for (let k = 0; k < d; k++) {
          grads.E[i][k] += g * U[k][j];
          grads.U[k][j] += E[i][k] * g;
        }
      }
    }
    return total / n;
  };
  const params = [...E, ...U, b];
  const m = params.map((p) => new Array(p.length).fill(0));
  const v = params.map((p) => new Array(p.length).fill(0));
  for (let t = 1; t <= steps; t++) {
    const grads = { E: E.map(() => new Array(d).fill(0)), U: U.map(() => new Array(V).fill(0)), b: new Array(V).fill(0) };
    loss(Ctrain, grads);
    const g = [...grads.E, ...grads.U, grads.b];
    params.forEach((p, pi) => {
      for (let q = 0; q < p.length; q++) {
        m[pi][q] = 0.9 * m[pi][q] + 0.1 * g[pi][q];
        v[pi][q] = 0.999 * v[pi][q] + 0.001 * g[pi][q] ** 2;
        p[q] -= (0.05 * m[pi][q]) / (1 - 0.9 ** t) / (Math.sqrt(v[pi][q] / (1 - 0.999 ** t)) + 1e-8);
      }
    });
  }
  return { params: 2 * V * d + V, valLoss: loss(Cval, null) };
}

export async function scalingRun(widths, steps) {
  const text = await load('text-macbeth');
  const vocab = [...new Set(text)].sort();
  const index = new Map(vocab.map((c, i) => [c, i]));
  const ids = Array.from(text, (c) => index.get(c));
  const V = vocab.length;
  const n = Math.floor(ids.length * 0.9);
  const Ctrain = counts(ids.slice(0, n), V);
  const Cval = counts(ids.slice(n), V);
  const runs = widths.map((d) => trainModel(d, Ctrain, Cval, V, steps));
  const params = runs.map((r) => r.params);
  const losses = runs.map((r) => r.valLoss);
  let worstIncrease = -Infinity;
  for (let i = 1; i < losses.length; i++) worstIncrease = Math.max(worstIncrease, losses[i] - losses[i - 1]);
  return { params, losses, slope: fitPowerLaw(params, losses).b, worstIncrease };
}
`,
};

/** The reference main.js for a level of phases 4 to 7, or undefined. */
export const track2P4_7Source = (level: Level): string | undefined =>
  Object.hasOwn(TRACK2_P4_7_SOLUTIONS, level.id) ? TRACK2_P4_7_SOLUTIONS[level.id] : undefined;
