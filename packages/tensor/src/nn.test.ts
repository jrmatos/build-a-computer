import { describe, expect, it } from 'vitest';
import { gradCheck } from './autograd';
import {
  accuracy,
  binaryCrossEntropy,
  crossEntropy,
  Dropout,
  Embedding,
  GELU,
  LayerNorm,
  Linear,
  Module,
  mse,
  MultiHeadAttention,
  ReLU,
  Sequential,
  Sigmoid,
  sinusoidalPositions,
  Tanh,
  TransformerBlock,
} from './nn';
import { Adam, AdamW, assertFinite, clipGradNorm, cosineLR } from './optim';
import { allClose, noGrad, ones, randn, Rng, tensor, Tensor } from './tensor';

const f64 = { dtype: 'float64' as const };

describe('layers', () => {
  it('Linear maps [batch, in] to [batch, out] and finds its parameters', () => {
    const layer = new Linear(3, 2, { rng: new Rng(1) });
    expect(layer.forward(randn([5, 3])).shape).toEqual([5, 2]);
    expect(layer.forward(randn([4, 5, 3])).shape).toEqual([4, 5, 2]);
    expect(layer.namedParameters().map(([n]) => n)).toEqual(['weight', 'bias']);
    expect(layer.parameterCount()).toBe(8);
    expect(new Linear(3, 2, { bias: false }).parameters()).toHaveLength(1);
    // Init bound is 1/sqrt(in)
    for (const v of layer.weight.data) expect(Math.abs(v)).toBeLessThanOrEqual(1 / Math.sqrt(3));
  });

  it('Embedding looks up rows', () => {
    const emb = new Embedding(10, 4, { rng: new Rng(2) });
    const out = emb.forward(tensor([[1, 2, 3]]));
    expect(out.shape).toEqual([1, 3, 4]);
    expect(Array.from(out.data.slice(0, 4))).toEqual(Array.from(emb.weight.data.slice(4, 8)));
  });

  it('LayerNorm gives mean 0, variance 1 per row', () => {
    const ln = new LayerNorm(8);
    const y = ln.forward(
      randn([3, 8], { rng: new Rng(3) })
        .mul(5)
        .add(2),
    );
    expect(allClose(y.mean(-1), [0, 0, 0], 0, 1e-5)).toBe(true);
    expect(allClose(y.variance(-1), [1, 1, 1], 1e-3, 1e-3)).toBe(true);
  });

  it('activations and Sequential', () => {
    const x = tensor([-1, 2]);
    expect(new ReLU().forward(x).toArray()).toEqual([0, 2]);
    expect(allClose(new Tanh().forward(x), [Math.tanh(-1), Math.tanh(2)])).toBe(true);
    expect(allClose(new Sigmoid().forward(tensor([0])), [0.5])).toBe(true);
    expect(new GELU().forward(tensor([0])).item()).toBe(0);
    const net = new Sequential(new Linear(2, 4), new ReLU(), new Linear(4, 1));
    expect(net.forward(randn([3, 2])).shape).toEqual([3, 1]);
    expect(net.namedParameters().map(([n]) => n)).toEqual([
      'layers.0.weight',
      'layers.0.bias',
      'layers.2.weight',
      'layers.2.bias',
    ]);
  });

  it('Dropout is seeded, scales kept values, and is off in eval mode', () => {
    const x = ones([1000]);
    const a = new Dropout(0.5, { rng: new Rng(4) }).forward(x);
    const b = new Dropout(0.5, { rng: new Rng(4) }).forward(x);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const kept = Array.from(a.data).filter((v) => v !== 0);
    expect(new Set(kept)).toEqual(new Set([2]));
    expect(kept.length).toBeGreaterThan(400);
    expect(kept.length).toBeLessThan(600);
    const d = new Dropout(0.5).eval();
    expect(d.forward(x)).toBe(x);
    expect(() => new Dropout(1)).toThrow();
  });

  it('sinusoidal positions follow the formula', () => {
    const p = sinusoidalPositions(4, 6);
    expect(p.shape).toEqual([4, 6]);
    expect(p.get(0, 1)).toBe(1); // cos(0)
    expect(p.get(2, 0)).toBeCloseTo(Math.sin(2), 6);
    expect(p.get(3, 2)).toBeCloseTo(Math.sin(3 / 10000 ** (2 / 6)), 6);
  });
});

