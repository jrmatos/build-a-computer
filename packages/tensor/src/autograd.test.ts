import { describe, expect, it } from 'vitest';
import { gradCheck, numericalGradient, type GradCheckOptions } from './autograd';
import { concat, noGrad, randn, Rng, stack, tensor, Tensor, triuMask, where } from './tensor';

const rng = new Rng(2024);
const r = (shape: number[]): Tensor => randn(shape, { rng, dtype: 'float64' });
/** Random values kept away from 0 (for log, sqrt, div, abs, relu kinks). */
const away = (shape: number[]): Tensor => {
  const t = r(shape);
  for (let i = 0; i < t.size; i++) t.data[i] = (t.data[i]! >= 0 ? 0.5 : -0.5) + t.data[i]!;
  return t;
};
const positive = (shape: number[]): Tensor => away(shape).abs();

/** Every differentiable op with inputs that make its gradient well defined. */
const cases: [string, (...x: Tensor[]) => Tensor, () => Tensor[], GradCheckOptions?][] = [
  ['add (broadcast)', (a, b) => a.add(b), () => [r([2, 3]), r([3])]],
  ['sub (broadcast)', (a, b) => a.sub(b), () => [r([2, 1, 3]), r([4, 1])]],
  ['mul (broadcast)', (a, b) => a.mul(b), () => [r([2, 3]), r([2, 1])]],
  ['div', (a, b) => a.div(b), () => [r([2, 3]), away([2, 3])]],
  ['add scalar', (a) => a.add(3).mul(2).sub(1).div(4), () => [r([3])]],
  ['maximum', (a, b) => a.maximum(b), () => [r([4, 3]), r([4, 3])]],
  ['minimum', (a, b) => a.minimum(b), () => [r([4, 3]), r([3])]],
  ['pow', (a) => a.pow(3), () => [r([5])]],
  ['pow fractional', (a) => a.pow(1.5), () => [positive([5])]],
  ['neg', (a) => a.neg(), () => [r([3])]],
  ['abs', (a) => a.abs(), () => [away([5])]],
  ['square', (a) => a.square(), () => [r([5])]],
  ['sqrt', (a) => a.sqrt(), () => [positive([5])]],
  ['exp', (a) => a.exp(), () => [r([5])]],
  ['log', (a) => a.log(), () => [positive([5])]],
  ['sin', (a) => a.sin(), () => [r([5])]],
  ['cos', (a) => a.cos(), () => [r([5])]],
  ['tanh', (a) => a.tanh(), () => [r([2, 3])]],
  ['sigmoid', (a) => a.sigmoid(), () => [r([2, 3])]],
  ['relu', (a) => a.relu(), () => [away([2, 3])]],
  ['gelu', (a) => a.gelu(), () => [r([2, 3])]],
  ['clamp', (a) => a.clamp(-0.3, 0.3), () => [away([6])]],
  ['maskedFill', (a) => a.maskedFill(triuMask(3, { dtype: 'float64' }), 0), () => [r([2, 3, 3])]],
  ['matmul 2d', (a, b) => a.matmul(b), () => [r([3, 4]), r([4, 2])]],
  ['matmul batched broadcast', (a, b) => a.matmul(b), () => [r([2, 3, 4]), r([4, 5])]],
  ['matmul both batched', (a, b) => a.matmul(b), () => [r([2, 1, 3, 4]), r([3, 4, 2])]],
  ['matmul vector', (a, b) => a.matmul(b), () => [r([3, 4]), r([4])]],
  ['dot', (a, b) => a.dot(b), () => [r([4]), r([4])]],
  ['sum all', (a) => a.sum(), () => [r([2, 3])]],
  ['sum axis', (a) => a.sum(1), () => [r([2, 3, 4])]],
  ['sum axes keepDims', (a) => a.sum([0, 2], true), () => [r([2, 3, 4])]],
  ['mean', (a) => a.mean(-1), () => [r([2, 3])]],
  ['variance', (a) => a.variance(-1), () => [r([2, 5])]],
  ['max axis', (a) => a.max(1), () => [r([3, 4])]],
  ['min all', (a) => a.min(), () => [r([3, 4])]],
  ['softmax', (a) => a.softmax(-1), () => [r([2, 5])]],
  ['softmax axis 0', (a) => a.softmax(0), () => [r([3, 2])]],
  ['logSoftmax', (a) => a.logSoftmax(), () => [r([3, 4])]],
  ['reshape', (a) => a.reshape([3, -1]).mul(a.reshape([3, 2])), () => [r([2, 3])]],
  ['permute', (a) => a.permute(2, 0, 1), () => [r([2, 3, 4])]],
  ['transpose', (a) => a.transpose(0, 2), () => [r([2, 3, 4])]],
  ['squeeze/unsqueeze', (a) => a.unsqueeze(1).squeeze(1), () => [r([2, 3])]],
  ['expandTo', (a) => a.expandTo([4, 2, 3]), () => [r([2, 1])]],
  ['slice', (a) => a.slice(1, 1, 3), () => [r([2, 4])]],
  ['concat', (a, b) => concat([a, b], 1), () => [r([2, 2]), r([2, 3])]],
  ['stack', (a, b) => stack([a, b], 0), () => [r([2, 3]), r([2, 3])]],
  ['indexSelect (repeats accumulate)', (a) => a.indexSelect(0, [2, 0, 2]), () => [r([3, 4])]],
  [
    'indexSelect inner axis',
    (a) =>
      a.indexSelect(
        1,
        tensor([
          [1, 1],
          [0, 2],
        ]),
      ),
    () => [r([2, 3])],
  ],
  [
    'gather',
    (a) =>
      a.gather(
        1,
        tensor([
          [2, 0],
          [1, 1],
        ]),
      ),
    () => [r([2, 3])],
  ],
  ['where', (a, b) => where(tensor([1, 0, 1]), a, b), () => [r([3]), r([3])]],
  // Passing through float32 rounds the nudge, so this one uses a big step (the op is linear).
  [
    'to float32 and back',
    (a) => a.to('float32').to('float64'),
    () => [r([3])],
    { eps: 1e-2, atol: 1e-4 },
  ],
  ['clone', (a) => a.clone().mul(a), () => [r([3])]],
  [
    'composite: layer norm',
    (x) => {
      const c = x.sub(x.mean(-1, true));
      return c.div(c.square().mean(-1, true).add(1e-5).sqrt());
    },
    () => [r([2, 6])],
  ],
  [
    'composite: attention',
    (q, k, v) =>
      q
        .matmul(k.transpose())
        .div(2)
        .maskedFill(triuMask(3, { dtype: 'float64' }), -Infinity)
        .softmax()
        .matmul(v),
    () => [r([2, 3, 4]), r([2, 3, 4]), r([2, 3, 4])],
  ],
];

