import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../../define';
import { MODULES, base, code, eq, jsSetup, metric } from './common';

/**
 * Track 2, Phase 3 (Networks): an MLP that solves XOR, the training loop and
 * the learning rate, overfitting and validation, and a small digit
 * recognizer. Uses the library modules: 'tensor' and 'autograd' first, then
 * 'nn' and 'optim', then 'data'. Training tests are seeded metric tests.
 * DRAFT text (owner approves). CNT-12.
 */

/** The dataset the digit recognizer loads (content/datasets/LICENSES.md). */
export const DIGITS_DATASET = 'digits-8x8';

/** The noisy sine data of the overfitting level, shared by its starter and reference. */
export const NOISY_SINE = `// ---- Data (provided): 40 noisy samples of y = sin(x). ----
const frac = (v) => v - Math.floor(v);
export function makeData() {
  const xs = [], ys = [];
  for (let i = 0; i < 40; i++) {
    const x = -3 + 6 * frac(i * 0.6180339887);
    const noise = 0.3 * (2 * frac(Math.sin(i * 12.9898 + 1) * 43758.5453) - 1);
    xs.push(x);
    ys.push(Math.sin(x) + noise);
  }
  return { xs, ys };
}
`;

/** The split the overfitting level asks for: the last round(n * valFraction) samples are validation. */
function split(xs: number[], ys: number[], valFraction: number) {
  const nTrain = xs.length - Math.round(xs.length * valFraction);
  return { train: { xs: xs.slice(0, nTrain), ys: ys.slice(0, nTrain) }, val: { xs: xs.slice(nTrain), ys: ys.slice(nTrain) } };
}