describe('attention', () => {
  it('is causal: an output never depends on later tokens', () => {
    const rng = new Rng(5);
    const mha = new MultiHeadAttention(8, 2, { rng });
    const x = randn([1, 5, 8], { rng });
    const y1 = mha.forward(x);
    // Change only the last token.
    const x2 = x.clone();
    for (let i = 4 * 8; i < 5 * 8; i++) x2.data[i] = 9;
    const y2 = mha.forward(x2);
    expect(allClose(y1.slice(1, 0, 4), y2.slice(1, 0, 4).toArray())).toBe(true);
    expect(allClose(y1.slice(1, 4, 5), y2.slice(1, 4, 5).toArray())).toBe(false);
    const w = mha.attentionWeights!;
    expect(w.shape).toEqual([1, 2, 5, 5]);
    expect(w.get(0, 0, 1, 2)).toBe(0); // future position masked
    expect(allClose(w.sum(-1), ones([1, 2, 5]))).toBe(true);
  });

  it('accepts [time, dModel] input and non-causal mode', () => {
    const mha = new MultiHeadAttention(4, 1, { causal: false });
    expect(mha.forward(randn([3, 4])).shape).toEqual([3, 4]);
    expect(mha.attentionWeights!.get(0, 0, 0, 2)).not.toBe(0);
    expect(() => new MultiHeadAttention(5, 2)).toThrow(/divisible/);
  });

  it('TransformerBlock keeps the shape', () => {
    const block = new TransformerBlock(8, 2, { rng: new Rng(6) });
    expect(block.forward(randn([2, 5, 8])).shape).toEqual([2, 5, 8]);
    expect(block.parameterCount()).toBe(4 * (8 * 8 + 8) + 2 * 2 * 8 + (8 * 32 + 32) + (32 * 8 + 8));
  });
});

describe('gradient checks for layers and losses (float64)', () => {
  const rng = new Rng(7);
  const params = (m: Module): Tensor[] => m.parameters();

  it('Linear', () => {
    const layer = new Linear(3, 2, { rng, ...f64 });
    const x = randn([4, 3], { rng, ...f64 });
    expect(gradCheck((x) => layer.forward(x), [x, ...params(layer)]).ok).toBe(true);
  });

  it('LayerNorm', () => {
    const ln = new LayerNorm(5, f64);
    ln.gamma.data.set([1, 2, 0.5, -1, 3]);
    const x = randn([3, 5], { rng, ...f64 });
    expect(gradCheck((x) => ln.forward(x), [x, ...params(ln)]).ok).toBe(true);
  });

  it('MultiHeadAttention', () => {
    const mha = new MultiHeadAttention(4, 2, { rng, ...f64 });
    const x = randn([2, 3, 4], { rng, ...f64 });
    const result = gradCheck((x) => mha.forward(x), [x, ...params(mha)]);
    expect(result.failure).toBeUndefined();
  });

  it('TransformerBlock', () => {
    const block = new TransformerBlock(4, 2, { rng, ...f64, mlpHidden: 6 });
    const x = randn([1, 3, 4], { rng, ...f64 });
    expect(gradCheck((x) => block.forward(x), [x, ...params(block)]).failure).toBeUndefined();
  });

  it('Embedding + crossEntropy', () => {
    const emb = new Embedding(5, 5, { rng, ...f64 });
    expect(gradCheck(() => crossEntropy(emb.forward([1, 3, 3]), [0, 4, 2]), params(emb)).ok).toBe(
      true,
    );
  });

  it('crossEntropy, mse, binaryCrossEntropy', () => {
    const logits = randn([2, 3, 4], { rng, ...f64 });
    expect(
      gradCheck(
        (l) =>
          crossEntropy(
            l,
            tensor([
              [0, 1, 2],
              [3, 3, 0],
            ]),
          ),
        [logits],
      ).ok,
    ).toBe(true);
    const pred = randn([5], { rng, ...f64 });
    expect(gradCheck((p) => mse(p, tensor([1, 2, 3, 4, 5], f64)), [pred]).ok).toBe(true);
    const prob = tensor([0.2, 0.7, 0.9], f64);
    expect(gradCheck((p) => binaryCrossEntropy(p, tensor([0, 1, 1], f64)), [prob]).ok).toBe(true);
  });

  it('crossEntropy has the textbook value', () => {
    // uniform logits over 4 classes: loss = ln 4
    expect(crossEntropy(tensor([[0, 0, 0, 0]]), [2]).item()).toBeCloseTo(Math.log(4), 6);
    expect(() => crossEntropy(tensor([[0, 0]]), [0, 1])).toThrow(/targets/);
    expect(
      accuracy(
        tensor([
          [1, 2],
          [3, 0],
        ]),
        [1, 1],
      ),
    ).toBe(0.5);
  });
});

