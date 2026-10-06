import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../../define';
import { GPT_LIBRARY, MACBETH, MACBETH_VOCAB_SIZE, base, code, eq, jsSetup, metric } from './common';
import { makeBatch, sampleNext, smoothCurve, splitData, uGrid, windowStarts, type SampleOpts } from './models';

/**
 * Track 2, Phase 6 (Tiny GPT): the data pipeline, training a 1-layer GPT
 * (d_model 32, context 32, 4 heads, about 18,000 parameters) on Macbeth with
 * the 'nn' GPT (helpers in the read-only gpt.js), loss curves and perplexity,
 * and sampling. The model trains on the GPU when there is one (E-ML-01),
 * else on the CPU. Training tests are seeded and bound the loss from above
 * with wide margins that hold on both devices (E-ML-02); each one trains for
 * about 10 seconds on a CPU. DRAFT text.
 */

const IDS = Array.from({ length: 20 }, (_, i) => (i * 7) % 11);

const LOGITS = [2, 1.5, 0.3, -1, 1.5, 0.9, -0.2, 3];
const sampleCase = (name: string, opts: SampleOpts, n = 40) =>
  eq(name, 'sampleMany', [LOGITS, opts, uGrid(n)], uGrid(n).map((u) => sampleNext(LOGITS, opts, u)));

/** Steps for the training tests: about 10 seconds of CPU each (well under 1 on a GPU). */
export const TRAIN_STEPS = 300;
export const CURVE_STEPS = 200;

const GPT_USAGE = code(`
import { Adam } from 'optim';
import { crossEntropy } from 'nn';
import { createGPT, rng, randomBatch, evalLoss, charVocab, encodeChars } from './gpt.js';

const model = createGPT({ vocabSize, blockSize: 32, dModel: 32, nHead: 4, nLayer: 1, seed: 1 }); // on the GPU if there is one
const opt = new Adam(model.parameters(), { lr: 0.01 });
const r = rng(1);                                    // seeded: the same run every time
const { x, y } = randomBatch(trainIds, 8, 32, r);    // x: 8 windows of 32 ids (a tensor), y: the next id at each position
const loss = crossEntropy(model.forward(x), y);      // mean cross-entropy, a 1-element tensor
opt.zeroGrad();
loss.backward();
opt.step();
report({ loss });                                    // one point on the loss curve
await evalLoss(model, valIds, 32);                   // mean loss on fixed windows, no training
`);

