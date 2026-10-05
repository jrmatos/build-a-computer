import { describe, expect, it } from 'vitest';
import {
  allClose,
  arange,
  concat,
  eye,
  full,
  linspace,
  manualSeed,
  matmul,
  ones,
  rand,
  randint,
  randn,
  Rng,
  sampleCategorical,
  stack,
  tensor,
  Tensor,
  triuMask,
  where,
  zeros,
} from './tensor';

/** Plain triple-loop matmul as the reference. */
function naiveMatmul(a: number[][], b: number[][]): number[][] {
  return a.map((row) => b[0]!.map((_, j) => row.reduce((s, v, k) => s + v * b[k]![j]!, 0)));
}

const close = (t: Tensor, want: unknown, tol = 1e-5): void => {
  expect(allClose(t, want as number[], tol, tol)).toBe(true);
};

describe('creation', () => {
  it('builds from nested arrays and infers the shape', () => {
    const t = tensor([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(t.shape).toEqual([2, 3]);
    expect(t.strides).toEqual([3, 1]);
    expect(t.dtype).toBe('float32');
    expect(t.get(1, 2)).toBe(6);
    expect(t.get(-1, 0)).toBe(4);
    expect(t.toArray()).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('builds from a flat list with a shape, and scalars', () => {
    expect(tensor([1, 2, 3, 4, 5, 6], { shape: [3, 2] }).toArray()).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    const s = tensor(7);
    expect(s.shape).toEqual([]);
    expect(s.item()).toBe(7);
    expect(tensor(new Float64Array([1, 2])).dtype).toBe('float32');
    expect(tensor([1, 2], { dtype: 'float64' }).data).toBeInstanceOf(Float64Array);
  });

  it('rejects ragged arrays and bad shapes', () => {
    expect(() => tensor([[1, 2], [3]])).toThrow(/ragged/);
    expect(() => tensor([1, 2, 3], { shape: [2, 2] })).toThrow();
    expect(() => zeros([2, -1])).toThrow(/Invalid shape/);
  });

  it('zeros, ones, full, eye, arange, linspace', () => {
    expect(zeros([2, 2]).toArray()).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(ones([3]).toArray()).toEqual([1, 1, 1]);
    expect(full([2], 2.5).toArray()).toEqual([2.5, 2.5]);
    expect(eye(3).toArray()).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(arange(5).toArray()).toEqual([0, 1, 2, 3, 4]);
    expect(arange(1, 2, 0.25).toArray()).toEqual([1, 1.25, 1.5, 1.75]);
    expect(arange(5, 0, -2).toArray()).toEqual([5, 3, 1]);
    close(linspace(0, 1, 5), [0, 0.25, 0.5, 0.75, 1]);
    expect(triuMask(3).toArray()).toEqual([
      [0, 1, 1],
      [0, 0, 1],
      [0, 0, 0],
    ]);
  });

  it('random tensors are reproducible from a seed', () => {
    const a = randn([4, 4], { rng: new Rng(42) });
    const b = randn([4, 4], { rng: new Rng(42) });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    manualSeed(7);
    const c = rand([10]);
    manualSeed(7);
    expect(Array.from(rand([10]).data)).toEqual(Array.from(c.data));
    for (const v of c.data) expect(v >= 0 && v < 1).toBe(true);
    const ints = randint(2, 5, [100], { rng: new Rng(1) });
    for (const v of ints.data) expect([2, 3, 4]).toContain(v);
  });

  it('randn has roughly mean 0 and std 1 (statistical, not exact: E-ML-02)', () => {
    const t = randn([20000], { rng: new Rng(3), dtype: 'float64' });
    expect(Math.abs(t.mean().item())).toBeLessThan(0.03);
    expect(Math.abs(Math.sqrt(t.variance().item()) - 1)).toBeLessThan(0.03);
  });

  it('toJSON gives { shape, data }', () => {
    expect(JSON.parse(JSON.stringify(tensor([[1, 2]])))).toEqual({ shape: [1, 2], data: [1, 2] });
    expect(String(tensor([1, 2]))).toContain('Tensor([2], float32)');
  });
});

describe('elementwise and broadcasting', () => {
  it('adds with NumPy broadcasting rules', () => {
    const a = tensor([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(a.add(tensor([10, 20, 30])).toArray()).toEqual([
      [11, 22, 33],
      [14, 25, 36],
    ]);
    expect(a.add(tensor([[100], [200]])).toArray()).toEqual([
      [101, 102, 103],
      [204, 205, 206],
    ]);
    expect(a.mul(2).toArray()).toEqual([
      [2, 4, 6],
      [8, 10, 12],
    ]);
    // [3,1] + [1,4] -> [3,4]
    expect(tensor([[0], [1], [2]]).add(tensor([[0, 10, 20, 30]])).shape).toEqual([3, 4]);
    expect(zeros([2, 1, 3]).add(zeros([4, 1])).shape).toEqual([2, 4, 3]);
  });

  it('explains shapes that cannot broadcast', () => {
    expect(() => zeros([2, 3]).add(zeros([4]))).toThrow(/cannot be broadcast/);
  });

  it('computes unary functions', () => {
    const x = tensor([-1, 0, 2]);
    expect(x.relu().toArray()).toEqual([0, 0, 2]);
    expect(x.abs().toArray()).toEqual([1, 0, 2]);
    expect(x.neg().toArray()).toEqual([1, -0, -2]);
    close(x.exp(), [Math.exp(-1), 1, Math.exp(2)]);
    close(x.tanh(), [Math.tanh(-1), 0, Math.tanh(2)]);
    close(x.sigmoid(), [1 / (1 + Math.E), 0.5, 1 / (1 + Math.exp(-2))]);
    close(x.gelu(), [-0.158808, 0, 1.954598], 1e-4);
    close(x.pow(2), [1, 0, 4]);
    close(x.clamp(-0.5, 1), [-0.5, 0, 1]);
    close(tensor([4, 9]).sqrt(), [2, 3]);
    close(tensor([1, Math.E]).log(), [0, 1]);
  });

  it('compares and selects', () => {
    const a = tensor([1, 5, 3]);
    expect(a.gt(2).toArray()).toEqual([0, 1, 1]);
    expect(a.eq(tensor([1, 0, 3])).toArray()).toEqual([1, 0, 1]);
    expect(a.maximum(3).toArray()).toEqual([3, 5, 3]);
    expect(a.minimum(3).toArray()).toEqual([1, 3, 3]);
    expect(where(a.gt(2), a, 0).toArray()).toEqual([0, 5, 3]);
    expect(a.maskedFill(tensor([0, 1, 0]), -1).toArray()).toEqual([1, -1, 3]);
  });

  it('mixing float32 and float64 gives float64', () => {
    expect(ones([2]).add(ones([2], { dtype: 'float64' })).dtype).toBe('float64');
    expect(ones([2]).to('float64').dtype).toBe('float64');
  });
});

describe('matmul', () => {
  it('matches a naive matmul (NumPy fixture)', () => {
    const a = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    const b = [
      [7, 8, 9, 10],
      [11, 12, 13, 14],
    ];
    expect(matmul(tensor(a), tensor(b)).toArray()).toEqual(naiveMatmul(a, b));
  });

  it('matches naive on random sizes that cross the block size', () => {
    const rng = new Rng(5);
    for (const [m, k, n] of [
      [1, 1, 1],
      [3, 70, 5],
      [65, 129, 66],
    ] as const) {
      const a = randn([m, k], { rng, dtype: 'float64' });
      const b = randn([k, n], { rng, dtype: 'float64' });
      const want = naiveMatmul(a.toArray() as number[][], b.toArray() as number[][]);
      close(a.matmul(b), want, 1e-9);
    }
  });

  it('batches and broadcasts leading axes', () => {
    const rng = new Rng(9);
    const a = randn([2, 3, 4, 5], { rng, dtype: 'float64' });
    const b = randn([5, 6], { rng, dtype: 'float64' });
    const c = a.matmul(b);
    expect(c.shape).toEqual([2, 3, 4, 6]);
    const a11 = a.slice(0, 1, 2).slice(1, 2, 3).reshape([4, 5]);
    close(c.slice(0, 1, 2).slice(1, 2, 3).reshape([4, 6]), a11.matmul(b).toArray(), 1e-12);
    const b2 = randn([3, 5, 2], { rng, dtype: 'float64' });
    expect(a.matmul(b2).shape).toEqual([2, 3, 4, 2]);
  });

  it('handles vectors', () => {
    const m = tensor([
      [1, 2],
      [3, 4],
    ]);
    expect(m.matmul(tensor([1, 1])).toArray()).toEqual([3, 7]);
    expect(tensor([1, 1]).matmul(m).toArray()).toEqual([4, 6]);
    expect(
      tensor([1, 2, 3])
        .dot(tensor([4, 5, 6]))
        .item(),
    ).toBe(32);
  });

  it('explains mismatched inner sizes', () => {
    expect(() => zeros([2, 3]).matmul(zeros([4, 2]))).toThrow(/inner sizes differ/);
  });
});

describe('reductions', () => {
  const t = tensor([
    [1, 5, 3],
    [4, 2, 6],
  ]);
  it('sum / mean / max / min along axes', () => {
    expect(t.sum().item()).toBe(21);
    expect(t.sum(0).toArray()).toEqual([5, 7, 9]);
    expect(t.sum(1).toArray()).toEqual([9, 12]);
    expect(t.sum(-1, true).shape).toEqual([2, 1]);
    expect(t.sum([0, 1]).item()).toBe(21);
    expect(t.mean(1).toArray()).toEqual([3, 4]);
    expect(t.max(1).toArray()).toEqual([5, 6]);
    expect(t.max().item()).toBe(6);
    expect(t.min(0).toArray()).toEqual([1, 2, 3]);
    expect(t.argmax(1).toArray()).toEqual([1, 2]);
    expect(t.argmax(0).toArray()).toEqual([1, 0, 1]);
    close(tensor([1, 2, 3, 4]).variance(), 1.25);
  });

  it('max keeps NaN visible', () => {
    expect(Number.isNaN(tensor([1, NaN, 3]).max().item())).toBe(true);
  });

  it('softmax rows sum to 1 and survive large values', () => {
    const s = tensor([
      [1, 2, 3],
      [1000, 1000, 1000],
    ]).softmax();
    close(s.sum(-1), [1, 1]);
    close(s.slice(0, 0, 1), [[0.09003057, 0.24472847, 0.66524096]]);
    close(
      s.slice(0, 0, 1).log(),
      tensor([[1, 2, 3]])
        .logSoftmax()
        .toArray(),
    );
    // softmax over axis 0
    close(tensor([[0], [0]]).softmax(0), [[0.5], [0.5]]);
    // a fully masked row gives NaN-free output
    const masked = tensor([[-Infinity, 0]]).softmax();
    close(masked, [[0, 1]]);
  });
});

describe('shape operations', () => {
  const t = arange(24).reshape([2, 3, 4]);
  it('reshape with -1, flatten, squeeze, unsqueeze', () => {
    expect(t.reshape([-1, 4]).shape).toEqual([6, 4]);
    expect(t.flatten().shape).toEqual([24]);
    expect(t.unsqueeze(0).shape).toEqual([1, 2, 3, 4]);
    expect(t.unsqueeze(-1).shape).toEqual([2, 3, 4, 1]);
    expect(t.unsqueeze(0).squeeze(0).shape).toEqual([2, 3, 4]);
    expect(() => t.reshape([5, -1])).toThrow();
  });

  it('transpose and permute move elements', () => {
    const p = t.permute(2, 0, 1);
    expect(p.shape).toEqual([4, 2, 3]);
    expect(p.get(3, 1, 2)).toBe(t.get(1, 2, 3));
    expect(t.transpose().get(1, 3, 2)).toBe(t.get(1, 2, 3));
    expect(tensor([[1, 2, 3]]).T.toArray()).toEqual([[1], [2], [3]]);
  });

  it('slice, concat, stack', () => {
    expect(t.slice(2, 1, 3).shape).toEqual([2, 3, 2]);
    expect(t.slice(2, 1, 3).get(1, 2, 0)).toBe(t.get(1, 2, 1));
    expect(t.slice(1, -1).shape).toEqual([2, 1, 4]);
    const parts = [t.slice(1, 0, 1), t.slice(1, 1, 3)];
    expect(concat(parts, 1).toJSON()).toEqual(t.toJSON());
    expect(Tensor.concat([ones([2]), zeros([3])]).toArray()).toEqual([1, 1, 0, 0, 0]);
    expect(stack([ones([2]), zeros([2])], 1).toArray()).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(() => concat([zeros([2, 2]), zeros([3, 3])])).toThrow(/differ/);
  });

  it('indexSelect (embedding lookup) and gather', () => {
    const table = tensor([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(table.indexSelect(0, [2, 0, 2]).toArray()).toEqual([
      [2, 2],
      [0, 0],
      [2, 2],
    ]);
    expect(table.indexSelect(0, tensor([[1, 2]])).shape).toEqual([1, 2, 2]);
    expect(() => table.indexSelect(0, [3])).toThrow(/out of range/);
    const logits = tensor([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(logits.gather(1, tensor([[2], [0]])).toArray()).toEqual([[3], [4]]);
  });
});

describe('sampling and comparison helpers', () => {
  it('sampleCategorical follows the probabilities', () => {
    const rng = new Rng(11);
    const counts = [0, 0, 0];
    const p = tensor([0.2, 0.5, 0.3]);
    for (let i = 0; i < 5000; i++) counts[sampleCategorical(p, rng)]!++;
    expect(counts[1]! / 5000).toBeGreaterThan(0.45);
    expect(counts[1]! / 5000).toBeLessThan(0.55);
  });

  it('E-ML-02: allClose uses tolerances, never exact float equality', () => {
    const a = tensor([0.1 + 0.2], { dtype: 'float64' });
    expect(a.item() === 0.3).toBe(false); // exact comparison would fail
    expect(allClose(a, [0.3])).toBe(true);
    expect(allClose(tensor([1]), [1.1])).toBe(false);
    expect(allClose(tensor([NaN]), [NaN])).toBe(false);
    expect(allClose(tensor([1, 2]), [1])).toBe(false);
    // float32 storage rounds 0.1, still close
    expect(allClose(tensor([0.1]), [0.1])).toBe(true);
  });
});