describe('gradient checks in float64 (ML-02)', () => {
  for (const [name, f, inputs, options] of cases) {
    it(`${name}`, () => {
      const result = gradCheck(f, inputs(), options);
      expect(result.failure).toBeUndefined();
      expect(result.ok).toBe(true);
    });
  }

  it('catches a wrong gradient', () => {
    // A fake op whose backward claims d/dx = 1 for x², which is wrong.
    const badSquare = (x: Tensor): Tensor =>
      Tensor.fromOp(
        'badSquare',
        x.data.map((v) => v * v),
        x.shape,
        [x],
        (g) => [g],
      );
    const result = gradCheck(badSquare, [r([4])]);
    expect(result.ok).toBe(false);
    expect(result.failure).toBeDefined();
  });

  it('E-ML-05: gradient checks are noisy in float32 but pass in float64', () => {
    const values = [0.7, -1.3, 2.1, 0.4];
    const f = (x: Tensor): Tensor => x.tanh().mul(x).exp().sum();
    // Same function, same tolerance: float32 rounding swamps a small eps.
    const x32 = tensor(values);
    const x64 = tensor(values, { dtype: 'float64' });
    expect(gradCheck(f, [x32], { eps: 1e-6 }).ok).toBe(false);
    expect(gradCheck(f, [x64], { eps: 1e-6 }).ok).toBe(true);
  });
});

describe('autograd engine', () => {
  it('computes gradients of a small expression by hand', () => {
    // f = (a * b + b)^2 at a = 2, b = 3: f = 81, df/da = 2*9*3 = 54, df/db = 2*9*(2+1) = 54
    const a = tensor(2, { requiresGrad: true, dtype: 'float64' });
    const b = tensor(3, { requiresGrad: true, dtype: 'float64' });
    const f = a.mul(b).add(b).pow(2);
    expect(f.item()).toBe(81);
    f.backward();
    expect(a.grad!.item()).toBeCloseTo(54, 10);
    expect(b.grad!.item()).toBeCloseTo(54, 10);
  });

  it('accumulates when a tensor is used twice and across backward calls', () => {
    const x = tensor([1, 2], { requiresGrad: true });
    x.mul(x).sum().backward(); // d/dx x² = 2x
    expect(Array.from(x.grad!.data)).toEqual([2, 4]);
    x.sum().backward();
    expect(Array.from(x.grad!.data)).toEqual([3, 5]);
    x.zeroGrad();
    expect(x.grad).toBeNull();
  });

  it('sums broadcast gradients back to the input shape', () => {
    const bias = tensor([0, 0, 0], { requiresGrad: true });
    randn([4, 3], { rng }).add(bias).sum().backward();
    expect(Array.from(bias.grad!.data)).toEqual([4, 4, 4]);
  });

  it('noGrad stops recording', () => {
    const x = tensor([1], { requiresGrad: true });
    const y = noGrad(() => x.mul(2));
    expect(y.requiresGrad).toBe(false);
    expect(y.isLeaf).toBe(true);
    expect(x.mul(2).op).toBe('mul');
  });

  it('retainGrad keeps intermediate gradients; leaves only by default', () => {
    const x = tensor([1, 2], { requiresGrad: true });
    const h = x.mul(3).retainGrad();
    const z = x.mul(3);
    h.add(z).sum().backward();
    expect(Array.from(h.grad!.data)).toEqual([1, 1]);
    expect(z.grad).toBeNull();
  });

  it('detach cuts the graph', () => {
    const x = tensor([2], { requiresGrad: true });
    x.mul(x.detach()).sum().backward();
    expect(x.grad!.item()).toBe(2);
  });

  it('explains backward() misuse', () => {
    expect(() => tensor([1, 2]).sum().backward()).toThrow(/does not require a gradient/);
    const x = tensor([1, 2], { requiresGrad: true });
    expect(() => x.mul(2).backward()).toThrow(/single number/);
    // With an explicit output gradient a non-scalar works.
    x.mul(2).backward(tensor([1, 1]));
    expect(Array.from(x.grad!.data)).toEqual([2, 2]);
  });

  it('handles deep graphs without stack overflow', () => {
    const x = tensor([1], { requiresGrad: true, dtype: 'float64' });
    let y = x;
    for (let i = 0; i < 20000; i++) y = y.add(0);
    y.sum().backward();
    expect(x.grad!.item()).toBe(1);
  });

  it('numericalGradient matches a known derivative', () => {
    const x = tensor([0.5, -1], { dtype: 'float64' });
    const g = numericalGradient(() => x.square().sum(), x);
    expect(g[0]).toBeCloseTo(1, 6);
    expect(g[1]).toBeCloseTo(-2, 6);
  });
});
