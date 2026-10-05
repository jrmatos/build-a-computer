import { DIGITS_DATASET, NOISY_SINE } from '../../../src/track2/phase1-3/phase3';

/**
 * Reference main.js for Track 2 phase 3 (Networks), using the library
 * modules. Loaded by the game only on "Show solution" (ADR-007).
 */

export const PHASE3_SOLUTIONS: Record<string, string> = {
  'mlp-xor': `import { tensor, randn, zeros, manualSeed } from 'tensor';
import { noGrad } from 'autograd';

const X = tensor([[0, 0], [0, 1], [1, 0], [1, 1]]);
const Y = tensor([[0], [1], [1], [0]]);

export function train() {
  manualSeed(1);
  const W1 = randn([2, 8], { requiresGrad: true });
  const b1 = zeros([8], { requiresGrad: true });
  const W2 = randn([8, 1], { requiresGrad: true });
  const b2 = zeros([1], { requiresGrad: true });
  const params = [W1, b1, W2, b2];
  const lr = 1;
  let out, loss;
  for (let step = 0; step < 2000; step++) {
    out = X.matmul(W1).add(b1).tanh().matmul(W2).add(b2).sigmoid();
    loss = out.sub(Y).square().mean();
    loss.backward();
    noGrad(() => {
      for (const p of params) {
        for (let i = 0; i < p.size; i++) p.data[i] -= lr * p.grad.data[i];
        p.zeroGrad();
      }
    });
  }
  let right = 0;
  for (let i = 0; i < 4; i++) if ((out.data[i] > 0.5 ? 1 : 0) === Y.data[i]) right++;
  return { loss: loss.item(), accuracy: right / 4 };
}
`,

  'training-loop': `import { linspace, manualSeed } from 'tensor';
import { Sequential, Linear, Tanh, mse } from 'nn';
import { SGD, Adam } from 'optim';

const X = linspace(-3, 3, 64).reshape([64, 1]);
const Y = X.sin();

const makeModel = () => new Sequential(new Linear(1, 16), new Tanh(), new Linear(16, 1));

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

export function lrSweep() {
  const losses = [0.001, 0.1, 30].map((lr) => trainWith(lr, 300).loss);
  return { bestIndex: losses.indexOf(Math.min(...losses)) };
}

export function fit() {
  manualSeed(0);
  const model = makeModel();
  return loop(new Adam(model.parameters(), { lr: 0.01 }), model, 1500);
}
`,

  overfitting: `import { tensor, manualSeed } from 'tensor';
import { noGrad } from 'autograd';
import { Sequential, Linear, Tanh, mse } from 'nn';
import { Adam } from 'optim';

${NOISY_SINE}
export function split(xs, ys, valFraction) {
  const nTrain = xs.length - Math.round(xs.length * valFraction);
  return {
    train: { xs: xs.slice(0, nTrain), ys: ys.slice(0, nTrain) },
    val: { xs: xs.slice(nTrain), ys: ys.slice(nTrain) },
  };
}

const column = (xs) => tensor(xs).reshape([-1, 1]);

export function run() {
  manualSeed(0);
  const { xs, ys } = makeData();
  const { train, val } = split(xs, ys, 0.5);
  const Xtr = column(train.xs), Ytr = column(train.ys);
  const Xva = column(val.xs), Yva = column(val.ys);
  const model = new Sequential(new Linear(1, 32), new Tanh(), new Linear(32, 32), new Tanh(), new Linear(32, 1));
  const opt = new Adam(model.parameters(), { lr: 0.01 });
  const valLoss = () => noGrad(() => mse(model.forward(Xva), Yva).item());

  let best = { valLoss: Infinity, state: model.stateDict(), step: 0 };
  for (let step = 1; step <= 2000; step++) {
    opt.zeroGrad();
    const loss = mse(model.forward(Xtr), Ytr);
    loss.backward();
    opt.step();
    if (step % 10 === 0) {
      const v = valLoss();
      if (v < best.valLoss) best = { valLoss: v, state: model.stateDict(), step };
    }
  }
  const finalValLoss = valLoss();
  const trainLoss = noGrad(() => mse(model.forward(Xtr), Ytr).item());
  model.loadStateDict(best.state);
  const bestValLoss = valLoss();
  return { trainLoss, finalValLoss, bestValLoss, bestStep: best.step, worseBy: finalValLoss / bestValLoss };
}
`,

  'digit-recognizer': `import { tensor, manualSeed } from 'tensor';
import { noGrad } from 'autograd';
import { Sequential, Linear, ReLU, crossEntropy, accuracy } from 'nn';
import { Adam } from 'optim';
import { load } from 'data';

function shuffled(n) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export async function train() {
  manualSeed(0);
  const { train, test } = await load('${DIGITS_DATASET}');
  const Xtr = tensor(train.x);
  const model = new Sequential(new Linear(64, 64), new ReLU(), new Linear(64, 10));
  const opt = new Adam(model.parameters(), { lr: 0.01 });
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
}
`,
};
