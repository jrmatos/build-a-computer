import { describe, expect, it } from 'vitest';
import { Linear, mse, Sequential, Tanh } from './nn';
import {
  Adam,
  AdamW,
  assertFinite,
  assertFiniteGrads,
  clipGradNorm,
  clipGradValue,
  constantLR,
  cosineLR,
  exponentialLR,
  isFiniteTensor,
  loadCheckpoint,
  NonFiniteError,
  saveCheckpoint,
  SGD,
  stepLR,
  type Optimizer,
} from './optim';
import { randn, Rng, tensor, Tensor } from './tensor';

/** Minimizes (x - 3)² from x = 0 and returns x. */
function minimize(make: (params: Tensor[]) => Optimizer, steps: number): number {
  const x = tensor([0], { requiresGrad: true, dtype: 'float64' });
  const opt = make([x]);
  for (let i = 0; i < steps; i++) {
    opt.zeroGrad();
    x.sub(3).square().sum().backward();
    opt.step();
  }
  return x.item();
}

describe('optimizers', () => {
  it('SGD takes p -= lr * grad', () => {
    const p = tensor([1, 2], { requiresGrad: true });
    const opt = new SGD([p], { lr: 0.1 });
    p.mul(tensor([3, 4]))
      .sum()
      .backward();
    opt.step();
    expect(Array.from(p.data)).toEqual([Math.fround(1 - 0.3), Math.fround(2 - 0.4)]);
    expect(opt.stepCount).toBe(1);
  });

  it('SGD, momentum, Adam and AdamW all minimize a quadratic', () => {
    expect(minimize((p) => new SGD(p, { lr: 0.1 }), 100)).toBeCloseTo(3, 4);
    expect(minimize((p) => new SGD(p, { lr: 0.05, momentum: 0.9 }), 200)).toBeCloseTo(3, 3);
    expect(minimize((p) => new Adam(p, { lr: 0.1 }), 500)).toBeCloseTo(3, 2);
    expect(minimize((p) => new AdamW(p, { lr: 0.1, weightDecay: 0 }), 500)).toBeCloseTo(3, 2);
  });

  it('Adam first step moves each parameter by about lr', () => {
    const p = tensor([0, 0], { requiresGrad: true, dtype: 'float64' });
    const opt = new Adam([p], { lr: 0.01 });
    p.mul(tensor([5, -0.001], { dtype: 'float64' }))
      .sum()
      .backward();
    opt.step();
    expect(p.data[0]).toBeCloseTo(-0.01, 6);
    expect(p.data[1]).toBeCloseTo(0.01, 4);
  });

  it('AdamW decays weights even with zero gradient', () => {
    const p = tensor([1], { requiresGrad: true, dtype: 'float64' });
    const opt = new AdamW([p], { lr: 0.1, weightDecay: 0.5 });
    p.mul(0).sum().backward();
    opt.step();
    expect(p.item()).toBeCloseTo(0.95, 10);
  });

  it('rejects a non-positive learning rate', () => {
    expect(() => new SGD([], { lr: 0 })).toThrow(/lr/);
  });
});

describe('gradient clipping', () => {
  it('clipGradNorm scales to the max norm and returns the old norm', () => {
    const a = tensor([0, 0], { requiresGrad: true });
    const b = tensor([0], { requiresGrad: true });
    a.grad = tensor([3, 0]);
    b.grad = tensor([4]);
    expect(clipGradNorm([a, b], 1)).toBeCloseTo(5, 6);
    expect(a.grad.data[0]).toBeCloseTo(0.6, 6);
    expect(b.grad.data[0]).toBeCloseTo(0.8, 6);
    expect(clipGradNorm([a, b], 10)).toBeCloseTo(1, 6);
  });

  it('clipGradValue clamps each value', () => {
    const a = tensor([0, 0], { requiresGrad: true });
    a.grad = tensor([-5, 0.5]);
    clipGradValue([a], 1);
    expect(Array.from(a.grad.data)).toEqual([-1, 0.5]);
  });
});

