/**
 * gpt.js, the read-only library of the Phase 6 and 7 levels: a few helpers
 * around the platform's tiny GPT (the `GPT` class of the 'nn' module). The
 * model, its backward pass and the optimizer step run on the GPU when there
 * is one (`model.to('auto')`), else on the CPU (E-ML-01); values come back
 * with `await` (evalLoss, nextLogits, cloneModel are async). Players write
 * the training loop themselves with 'nn' and 'optim'.
 */
export const GPT_JS = String.raw`// gpt.js: provided by the level (read only).
// Helpers around the tiny GPT of the 'nn' module. The model trains on the GPU
// when this computer has one (model.to('auto')), else on the CPU: the same
// code and, with the same seeds, nearly the same numbers either way.
//
//   const model = createGPT({ vocabSize, blockSize: 32, dModel: 32, nHead: 4, nLayer: 1, seed: 1 });
//   const opt = new Adam(model.parameters(), { lr: 0.01 });     from 'optim'
//   const { x, y } = randomBatch(trainIds, 8, 32, r);          x: a [8, 32] tensor of ids, y: the next ids
//   const loss = crossEntropy(model.forward(x), y);            from 'nn'
//   opt.zeroGrad(); loss.backward(); opt.step();
//   await evalLoss(model, valIds, 32)                          values on the GPU are read with await
import { Rng, tensor } from 'tensor';
import { noGrad } from 'autograd';
import { GPT, crossEntropy } from 'nn';

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

/**
 * A decoder-only transformer from the 'nn' module, on the GPU when there is
 * one. cfg: { vocabSize, blockSize, dModel, nHead, nLayer, seed }. The seed
 * fixes the starting weights.
 */
export function createGPT(cfg) {
  const { vocabSize, blockSize, dModel, nHead, nLayer } = cfg;
  const model = new GPT({ vocabSize, blockSize, dModel, nHead, nLayer }, { rng: new Rng(cfg.seed ?? 1) });
  return model.to('auto');
}

/** How many numbers the model learns. */
export function numParams(model) {
  return model.parameterCount();
}

/** A copy of a model (for fine-tuning without touching the original). */
export async function cloneModel(model) {
  const copy = new GPT(model.config, { rng: new Rng(0) });
  copy.loadStateDict(await model.readStateDict());
  return copy.to(model.device === 'cpu' ? 'cpu' : 'auto');
}

/** Windows of T ids starting at starts: x as a [starts.length, T] tensor, y (the next ids) as a flat list. */
function windows(ids, starts, T) {
  const x = [];
  const y = [];
  for (const s of starts)
    for (let t = 0; t < T; t++) {
      x.push(ids[s + t]);
      y.push(ids[s + t + 1]);
    }
  return { x: tensor(x, { shape: [starts.length, T] }), y };
}

/** B random windows of T+1 tokens from ids: inputs x ([B, T] tensor) and targets y (shifted by one, flat). */
export function randomBatch(ids, B, T, r) {
  const starts = [];
  for (let b = 0; b < B; b++) starts.push(Math.floor(r() * (ids.length - T - 1)));
  return windows(ids, starts, T);
}

/**
 * Mean loss over batches * B fixed, evenly spaced windows of ids (no
 * gradients): the same windows every call, so two models compare fairly.
 * Async: on the GPU the value has to be read back.
 */
export async function evalLoss(model, ids, T, batches = 8, B = 8) {
  const n = batches * B;
  const span = ids.length - T - 1;
  const stride = Math.max(1, Math.floor(span / n));
  const starts = [];
  for (let k = 0; k < n; k++) starts.push((k * stride) % span);
  const { x, y } = windows(ids, starts, T);
  const loss = noGrad(() => crossEntropy(model.forward(x), y));
  return loss.itemAsync();
}

/** Logits (a plain array) for the token that follows ids (cropped to blockSize). Async. */
export async function nextLogits(model, ids) {
  const ctx = ids.slice(-model.config.blockSize);
  const logits = noGrad(() => model.forward(tensor(ctx, { shape: [1, ctx.length] })));
  const values = await logits.read();
  const V = model.config.vocabSize;
  return Array.from(values.subarray((ctx.length - 1) * V, ctx.length * V));
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
`;