export const PHASE3: Level[] = [
  defineLevel({
    ...base,
    phase: 3,
    id: 'mlp-xor',
    order: 1,
    title: 'An MLP that solves XOR',
    goal: 'Train a two-layer network (2 inputs, a hidden tanh layer, 1 sigmoid output) on the four XOR cases until it gets all four right, using tensors that compute their own gradients.',
    tutorial:
      'One neuron draws one line, and no single line separates XOR\'s ones (0,1 and 1,0) from its zeros (0,0 and 1,1). ' +
      'A hidden layer fixes that: its neurons draw several lines, and the output neuron combines them. That is a multi-layer perceptron (MLP).\n\n' +
      'You have now unlocked `autograd`. A `Tensor` from the `tensor` module works like your Value, but each one holds a whole matrix, ' +
      'and `loss.backward()` fills `.grad` on every tensor created with `requiresGrad: true`:\n\n' +
      code(`
import { tensor, randn, zeros, manualSeed } from 'tensor';
import { noGrad } from 'autograd';

const W1 = randn([2, 8], { requiresGrad: true });   // 2 inputs -> 8 hidden
const h = X.matmul(W1).add(b1).tanh();               // [4, 8]: one row per example
`) +
      '\n\nThe whole batch goes through at once: X is [4, 2] (the four cases as rows), so X·W1 is [4, 8], and adding b1 (shape [8]) broadcasts to every row, exactly as in Phase 1.\n\n' +
      'A training step: forward, loss, backward, then move every parameter a little against its gradient, inside `noGrad` so the update itself is not recorded:\n\n' +
      code(`
loss.backward();
noGrad(() => {
  for (const p of params) {
    for (let i = 0; i < p.size; i++) p.data[i] -= lr * p.grad.data[i];
    p.zeroGrad(); // gradients add up across backward() calls, so clear them
  }
});
`) +
      '\n\nCall `manualSeed(n)` before creating the weights so every run starts from the same random numbers.',
    hints: [
      'Parameters: W1 [2, 8], b1 [8], W2 [8, 1], b2 [1]. Start the weights with randn and the biases with zeros, all with `{ requiresGrad: true }`.',
      'Forward: `const out = X.matmul(W1).add(b1).tanh().matmul(W2).add(b2).sigmoid();` and loss: `out.sub(Y).square().mean()`.',
      'A learning rate around 0.5 to 1 and 2,000 steps is plenty. If the loss stalls near 0.25, the network is guessing 0.5 everywhere: try another seed or a larger learning rate.',
      'accuracy: round each output (`out.data[i] > 0.5 ? 1 : 0`), compare with Y.data[i], and divide the number right by 4.',
      'Near-complete:\n' +
        code(`
export function train() {
  manualSeed(1);
  const W1 = randn([2, 8], { requiresGrad: true }), b1 = zeros([8], { requiresGrad: true });
  const W2 = randn([8, 1], { requiresGrad: true }), b2 = zeros([1], { requiresGrad: true });
  const params = [W1, b1, W2, b2];
  let out, loss;
  for (let step = 0; step < 2000; step++) {
    out = X.matmul(W1).add(b1).tanh().matmul(W2).add(b2).sigmoid();
    loss = out.sub(Y).square().mean();
    loss.backward();
    noGrad(() => { for (const p of params) { for (let i = 0; i < p.size; i++) p.data[i] -= 1 * p.grad.data[i]; p.zeroGrad(); } });
  }
  let right = 0;
  for (let i = 0; i < 4; i++) if ((out.data[i] > 0.5 ? 1 : 0) === Y.data[i]) right++;
  return { loss: loss.item(), accuracy: right / 4 };
}
`),
    ],
    afterword:
      'XOR is the problem that, in 1969, made many people give up on neural networks: Minsky and Papert showed one layer cannot learn it. ' +
      'Hidden layers trained by backpropagation answered them, and the network you just trained is that answer.',
    js: jsSetup({
      starter: `import { tensor, randn, zeros, manualSeed } from 'tensor';
import { noGrad } from 'autograd';

// The four XOR cases, one per row, and their answers.
const X = tensor([[0, 0], [0, 1], [1, 0], [1, 1]]);
const Y = tensor([[0], [1], [1], [0]]);

// Train a 2 -> 8 (tanh) -> 1 (sigmoid) network on X, Y.
// Return the final mean squared error and the fraction of the 4 cases it gets right.
export function train() {
  manualSeed(1);
  const W1 = randn([2, 8], { requiresGrad: true });
  const b1 = zeros([8], { requiresGrad: true });
  // TODO: W2 and b2, then the training loop.
  return { loss: 1, accuracy: 0 };
}
`,
      modules: MODULES.autograd,
      training: true,
    }),
    tests: [
      metric('gets all four cases right', 'train', [], { name: 'accuracy', min: 1 }),
      metric('final loss below 0.05', 'train', [], { name: 'loss', max: 0.05 }),
    ],
    requires: ['autograd'],
  }),

  defineLevel({
    ...base,
    phase: 3,
    id: 'training-loop',
    order: 2,
    title: 'Training loop and learning rate',
    goal: 'Write a reusable training loop with the nn and optim modules, fit a curve with it, detect a learning rate that blows up, and pick the best of three learning rates.',
    tutorial:
      'Two more modules are unlocked. `nn` has ready-made layers and losses, and `optim` has optimizers that do the parameter update you wrote by hand:\n\n' +
      code(`
import { Sequential, Linear, Tanh, mse } from 'nn';
import { SGD, Adam } from 'optim';

const model = new Sequential(new Linear(1, 16), new Tanh(), new Linear(16, 1));
const opt = new SGD(model.parameters(), { lr: 0.1 });
for (let step = 0; step < steps; step++) {
  opt.zeroGrad();
  const loss = mse(model.forward(X), Y);
  loss.backward();
  opt.step();
}
`) +
      '\n\nThose four lines inside the loop are the training loop of nearly every model ever trained. The rest is choosing numbers, and the most important is the learning rate:\n\n' +
      '- too small, and the loss barely moves;\n- too large, and each step overshoots, the loss grows, and soon it is Infinity or NaN (E-ML-03);\n- in between, it falls quickly and steadily.\n\n' +
      'Check the loss every step with `Number.isFinite(loss.item())` and stop as soon as it is not: there is nothing to learn from NaN. ' +
      'Adam (`new Adam(params, { lr: 0.01 })`) adapts the step size per parameter and is far less sensitive to the learning rate; use it for `fit`.',
    hints: [
      'The data is ready: X is 64 points in [-3, 3] as a [64, 1] tensor and Y is sin(X). Call `manualSeed(0)` first in trainWith so every run starts from the same weights.',
      'trainWith: build a fresh model and a fresh SGD each call. Inside the loop, compute the loss, then `if (!Number.isFinite(loss.item())) return { loss: 1e9, diverged: 1 };` before backward.',
      'lrSweep: call trainWith(lr, 300) for each of the three rates, keep the index of the smallest loss, and return `{ bestIndex }`.',
      'fit: the same loop with Adam at lr 0.01 for about 1,500 steps reaches a loss well under 0.01.',
      'Near-complete:\n' +
        code(`
function loop(opt, model, steps) {
  let loss;
  for (let s = 0; s < steps; s++) {
    opt.zeroGrad();
    loss = mse(model.forward(X), Y);
    if (!Number.isFinite(loss.item())) return { loss: 1e9, diverged: 1 };
    loss.backward();
    opt.step();
  }
  return { loss: loss.item(), diverged: 0 };
}
export function trainWith(lr, steps) {
  manualSeed(0);
  const model = makeModel();
  return loop(new SGD(model.parameters(), { lr }), model, steps);
}
`),
    ],
    afterword:
      'Finding a good learning rate is still mostly a sweep like yours, just bigger. Large models also change the rate during training: ' +
      'a short warmup from near zero, then a slow decay, which the optim module provides as schedules.',
    js: jsSetup({
      starter: `import { linspace, manualSeed } from 'tensor';
import { Sequential, Linear, Tanh, mse } from 'nn';
import { SGD, Adam } from 'optim';

// 64 points in [-3, 3] as a column ([64, 1]) and their sines.
const X = linspace(-3, 3, 64).reshape([64, 1]);
const Y = X.sin();

const makeModel = () => new Sequential(new Linear(1, 16), new Tanh(), new Linear(16, 1));

// Train a fresh model with SGD at learning rate lr for \`steps\` steps (after manualSeed(0)).
// Return { loss, diverged }: diverged is 1 if the loss stopped being a finite number, else 0.
export function trainWith(lr, steps) {
  manualSeed(0);
  const model = makeModel();
  return { loss: 1e9, diverged: 0 };
}

// Try lr = 0.001, 0.1 and 30 for 300 steps each. Return the index (0, 1 or 2) of the best one.
export function lrSweep() {
  return { bestIndex: -1 };
}

// Fit the curve as well as you can, with any optimizer. Return { loss }.
export function fit() {
  return { loss: 1e9 };
}
`,
      modules: MODULES.nn,
      training: true,
    }),
    tests: [
      metric('lr = 0.001 barely moves', 'trainWith', [0.001, 300], { name: 'loss', min: 0.05, max: 10 }),
      metric('lr = 30 diverges and is caught', 'trainWith', [30, 300], { name: 'diverged', min: 1, max: 1 }),
      metric('lr = 0.1 learns', 'trainWith', [0.1, 300], { name: 'loss', max: 0.2 }),
      metric('the sweep picks lr = 0.1', 'lrSweep', [], { name: 'bestIndex', min: 1, max: 1 }),
      metric('fit: loss below 0.01', 'fit', [], { name: 'loss', max: 0.01 }, { timeoutMs: 30_000 }),
    ],
    requires: ['mlp-xor'],
  }),

  defineLevel({
    ...base,
    phase: 3,
    id: 'overfitting',
    order: 3,
    title: 'Overfitting and validation',
    goal: 'Hold out part of the data, train a large network on the rest, and watch the validation loss: keep the weights from the step where it was lowest (early stopping).',
    tutorial:
      'A network with many more parameters than data points can memorize the training set, noise included. Its training loss keeps falling toward zero ' +
      'while its error on new data gets worse. That is overfitting, and the training loss alone cannot show it.\n\n' +
      'So keep some data aside. Train on the training split only, and every few steps measure the loss on the validation split, without gradients:\n\n' +
      code(`
const valLoss = noGrad(() => mse(model.forward(Xval), Yval).item());
`) +
      '\n\nAt first both losses fall. Later the validation loss turns and climbs while the training loss keeps dropping: from there on the network is learning the noise. ' +
      'Early stopping remembers the step with the lowest validation loss and keeps those weights:\n\n' +
      code(`
if (valLoss < best.valLoss) best = { valLoss, step, state: model.stateDict() };
// ... after training:
model.loadStateDict(best.state);
`) +
      '\n\nThe data here is 40 noisy samples of sin(x); `makeData` is provided. Never pick anything (steps, sizes, learning rate) by looking at the test set: that is what the validation split is for.',
    hints: [
      'split: nTrain = xs.length - Math.round(xs.length * valFraction); the train part is the first nTrain samples and the validation part the rest. Return `{ train: { xs, ys }, val: { xs, ys } }`.',
      'Turn arrays into column tensors with `tensor(xs).reshape([-1, 1])`.',
      'run: the model is `new Sequential(new Linear(1, 32), new Tanh(), new Linear(32, 32), new Tanh(), new Linear(32, 1))` with Adam at lr 0.01 for 2,000 steps on a 50% split. ' +
        'Measure the validation loss every 10 steps and track the best.',
      'Return finalValLoss (validation loss after the last step), bestValLoss (after loading the best weights back) and worseBy = finalValLoss / bestValLoss. When the model overfits, worseBy is well above 1.',
      'Near-complete:\n' +
        code(`
let best = { valLoss: Infinity, state: null, step: 0 };
for (let step = 1; step <= 2000; step++) {
  opt.zeroGrad();
  const loss = mse(model.forward(Xtr), Ytr);
  loss.backward();
  opt.step();
  if (step % 10 === 0) {
    const v = noGrad(() => mse(model.forward(Xva), Yva).item());
    if (v < best.valLoss) best = { valLoss: v, state: model.stateDict(), step };
  }
}
const finalValLoss = noGrad(() => mse(model.forward(Xva), Yva).item());
const trainLoss = noGrad(() => mse(model.forward(Xtr), Ytr).item());
model.loadStateDict(best.state);
const bestValLoss = noGrad(() => mse(model.forward(Xva), Yva).item());
return { trainLoss, finalValLoss, bestValLoss, bestStep: best.step, worseBy: finalValLoss / bestValLoss };
`),
    ],
    afterword:
      'Early stopping is one of several defenses: more data, smaller models, weight decay (AdamW) and dropout all fight memorization. ' +
      'Large language models see each token only about once, so they rarely overfit in this way; small datasets, like the ones you fine-tune on in Phase 7, do.',
    js: jsSetup({
      starter:
        `import { tensor, manualSeed } from 'tensor';
import { noGrad } from 'autograd';
import { Sequential, Linear, Tanh, mse } from 'nn';
import { Adam } from 'optim';

` +
        NOISY_SINE +
        `
// The last round(n * valFraction) samples are validation, the rest training.
export function split(xs, ys, valFraction) {
  return { train: { xs, ys }, val: { xs: [], ys: [] } };
}

// Train a 1 -> 32 -> 32 -> 1 tanh network on the training half for 2,000 Adam steps (lr 0.01),
// checking the validation loss every 10 steps. Return
// { trainLoss, finalValLoss, bestValLoss, bestStep, worseBy: finalValLoss / bestValLoss }.
export function run() {
  manualSeed(0);
  const { xs, ys } = makeData();
  const parts = split(xs, ys, 0.5);
  return { trainLoss: 1, finalValLoss: 1, bestValLoss: 1, bestStep: 0, worseBy: 1 };
}
`,
      modules: MODULES.nn,
      training: true,
    }),
    tests: [
      eq('split 10 samples, 30% validation', 'split', [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], 0.3], split([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], 0.3)),
      eq('split 4 samples, 50% validation', 'split', [[1, 2, 3, 4], [5, 6, 7, 8], 0.5], split([1, 2, 3, 4], [5, 6, 7, 8], 0.5)),
      metric('the training loss gets small', 'run', [], { name: 'trainLoss', max: 0.01 }, { timeoutMs: 60_000 }),
      metric('early stopping finds a good model', 'run', [], { name: 'bestValLoss', max: 0.06 }, { timeoutMs: 60_000 }),
      metric('training too long: validation 25% worse', 'run', [], { name: 'worseBy', min: 1.25 }, { timeoutMs: 60_000 }),
    ],
    requires: ['training-loop'],
  }),

  defineLevel({
    ...base,
    phase: 3,
    id: 'digit-recognizer',
    order: 4,
    title: 'A small digit recognizer',
    goal: 'Train a network that reads 8×8 images of handwritten-style digits and names the digit, reaching at least 90% accuracy on test images it never saw during training.',
    tutorial:
      'Everything comes together: a real dataset, minibatches, cross-entropy over 10 classes, and a held-out test set.\n\n' +
      'The `data` module loads the `digits-8x8` set (`load` returns a promise, so `train` is an async function): 1,500 training and 300 test images. Each image is 64 grey levels between 0 and 1 (8 rows of 8), ' +
      'and each label is the digit 0-9. The images are generated with seeded noise, shifts and broken strokes, so no two are the same.\n\n' +
      code(`
import { load } from 'data';
const { train, test } = await load('digits-8x8');
const Xtr = tensor(train.x);      // [1500, 64]
const ytr = train.y;              // 1500 labels
`) +
      '\n\nThe network outputs 10 logits per image, and `crossEntropy(logits, labels)` from `nn` is the softmax cross-entropy you wrote in Phase 2, averaged over the batch.\n\n' +
      'Rather than computing the loss over all 1,500 images for each step, take small random batches: shuffle the indexes every epoch (one pass over the data) and walk through them 50 at a time. ' +
      'Each step is cheaper and the noise in the gradient even helps.\n\n' +
      code(`
const idx = tensor(batchIndexes);
const logits = model.forward(Xtr.indexSelect(0, idx));
const loss = crossEntropy(logits, idx.data.map((i) => ytr[i]));
`) +
      '\n\nAt the end, measure `accuracy(model.forward(Xte), test.y)` on the test split only.',
    hints: [
      'A good model: `new Sequential(new Linear(64, 64), new ReLU(), new Linear(64, 10))` with `new Adam(model.parameters(), { lr: 0.01 })`.',
      'Shuffle with Fisher-Yates using Math.random (it is seeded in tests): for i from n-1 down to 1, swap order[i] with order[floor(Math.random() * (i + 1))].',
      'About 15 epochs of batches of 50 is enough; that is 450 steps.',
      'Evaluate inside `noGrad(() => ...)`, and return `{ accuracy }` where accuracy is a number between 0 and 1.',
      'Near-complete:\n' +
        code(`
for (let epoch = 0; epoch < 15; epoch++) {
  const order = shuffled(train.y.length);
  for (let b = 0; b < order.length; b += 50) {
    const batch = order.slice(b, b + 50);
    opt.zeroGrad();
    const loss = crossEntropy(model.forward(Xtr.indexSelect(0, batch)), batch.map((i) => train.y[i]));
    loss.backward();
    opt.step();
  }
}
return { accuracy: noGrad(() => accuracy(model.forward(tensor(test.x)), test.y)) };
`),
    ],
    afterword:
      'This is the classic first project of deep learning, scaled down: the famous MNIST digits are 28×28 and 60,000 strong, and the same recipe reaches about 98% on them. ' +
      'Next, Phase 4 swaps images for text: the input becomes tokens and the classes become the next character.',
    js: jsSetup({
      starter: `import { tensor, manualSeed } from 'tensor';
import { noGrad } from 'autograd';
import { Sequential, Linear, ReLU, crossEntropy, accuracy } from 'nn';
import { Adam } from 'optim';
import { load } from 'data';

// Train on the training split, then return { accuracy } on the test split (0 to 1).
export async function train() {
  manualSeed(0);
  const { train, test } = await load('${DIGITS_DATASET}');
  const model = new Sequential(new Linear(64, 10));
  // TODO: a hidden layer, an optimizer and the minibatch training loop.
  return { accuracy: noGrad(() => accuracy(model.forward(tensor(test.x)), test.y)) };
}
`,
      modules: MODULES.data,
      datasets: [DIGITS_DATASET],
      training: true,
    }),
    tests: [metric('test accuracy at least 90%', 'train', [], { name: 'accuracy', min: 0.9 }, { timeoutMs: 120_000 })],
    requires: ['overfitting'],
  }),
];