describe('schedules', () => {
  it('constant, step, exponential, cosine with warm-up', () => {
    expect(constantLR(0.1)(1000)).toBe(0.1);
    expect(stepLR(1, 10, 0.5)(25)).toBe(0.25);
    expect(exponentialLR(1, 0.5)(3)).toBe(0.125);
    const cos = cosineLR(1, 110, { warmup: 10, minLr: 0.1 });
    expect(cos(0)).toBeCloseTo(0.1, 10);
    expect(cos(9)).toBeCloseTo(1, 10);
    expect(cos(10)).toBeCloseTo(1, 10);
    expect(cos(60)).toBeCloseTo(0.55, 10);
    expect(cos(110)).toBeCloseTo(0.1, 10);
    expect(cos(500)).toBeCloseTo(0.1, 10);
  });
});

describe('E-ML-03: NaN / Inf detection', () => {
  it('E-ML-03: a diverging run stops with advice to lower the learning rate', () => {
    const rng = new Rng(1);
    const model = new Linear(4, 1, { rng });
    const x = randn([16, 4], { rng }).mul(10);
    const y = randn([16, 1], { rng });
    const opt = new SGD(model.parameters(), { lr: 50 }); // far too high
    let error: unknown = null;
    for (let step = 0; step < 200 && !error; step++) {
      opt.zeroGrad();
      const loss = mse(model.forward(x), y);
      try {
        assertFinite(loss, { step, lr: opt.lr });
      } catch (e) {
        error = e;
        break;
      }
      loss.backward();
      opt.step();
    }
    expect(error).toBeInstanceOf(NonFiniteError);
    const message = (error as Error).message;
    expect(message).toMatch(/learning rate 50 is probably too high/);
    expect(message).toMatch(/try 5/);
    expect(message).toMatch(/at step \d+/);
  });

  it('E-ML-03: detects NaN and Inf in tensors, numbers and gradients', () => {
    expect(isFiniteTensor(tensor([1, 2]))).toBe(true);
    expect(isFiniteTensor(tensor([1, NaN]))).toBe(false);
    expect(isFiniteTensor(Infinity)).toBe(false);
    expect(() => assertFinite(NaN)).toThrow(/lower learning rate/);
    expect(() => assertFinite(tensor([Infinity]))).toThrow(/became Infinity/);
    const p = tensor([1], { requiresGrad: true });
    p.name = 'w';
    p.grad = tensor([NaN]);
    expect(() => assertFiniteGrads([p], { lr: 0.1 })).toThrow(/gradient of parameter w became NaN/);
  });
});

describe('E-ML-06: checkpoints', () => {
  function makeRun(seed: number): {
    model: Sequential;
    opt: Adam;
    train: (steps: number) => number[];
  } {
    const rng = new Rng(seed);
    const model = new Sequential(new Linear(3, 6, { rng }), new Tanh(), new Linear(6, 1, { rng }));
    const opt = new Adam(model.parameters(), { lr: 0.01 });
    const dataRng = new Rng(99);
    const x = randn([8, 3], { rng: dataRng });
    const y = randn([8, 1], { rng: dataRng });
    const train = (steps: number): number[] => {
      const losses: number[] = [];
      for (let i = 0; i < steps; i++) {
        opt.zeroGrad();
        const loss = mse(model.forward(x), y);
        loss.backward();
        opt.step();
        losses.push(loss.item());
      }
      return losses;
    };
    return { model, opt, train };
  }

  it('E-ML-06: resuming from a checkpoint continues exactly like an uninterrupted run', () => {
    const full = makeRun(1);
    const reference = full.train(20);

    const first = makeRun(1);
    first.train(10);
    const saved = JSON.parse(JSON.stringify(saveCheckpoint(first.model, first.opt)));
    expect(saved.step).toBe(10);

    // "Tab closed": a fresh model with different weights loads the checkpoint.
    const resumed = makeRun(2);
    expect(loadCheckpoint(saved, resumed.model, resumed.opt)).toBe(10);
    const rest = resumed.train(10);
    expect(rest).toEqual(reference.slice(10));
  });

  it('E-ML-06: refuses a checkpoint for another optimizer', () => {
    const run = makeRun(1);
    const sgd = new SGD(run.model.parameters(), { lr: 0.1 });
    expect(() => loadCheckpoint(saveCheckpoint(run.model, sgd), run.model, run.opt)).toThrow(
      /SGD, not Adam/,
    );
  });
});