describe('state dicts (E-ML-06)', () => {
  it('round-trips through JSON and checks shapes', () => {
    const a = new Sequential(
      new Linear(2, 3, { rng: new Rng(1) }),
      new Linear(3, 1, { rng: new Rng(1) }),
    );
    const b = new Sequential(
      new Linear(2, 3, { rng: new Rng(2) }),
      new Linear(3, 1, { rng: new Rng(2) }),
    );
    const x = randn([4, 2]);
    expect(allClose(a.forward(x), b.forward(x).toArray())).toBe(false);
    b.loadStateDict(JSON.parse(JSON.stringify(a.stateDict())));
    expect(allClose(a.forward(x), b.forward(x).toArray())).toBe(true);
    const wrong = new Sequential(new Linear(2, 4), new Linear(4, 1));
    expect(() => wrong.loadStateDict(a.stateDict())).toThrow(/shape/);
    expect(() => new Linear(2, 3).loadStateDict({})).toThrow(/missing/);
  });
});

describe('learning (end to end)', () => {
  it('a tiny MLP learns XOR', () => {
    const rng = new Rng(12);
    const x = tensor([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    const y = tensor([[0], [1], [1], [0]]);
    const model = new Sequential(new Linear(2, 8, { rng }), new Tanh(), new Linear(8, 1, { rng }));
    const opt = new Adam(model.parameters(), { lr: 0.05 });
    let loss = Infinity;
    for (let step = 0; step < 500; step++) {
      opt.zeroGrad();
      const l = mse(model.forward(x), y);
      assertFinite(l, { step, lr: opt.lr });
      l.backward();
      opt.step();
      loss = l.item();
    }
    expect(loss).toBeLessThan(0.01);
    const out = noGrad(() => model.forward(x));
    expect(Array.from(out.data).map((v) => (v > 0.5 ? 1 : 0))).toEqual([0, 1, 1, 0]);
  });

  it('a 1-layer transformer overfits a short string', () => {
    const text = 'hello world, hello tensor!';
    const chars = [...new Set(text)].sort();
    const ids = [...text].map((c) => chars.indexOf(c));
    const vocab = chars.length;
    const T = ids.length - 1;
    const input = tensor([ids.slice(0, T)]);
    const target = tensor([ids.slice(1)]);

    const rng = new Rng(3);
    const d = 32;
    class TinyGpt extends Module {
      tokens = new Embedding(vocab, d, { rng, std: 0.3 });
      positions = new Embedding(T, d, { rng, std: 0.3 });
      block = new TransformerBlock(d, 4, { rng });
      norm = new LayerNorm(d);
      head = new Linear(d, vocab, { rng });
      forward(idx: Tensor): Tensor {
        const t = idx.shape[1]!;
        const posIds = Array.from({ length: t }, (_, i) => i);
        const h = this.tokens.forward(idx).add(this.positions.forward(posIds));
        return this.head.forward(this.norm.forward(this.block.forward(h)));
      }
    }
    const model = new TinyGpt();
    const steps = 150;
    const opt = new AdamW(model.parameters(), { lr: 1e-2, weightDecay: 0 });
    const schedule = cosineLR(1e-2, steps, { warmup: 10, minLr: 1e-3 });
    const first = crossEntropy(model.forward(input), target).item();
    let loss = first;
    for (let step = 0; step < steps; step++) {
      opt.lr = schedule(step);
      opt.zeroGrad();
      const l = crossEntropy(model.forward(input), target);
      assertFinite(l, { step, lr: opt.lr });
      l.backward();
      clipGradNorm(model.parameters(), 1);
      opt.step();
      loss = l.item();
    }
    expect(first).toBeGreaterThan(2);
    expect(loss).toBeLessThan(0.1);
    // Greedy prediction reproduces the text.
    const logits = noGrad(() => model.forward(input));
    expect(accuracy(logits, target)).toBe(1);
  });
});