export const PHASE6: Level[] = [
  defineLevel({
    ...base,
    phase: 6,
    id: 'batching-pipeline',
    order: 1,
    title: 'Batching and data pipeline',
    goal:
      'Export splitData(ids, frac) → { train, val } (the first floor(frac × length) ids train), makeBatch(ids, starts, T) → { x, y } (windows of T ids, y shifted by one), ' +
      'and windowStarts(length, T): the starts 0, T, 2T, ... of every full window (one that has T + 1 ids).',
    tutorial:
      'A language model learns from windows of text. A window of T + 1 tokens gives T training examples at once: the input is the first T tokens and the target at each position is the token after it.\n\n' +
      '```\nids     12 40 7 7 33 51\nx       12 40 7 7 33        (T = 5)\ny       40 7 7 33 51        (the next token at each position)\n```\n\n' +
      'Training uses a batch of B windows from random starting points, so each step sees different text. Two more rules keep the numbers honest:\n\n' +
      '- **Split before anything else.** Hold out the end of the text as validation data and never train on it. Use the end, not random windows, so that no validation window overlaps a training window.\n' +
      '- **Evaluate on full windows.** For a pass over all the data, step through the text T tokens at a time; the last window needs T + 1 tokens, so a short tail is dropped.\n\n' +
      code(`
makeBatch(ids, [0, 5], 3)  // { x: [ids 0-2, ids 5-7], y: [ids 1-3, ids 6-8] }
`),
    hints: [
      'splitData: n = Math.floor(ids.length * frac); train = ids.slice(0, n), val = ids.slice(n).',
      'makeBatch: x = starts.map((s) => ids.slice(s, s + T)); y is the same with s + 1.',
      'windowStarts: for (let s = 0; s + T + 1 <= length; s += T) starts.push(s).',
    ],
    afterword:
      'Real pipelines do the same with billions of tokens: tokenize once, store the ids in a flat file, and cut random windows from it. ' +
      'The gpt.js library you use next has randomBatch, which is makeBatch with random starts and x packed into a [B, T] tensor for the model.',
    js: jsSetup({
      starter: `// The data pipeline.

export function splitData(ids, frac) {
  // TODO
  return { train: [], val: [] };
}

export function makeBatch(ids, starts, T) {
  // TODO
  return { x: [], y: [] };
}

export function windowStarts(length, T) {
  // TODO
  return [];
}
`,
    }),
    tests: [
      eq('splitData 90 / 10', 'splitData', [IDS, 0.9], splitData(IDS, 0.9)),
      eq('splitData rounds down', 'splitData', [[1, 2, 3], 0.5], { train: [1], val: [2, 3] }),
      eq('makeBatch', 'makeBatch', [IDS, [0, 5, 12], 4], makeBatch(IDS, [0, 5, 12], 4)),
      eq('makeBatch: the last window may end at the last id', 'makeBatch', [IDS, [IDS.length - 4], 3], makeBatch(IDS, [IDS.length - 4], 3)),
      eq('windowStarts(20, 4)', 'windowStarts', [20, 4], windowStarts(20, 4)),
      eq('windowStarts(21, 4) adds the window ending at the last id', 'windowStarts', [21, 4], windowStarts(21, 4)),
      eq('windowStarts with too little text', 'windowStarts', [4, 4], []),
    ],
    requires: ['transformer-block'],
  }),
  defineLevel({
    ...base,
    phase: 6,
    id: 'train-tiny-gpt',
    order: 2,
    title: 'Training on public-domain text',
    goal:
      'Train a tiny GPT on Macbeth. Export async train(steps): split 90/10, run `steps` Adam steps on random batches, and return { trainLoss, valLoss } from evalLoss. ' +
      `After ${TRAIN_STEPS} steps the validation loss must be below 2.8 (uniform guessing is ln ${MACBETH_VOCAB_SIZE} ≈ 4.22).`,
    tutorial:
      'Time to train a real transformer. The `GPT` class of the nn module is everything you built in Phase 5 (embeddings, causal multi-head attention, layer norm, MLP, residuals), with a backward pass for each piece. ' +
      'gpt.js (read only, open its tab) adds a few helpers: createGPT builds one with seeded weights, randomBatch cuts windows, evalLoss measures. ' +
      'The model is one block with d_model 32, 4 heads and a context of 32 characters: about 18,000 parameters.\n\n' +
      'The training loop is the one you wrote in Phase 3: batch, forward, zero the gradients, backward, step.\n\n' +
      GPT_USAGE +
      '\n\n**The GPU.** createGPT moves the model to the GPU when this computer has one (`model.to(\'auto\')`; the badge above the training panel shows which device ran). ' +
      'Then every step runs on the GPU and nothing is copied back, so a loss is not a plain number yet: read it with `await loss.itemAsync()` (which is why evalLoss is async and train must be `async`). ' +
      '`report({ loss })` takes the tensor as it is. Without a GPU the same code runs on the CPU.\n\n' +
      'Use a seeded generator (`rng`) for the batches: the same seed gives the same run, which is how the tests can check a training result. ' +
      'A learning rate of 0.01 with batches of 8 windows works well. The loss starts near 4.2 and falls fast at first, then slowly.',
    hints: [
      'Load and encode: const text = await load("text-macbeth"); const vocab = charVocab(text); const ids = encodeChars(vocab, text).',
      'Split: n = Math.floor(ids.length * 0.9); train on ids.slice(0, n), validate on ids.slice(n).',
      'Create the model with vocabSize: vocab.length and blockSize 32 and an Adam over model.parameters(), then loop steps times: randomBatch(trainIds, 8, 32, r) → crossEntropy(model.forward(x), y) → opt.zeroGrad() → loss.backward() → opt.step().',
      'Return { trainLoss: await evalLoss(model, trainIds, 32), valLoss: await evalLoss(model, valIds, 32) }. With 0 steps you get the untrained loss, close to 4.22.',
    ],
    afterword:
      'The same loop, with more layers, wider rows, many GPUs and a few billion more tokens, trains GPT-2. The model now beats the bigram model a little; ' +
      'with more steps and layers it starts to spell words and form lines that look like verse.',
    js: jsSetup({
      datasets: [MACBETH],
      library: [GPT_LIBRARY],
      training: true,
      starter: `// Train a tiny GPT on Macbeth (on the GPU when there is one).
import { load } from 'data';
import { crossEntropy } from 'nn';
import { Adam } from 'optim';
import { charVocab, createGPT, encodeChars, evalLoss, randomBatch, rng } from './gpt.js';

const T = 32; // context length
const B = 8; // windows per batch

export async function train(steps) {
  const text = await load('text-macbeth');
  // TODO: vocabulary, ids, 90/10 split
  // TODO: createGPT({ vocabSize, blockSize: T, dModel: 32, nHead: 4, nLayer: 1, seed: 1 }), new Adam(model.parameters(), { lr: 0.01 }), rng(1)
  // TODO: the training loop (report({ loss }) each step draws the curve)
  return { trainLoss: NaN, valLoss: NaN };
}
`,
    }),
    tests: [
      metric('untrained: validation loss near ln 68', 'train', [0], { name: 'valLoss', min: 3.9, max: 4.5 }, 60_000),
      metric(`${TRAIN_STEPS} steps: validation loss < 2.8`, 'train', [TRAIN_STEPS], { name: 'valLoss', max: 2.8 }, 300_000),
    ],
    requires: ['batching-pipeline'],
  }),
  defineLevel({
    ...base,
    phase: 6,
    id: 'loss-perplexity',
    order: 3,
    title: 'Loss curves and perplexity',
    goal:
      'Export perplexity(meanLoss) = e^meanLoss, smoothCurve(values, beta) (an exponential moving average with bias correction), and trainWithCurve(steps), ' +
      'which records the training loss at every step and returns { start, end, drop, valLoss, valPerplexity } from the smoothed curve (beta 0.9). ' +
      `After ${CURVE_STEPS} steps, drop must be at least 1 and the validation perplexity below 18.`,
    tutorial:
      'The loss of one batch is noisy: some windows are easier than others. To read a loss curve, smooth it with an exponential moving average:\n\n' +
      code(`
m = beta * m + (1 - beta) * loss;      // m starts at 0
smoothed = m / (1 - beta ** (i + 1));  // bias correction for step i (0-based)
`) +
      '\n\nWithout the correction the curve would start near 0, because m starts at 0; dividing by 1 - beta^(i+1) undoes that, so the first smoothed value is the first loss. Adam uses the same correction.\n\n' +
      '**Perplexity** is e raised to the mean cross-entropy (in nats). It reads as "the model is as unsure as if it chose uniformly among this many tokens": ' +
      'an untrained model over 68 characters has perplexity 68, and a perfect one has 1.\n\n' +
      'Watch the training panel while it runs: report the loss each step if you want to see the curve live.\n\n' +
      'On the GPU, reading a loss back makes the CPU wait for the GPU. Ask for every value without waiting, and wait once at the end:\n\n' +
      code(`
losses.push(loss.itemAsync());               // a promise: the copy back starts now
// ... after the loop:
const values = await Promise.all(losses);    // plain numbers
`),
    hints: [
      'perplexity is Math.exp(meanLoss).',
      'smoothCurve: keep m outside a values.map((v, i) => ...) and return m / (1 - Math.pow(beta, i + 1)).',
      'trainWithCurve is your train loop from the last level with losses.push(loss.itemAsync()) after each forward pass, then const values = await Promise.all(losses).',
      'start = smooth[0], end = smooth[smooth.length - 1], drop = start - end; valLoss = await evalLoss(model, valIds, 32), valPerplexity = perplexity(valLoss).',
    ],
    afterword:
      'Papers report perplexity because it does not depend on the log base and is easy to compare. Comparisons only make sense with the same tokenizer, though: ' +
      'a per-character perplexity of 12 and a per-word perplexity of 100 can describe the same model.',
    js: jsSetup({
      datasets: [MACBETH],
      library: [GPT_LIBRARY],
      training: true,
      starter: `// Loss curves and perplexity.
import { load } from 'data';
import { crossEntropy } from 'nn';
import { Adam } from 'optim';
import { charVocab, createGPT, encodeChars, evalLoss, randomBatch, rng } from './gpt.js';

export function perplexity(meanLoss) {
  // TODO
  return 0;
}

export function smoothCurve(values, beta) {
  // TODO: exponential moving average with bias correction
  return values;
}

export async function trainWithCurve(steps) {
  const losses = [];
  // TODO: train as in the last level, pushing loss.itemAsync() every step
  const smooth = smoothCurve(await Promise.all(losses), 0.9);
  return { start: NaN, end: NaN, drop: NaN, valLoss: NaN, valPerplexity: NaN };
}
`,
    }),
    tests: [
      eq('perplexity of uniform guessing', 'perplexity', [Math.log(MACBETH_VOCAB_SIZE)], MACBETH_VOCAB_SIZE, 1e-6),
      eq('perplexity(0) is 1', 'perplexity', [0], 1),
      eq('smoothCurve of a constant is the constant', 'smoothCurve', [[3, 3, 3, 3], 0.9], [3, 3, 3, 3]),
      eq('smoothCurve', 'smoothCurve', [[4, 3, 3.5, 2, 2.5, 1], 0.8], smoothCurve([4, 3, 3.5, 2, 2.5, 1], 0.8)),
      metric(`${CURVE_STEPS} steps: smoothed loss drops by at least 1`, 'trainWithCurve', [CURVE_STEPS], { name: 'drop', min: 1 }, 300_000),
      metric(`${CURVE_STEPS} steps: validation perplexity < 18`, 'trainWithCurve', [CURVE_STEPS], { name: 'valPerplexity', min: 1, max: 18 }, 300_000),
    ],
    requires: ['train-tiny-gpt'],
  }),
  defineLevel({
    ...base,
    phase: 6,
    id: 'sampling',
    order: 4,
    title: 'Sampling',
    goal:
      'Export sampleNext(logits, opts, u): pick the next token from logits with opts { temperature, topK, topP } and a uniform number u in [0, 1). ' +
      'Temperature 0 is greedy (argmax). sampleMany is provided.',
    tutorial:
      'A trained model gives logits for the next token; generating text means picking one, appending it, and repeating. How you pick changes the text a lot:\n\n' +
      '- **Greedy** (temperature 0): always the most likely token (the lowest id wins a tie). Safe, and prone to loops.\n' +
      '- **Temperature**: softmax(logits / temperature). Below 1 sharpens the distribution, above 1 flattens it.\n' +
      '- **Top-k**: keep only the k most likely tokens.\n' +
      '- **Top-p** (nucleus): keep the most likely tokens until their probability adds up to at least p.\n\n' +
      'So that tests can check your sampler exactly, the random number is an argument. The rule:\n\n' +
      code(`
1. temperature 0: return the argmax.
2. probs = softmax(logits / temperature)
3. order the ids by probability, highest first (ties: lower id first)
4. topK: keep the first topK ids
5. topP: renormalize the kept probabilities; keep the shortest prefix whose sum is >= topP
6. renormalize again; walk the kept ids adding probabilities; return the first id where the sum is > u
`) +
      '\n\nWith gpt.js, generation is: `const id = sampleNext(await nextLogits(model, ids), { temperature: 0.8, topK: 10 }, Math.random())`, push the id, repeat. ' +
      'The model runs on the GPU, but sampling is a few dozen numbers, so it happens on the CPU after nextLogits reads the logits back.',
    hints: [
      'Start with temperature 0: loop over the logits and keep the index of the largest (use > so the first one wins ties).',
      'Sort indices, not probabilities: probs.map((p, i) => i).sort((a, b) => probs[b] - probs[a] || a - b).',
      'For top-p, divide by the total of the ids you kept after top-k, add one id at a time, and stop as soon as the running sum reaches topP.',
      'The final walk: cum += probs[i] / total; if (u < cum) return i. After the loop, return the last kept id (rounding can leave the sum just under 1).',
    ],
    afterword:
      'Chat models usually sample with a temperature around 0.7 and top-p around 0.9: enough randomness to avoid repeating themselves, not enough to wander off into rare tokens. ' +
      'Nothing in the model changes; only this last step does.',
    js: jsSetup({
      library: [GPT_LIBRARY],
      starter: `// Sampling the next token.

// opts: { temperature = 1, topK, topP }. u: a uniform random number in [0, 1).
export function sampleNext(logits, opts, u) {
  // TODO
  return 0;
}

// Provided: one token for each u (the tests call this with many values of u).
export function sampleMany(logits, opts, us) {
  return us.map((u) => sampleNext(logits, opts, u));
}
`,
    }),
    tests: [
      sampleCase('temperature 0 is greedy for every u', { temperature: 0 }),
      eq('greedy: the lowest id wins a tie', 'sampleMany', [[1, 5, 5, 2], { temperature: 0 }, [0.1, 0.9]], [1, 1]),
      sampleCase('temperature 1', { temperature: 1 }),
      sampleCase('temperature 0.5 sharpens', { temperature: 0.5 }),
      sampleCase('temperature 2 flattens', { temperature: 2 }),
      sampleCase('top-k 1 is greedy', { temperature: 1, topK: 1 }),
      sampleCase('top-k 3 picks only among the 3 most likely', { temperature: 1, topK: 3 }),
      sampleCase('top-p 0.6', { temperature: 1, topP: 0.6 }),
      sampleCase('top-k 4 then top-p 0.9 at temperature 0.8', { temperature: 0.8, topK: 4, topP: 0.9 }),
    ],
    requires: ['loss-perplexity'],
  }),
];
