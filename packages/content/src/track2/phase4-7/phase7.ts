import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../../define';
import { GPT_LIBRARY, MACBETH, MACBETH_VOCAB_SIZE, SONNETS, base, code, eq, jsSetup, metric } from './common';
import {
  PREFERENCE_FEATURES,
  fitPowerLaw,
  loraBackward,
  loraRow,
  pairLoss,
  preferencePairs,
  randMat,
  randVec,
  trainRewardModel,
} from './models';

/**
 * Track 2, Phase 7 (Beyond): fine-tuning a pretrained tiny GPT on the
 * Sonnets, LoRA adapters on a frozen bigram table, a toy reward model from
 * preference pairs, and a scaling experiment. Every run is seeded and takes
 * seconds on a CPU; tests bound losses and trends with margins (E-ML-02).
 * DRAFT text (owner approves).
 */

export const PRETRAIN_STEPS = 200;
export const FINETUNE_STEPS = 100;
export const LORA_RANK = 4;
export const LORA_STEPS = 200;
export const SCALING_WIDTHS = [1, 2, 4, 8, 16];
export const SCALING_STEPS = 300;

const W0 = randMat(91, 4, 5);
const A = randMat(92, 4, 2);
const B = randMat(93, 2, 5);
const DROW = randVec(94, 5);

export const PREF_TRAIN = preferencePairs(101, 200);
export const PREF_TEST = preferencePairs(102, 100);
const PREF_W = [1, 0.5, -0.25, -1];
const SMALL_PAIRS = PREF_TRAIN.slice(0, 5);

const NS = [100, 200, 400, 800];
const POWER_LOSSES = NS.map((n) => 5 * n ** -0.3);

export const PHASE7: Level[] = [
  defineLevel({
    ...base,
    phase: 7,
    id: 'fine-tuning',
    order: 1,
    title: 'Fine-tuning',
    goal:
      `Pretrain the tiny GPT on Macbeth for preSteps, then fine-tune a copy on the Sonnets for ftSteps with a smaller learning rate. Export finetune(preSteps, ftSteps) returning ` +
      '{ before, after, gain, macbethBefore, macbethAfter } (validation losses; gain = before - after). ' +
      `With ${PRETRAIN_STEPS} + ${FINETUNE_STEPS} steps, the Sonnets loss must improve by at least 0.1.`,
    tutorial:
      'Large models are pretrained once, at great cost, on a broad mix of text, then fine-tuned cheaply on a narrow task: chat, code, a style. ' +
      'Fine-tuning is ordinary training that starts from pretrained weights instead of random ones.\n\n' +
      'Here the "broad" text is Macbeth and the narrow one is the Sonnets (both public domain, from Project Gutenberg). The recipe:\n\n' +
      code(`
const base = createGPT({ ... });
trainSteps(base, macbethTrain, preSteps, 0.01);   // pretraining
const before = evalLoss(base, sonnetsVal, 32);

const tuned = cloneModel(base);                    // keep the base model intact
trainSteps(tuned, sonnetsTrain, ftSteps, 0.003);  // a smaller learning rate
const after = evalLoss(tuned, sonnetsVal, 32);
`) +
      '\n\nThe smaller learning rate keeps the model near what it already knows. Also measure the Macbeth loss before and after: ' +
      'fine-tuning on one text slowly makes the model worse at the other, which is called catastrophic forgetting.\n\n' +
      'Both texts use the same characters (the Sonnets use a subset of the Macbeth vocabulary), so build the vocabulary from Macbeth.',
    hints: [
      'Write trainSteps(model, ids, steps, lr, r): createAdam(model), then the usual loop with randomBatch(ids, 8, 32, r).',
      'Split each text 90/10 after encoding it with the Macbeth vocabulary: await load("text-sonnets") gives the second text.',
      'Measure before (Sonnets) and macbethBefore on the base model, clone it with cloneModel, fine-tune the clone, then measure after and macbethAfter on the clone.',
      'gain = before - after. With 200 + 100 steps it is typically around 0.2.',
    ],
    afterword:
      'Instruction-tuned chat models are fine-tuned on examples of conversations. Fine-tuning every weight is still expensive for large models: ' +
      'each fine-tuned copy is as big as the original. The next level fixes that.',
    js: jsSetup({
      datasets: [MACBETH, SONNETS],
      library: [GPT_LIBRARY],
      training: true,
      starter: `// Fine-tuning a pretrained tiny GPT.
import { load } from 'data';
import { adamStep, backward, charVocab, cloneModel, createAdam, createGPT, encodeChars, evalLoss, gptForward, randomBatch, rng, zeroGrad } from './gpt.js';

const T = 32;
const B = 8;

export async function finetune(preSteps, ftSteps) {
  const macbeth = await load('text-macbeth');
  const sonnets = await load('text-sonnets');
  // TODO: pretrain on Macbeth (lr 0.01), measure, clone, fine-tune on the Sonnets (lr 0.003), measure
  return { before: NaN, after: NaN, gain: NaN, macbethBefore: NaN, macbethAfter: NaN };
}
`,
    }),
    tests: [
      metric(`fine-tuning improves the Sonnets loss by >= 0.1`, 'finetune', [PRETRAIN_STEPS, FINETUNE_STEPS], { name: 'gain', min: 0.1 }, 300_000),
      metric('fine-tuned Sonnets loss < 2.7', 'finetune', [PRETRAIN_STEPS, FINETUNE_STEPS], { name: 'after', max: 2.7 }, 300_000),
      metric('no fine-tuning, no gain', 'finetune', [PRETRAIN_STEPS, 0], { name: 'gain', min: -1e-9, max: 1e-9 }, 300_000),
    ],
    requires: ['sampling'],
  }),
  defineLevel({
    ...base,
    phase: 7,
    id: 'lora',
    order: 2,
    title: 'LoRA',
    goal:
      'Fine-tune with low-rank adapters. Export loraRow(W0, A, B, scale, x) = W0[x] + scale · A[x] B, loraBackward(A, B, scale, x, dRow) → { dAx, dB }, ' +
      `and finetuneLora(rank, steps) → { trainable, full, before, after, gain }. With rank ${LORA_RANK}, train ${2 * MACBETH_VOCAB_SIZE * LORA_RANK} numbers instead of ${MACBETH_VOCAB_SIZE * MACBETH_VOCAB_SIZE} and improve the Sonnets loss by at least 0.05.`,
    tutorial:
      'LoRA (low-rank adaptation) freezes the pretrained weight matrix W0 and learns a small correction instead:\n\n' +
      code(`
W = W0 + scale * A × B     // W0: n x m (frozen), A: n x r, B: r x m (trained), r much smaller than n and m
`) +
      '\n\nA × B has rank at most r, so it holds only r · (n + m) numbers instead of n · m. B starts at zero, so training starts exactly at the pretrained model.\n\n' +
      'The pretrained model here is a bigram table W0 (68 x 68 logits, the smoothed log-probabilities of Macbeth). Its row for the current character x gives the logits of the next one:\n\n' +
      code(`
logits = W0[x] + scale * (A[x] × B)      // A[x] is row x of A: r numbers
`) +
      '\n\nBackward, for the gradient dRow of the loss with respect to these logits:\n\n' +
      code(`
dA[x][k] = scale * sum over j of B[k][j] * dRow[j]   // only row x of A changes
dB[k][j] = scale * A[x][k] * dRow[j]
`) +
      '\n\nTraining tip: the loss of a bigram model depends only on pair counts, so group the training text by current character. ' +
      'For row x with nx occurrences and counts C[x][j], the gradient of the mean loss is (nx · softmax(logits)[j] - C[x][j]) / N, where N is the number of pairs. Then one step is 68 rows, not 90,000 characters.',
    hints: [
      'loraRow: start from W0[x].slice() and add scale * A[x][k] * B[k][j] for every k and j.',
      'loraBackward returns dAx (r numbers, the gradient of row x of A) and dB (r x m).',
      'finetuneLora: W0 from Macbeth counts with add-one smoothing (Math.log((c + 1) / (rowTotal + V))); counts of the Sonnets split 90/10; A random and small (rng from gpt.js), B zeros, scale 1.',
      'Each step, for every row x with counts: logits = loraRow(...), gradient row as in the tutorial, add loraBackward into the gradients of A and B. Adam with lr 0.02 on A and B only.',
      'trainable = 2 * V * rank, full = V * V; before and after are the Sonnets validation losses.',
    ],
    afterword:
      'LoRA is how most people fine-tune large models today: a rank-8 adapter for a 4096 x 4096 matrix trains 65,536 numbers instead of 16.7 million, ' +
      'and many adapters can share one frozen base model, each a few megabytes on disk.',
    js: jsSetup({
      datasets: [MACBETH, SONNETS],
      library: [GPT_LIBRARY],
      training: true,
      starter: `// LoRA on a frozen bigram table.
import { load } from 'data';
import { rng } from './gpt.js';

// W0[x] + scale * A[x] B
export function loraRow(W0, A, B, scale, x) {
  // TODO
  return W0[x].slice();
}

// Gradients of row x of A (r numbers) and of B (r x m) for the gradient dRow of the logits.
export function loraBackward(A, B, scale, x, dRow) {
  // TODO
  return { dAx: [], dB: [] };
}

export async function finetuneLora(rank, steps) {
  const macbeth = await load('text-macbeth');
  const sonnets = await load('text-sonnets');
  // TODO: W0 from Macbeth, adapters A and B, train on the Sonnets with Adam
  return { trainable: NaN, full: NaN, before: NaN, after: NaN, gain: NaN };
}
`,
    }),
    tests: [
      eq('loraRow', 'loraRow', [W0, A, B, 0.5, 2], loraRow(W0, A, B, 0.5, 2)),
      eq('with B = 0, loraRow is W0[x]', 'loraRow', [W0, A, [new Array(5).fill(0), new Array(5).fill(0)], 2, 1], W0[1]),
      eq('loraBackward', 'loraBackward', [A, B, 0.5, 2, DROW], loraBackward(A, B, 0.5, 2, DROW)),
      metric(`rank ${LORA_RANK}: ${2 * MACBETH_VOCAB_SIZE * LORA_RANK} trainable numbers`, 'finetuneLora', [LORA_RANK, 1], { name: 'trainable', min: 2 * MACBETH_VOCAB_SIZE * LORA_RANK, max: 2 * MACBETH_VOCAB_SIZE * LORA_RANK }, 60_000),
      metric(`rank ${LORA_RANK}: Sonnets loss improves by >= 0.05`, 'finetuneLora', [LORA_RANK, LORA_STEPS], { name: 'gain', min: 0.05 }, 120_000),
      metric('rank 1 still helps', 'finetuneLora', [1, LORA_STEPS], { name: 'gain', min: 0.02 }, 120_000),
    ],
    requires: ['fine-tuning'],
  }),
  defineLevel({
    ...base,
    phase: 7,
    id: 'preference-model',
    order: 3,
    title: 'A toy preference model',
    goal:
      'Train a reward model from preference pairs. Export reward(w, features), pairLoss(w, chosen, rejected) = -log σ(reward(chosen) - reward(rejected)), ' +
      'trainRewardModel(pairs, steps, lr) (full-batch gradient descent from w = 0) and evaluateRewardModel(trainPairs, testPairs, steps, lr) → { accuracy, testLoss }. Reach 85% test accuracy.',
    tutorial:
      'Chat models are tuned with human preferences: people see two answers and pick the better one. A reward model learns to score answers so that the chosen one scores higher; ' +
      'the language model is then tuned to produce high-scoring answers (RLHF), or trained on the pairs directly (DPO).\n\n' +
      `In this toy, an answer is described by ${PREFERENCE_FEATURES.length} numbers: ${PREFERENCE_FEATURES.map((f) => `"${f}"`).join(', ')}. The reward model is linear: reward = w · features. ` +
      'The labeller who made the pairs has a hidden taste and is sometimes inconsistent, like real people.\n\n' +
      'The Bradley-Terry model says P(chosen preferred) = σ(r_chosen - r_rejected), with σ(d) = 1 / (1 + e^-d). Training maximizes that probability:\n\n' +
      code(`
loss = -log σ(d) = log(1 + e^-d),   d = reward(w, chosen) - reward(w, rejected)
dloss/dd = -1 / (1 + e^d)
dloss/dw = dloss/dd * (chosen - rejected)
`) +
      '\n\nFor large negative d, e^-d overflows; compute log(1 + e^-d) as -d + log(1 + e^d) when d < 0 (Math.log1p helps). ' +
      'Average the gradient over all pairs and step: w -= lr * grad.',
    hints: [
      'reward is a dot product.',
      'pairLoss: d = reward(w, chosen) - reward(w, rejected); return d > 0 ? Math.log1p(Math.exp(-d)) : -d + Math.log1p(Math.exp(d)).',
      'trainRewardModel: w starts as zeros (pairs[0].chosen.length of them). Each step sums g * (chosen[i] - rejected[i]) / pairs.length over the pairs, with g = -1 / (1 + Math.exp(d)), then w[i] -= lr * grad[i].',
      'evaluateRewardModel: accuracy counts test pairs with reward(chosen) > reward(rejected); testLoss is the mean pairLoss on the test pairs.',
    ],
    afterword:
      'Look at the w you learned: positive weights for answering and politeness, negative for length and typos. Real reward models are whole transformers, and they share this weakness: ' +
      'the policy learns to please the reward model, not the people, so a reward model that likes long answers produces long answers.',
    js: jsSetup({
      starter: `// A linear reward model trained on preference pairs.
// pairs: [{ chosen: [features...], rejected: [features...] }, ...]

export function reward(w, features) {
  // TODO
  return 0;
}

// -log(sigmoid(reward(chosen) - reward(rejected))), computed without overflow.
export function pairLoss(w, chosen, rejected) {
  // TODO
  return 0;
}

// Full-batch gradient descent from w = 0.
export function trainRewardModel(pairs, steps, lr) {
  // TODO
  return new Array(pairs[0].chosen.length).fill(0);
}

export function evaluateRewardModel(trainPairs, testPairs, steps, lr) {
  // TODO
  return { accuracy: 0, testLoss: NaN };
}
`,
    }),
    tests: [
      eq('reward', 'reward', [PREF_W, [1, 0, 2.5, 1]], 1 - 0.625 - 1),
      eq('pairLoss with w = 0 is ln 2', 'pairLoss', [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]], Math.LN2),
      eq('pairLoss', 'pairLoss', [PREF_W, PREF_TRAIN[0]!.chosen, PREF_TRAIN[0]!.rejected], pairLoss(PREF_W, PREF_TRAIN[0]!.chosen, PREF_TRAIN[0]!.rejected)),
      eq('pairLoss does not overflow', 'pairLoss', [[1000], [0], [1]], 1000),
      eq('trainRewardModel, 5 pairs, 10 steps', 'trainRewardModel', [SMALL_PAIRS, 10, 0.5], trainRewardModel(SMALL_PAIRS, 10, 0.5), 1e-6),
      metric('test accuracy >= 85%', 'evaluateRewardModel', [PREF_TRAIN, PREF_TEST, 300, 0.5], { name: 'accuracy', min: 0.85, max: 1 }, 30_000),
      metric('test loss < 0.45', 'evaluateRewardModel', [PREF_TRAIN, PREF_TEST, 300, 0.5], { name: 'testLoss', max: 0.45 }, 30_000),
    ],
    requires: ['lora'],
  }),
  defineLevel({
    ...base,
    phase: 7,
    id: 'scaling-experiment',
    order: 4,
    title: 'A scaling experiment',
    goal:
      'Train the same model at several sizes and fit a power law to loss against parameter count. Export fitPowerLaw(ns, losses) → { a, b } (least squares on log L = a + b log N) ' +
      'and scalingRun(widths, steps) → { params, losses, slope, worstIncrease }. The loss must fall at every size step (worstIncrease < 0) and the slope must be negative.',
    tutorial:
      'Scaling laws are the empirical finding behind large language models: with enough data, loss falls as a smooth power law of model size, L ≈ c · N^b with b < 0. ' +
      'On log-log axes that is a straight line, so a straight-line fit of log L against log N gives the exponent b:\n\n' +
      code(`
x = log N, y = log L
b = sum((x - mean x)(y - mean y)) / sum((x - mean x)²)
a = mean y - b * mean x
`) +
      '\n\nThe model to scale is a factorized bigram model of width d: logits(current) = E[current] × U + bias, with E: 68 x d and U: d x 68, ' +
      'so it has 2 · 68 · d + 68 parameters. Width 1 can only learn a crude summary of each character; width 16 can nearly match the full bigram table. ' +
      'Train each width with Adam (full batch, grouped by pair counts as in the LoRA level) on the first 90% of Macbeth, and measure the validation loss.\n\n' +
      'Return the parameter counts, the validation losses, the fitted slope b, and worstIncrease: the largest losses[i] - losses[i - 1]. A scaling trend means it is negative.',
    hints: [
      'fitPowerLaw takes logs first (ns.map(Math.log), losses.map(Math.log)) and then is ordinary least squares.',
      'Gradient of the mean loss for row x of logits: g[j] = (nx · p[j] - C[x][j]) / N. Then dE[x][k] += g[j] · U[k][j], dU[k][j] += E[x][k] · g[j], dbias[j] += g[j].',
      'Initialize E and U with small random numbers from rng in gpt.js (different seed per width is fine), bias with zeros; Adam with lr 0.05 and 300 steps.',
      'worstIncrease: start at -Infinity and take the max of losses[i] - losses[i - 1] for i >= 1.',
    ],
    afterword:
      'Kaplan et al. (2020) and the Chinchilla paper (2022) measured these lines across models from thousands to billions of parameters and used them to choose how big to make the next model and how much data to feed it. ' +
      'Your line flattens near 2.45, the bigram floor: no amount of width helps a model that sees one character. Real scaling needs a model that can use more context.',
    js: jsSetup({
      datasets: [MACBETH],
      library: [GPT_LIBRARY],
      training: true,
      starter: `// Loss against model size.
import { load } from 'data';
import { rng } from './gpt.js';

// Least squares on log L = a + b log N.
export function fitPowerLaw(ns, losses) {
  // TODO
  return { a: 0, b: 0 };
}

// Train a factorized bigram model of each width; validation loss for each.
export async function scalingRun(widths, steps) {
  const text = await load('text-macbeth');
  // TODO
  return { params: [], losses: [], slope: NaN, worstIncrease: NaN };
}
`,
    }),
    tests: [
      eq('fitPowerLaw recovers an exact power law', 'fitPowerLaw', [NS, POWER_LOSSES], { a: Math.log(5), b: -0.3 }, 1e-6),
      eq('fitPowerLaw on noisy points', 'fitPowerLaw', [[10, 30, 100, 300], [3, 2.6, 2.5, 2.1]], fitPowerLaw([10, 30, 100, 300], [3, 2.6, 2.5, 2.1])),
      metric('loss falls with every size step', 'scalingRun', [SCALING_WIDTHS, SCALING_STEPS], { name: 'worstIncrease', max: 0 }, 120_000),
      metric('the fitted exponent is negative', 'scalingRun', [SCALING_WIDTHS, SCALING_STEPS], { name: 'slope', max: -0.02 }, 120_000),
    ],
    requires: ['preference-model'],
  }),
];
