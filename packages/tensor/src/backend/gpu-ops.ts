/**
 * Tensor operations on GPU-resident tensors. tensor.ts calls these when an
 * input lives on the GPU; each returns the GPU storage of the result (the
 * Tensor class wraps it and records autograd). Backward passes use the same
 * functions, so gradients never leave the GPU either.
 *
 * Float64 never runs here (gradient checks stay on the CPU, E-ML-05).
 */
import { broadcastShapes, broadcastStrides, formatShape, shapesEqual, sizeOf, stridesOf, type Shape } from '../shape';
import { Tensor } from '../tensor';
import * as K from './gpu-kernels';
import { floatBits, gpuRuntime, type GpuRuntime, type GpuStorage } from './gpu-runtime';
import { chooseMatmulTile, GpuLimitError, matmulPlan } from './wgsl';

const kernels = new Map<string, string>();
/** A kernel's WGSL, generated once. */
function kernel(key: string, make: () => string): string {
  let code = kernels.get(key);
  if (code === undefined) kernels.set(key, (code = make()));
  return code;
}

/** The runtime the GPU inputs live on (or the shared one). */
export function runtimeOf(...tensors: Tensor[]): GpuRuntime {
  for (const t of tensors) if (t.gpu) return t.gpu.runtime;
  const rt = gpuRuntime();
  if (!rt) throw new Error('No GPU is available: keep these tensors on the CPU.');
  return rt;
}

/** GPU storage for a tensor: its own, or a temporary upload of a CPU tensor. */
export function storageOf(t: Tensor, rt: GpuRuntime): GpuStorage {
  if (t.gpu) {
    if (t.gpu.runtime !== rt) throw new Error('These tensors live on different GPU devices.');
    return t.gpu;
  }
  if (t.dtype === 'float64') {
    throw new RangeError(
      'float64 tensors stay on the CPU (gradient checks, E-ML-05): call .float() before mixing them with GPU tensors.',
    );
  }
  return rt.upload(t.data, false);
}

/** Uploads integer indices (as u32 words). */
function uploadIndices(rt: GpuRuntime, idx: ArrayLike<number>): GpuStorage {
  return rt.upload(Uint32Array.from(idx), false);
}

/** A new GPU tensor filled with `value`. */
export function gpuFill(rt: GpuRuntime, shape: Shape, value: number): GpuStorage {
  const n = sizeOf(shape);
  const out = rt.alloc(n);
  rt.run(kernel('fill', K.fillKernel), [], [out], [n, floatBits(value)], n);
  return out;
}

/** Same reversed: c op x == x rop c. */
const REVERSED: Partial<Record<K.KernelScalarOp, K.KernelScalarOp>> = {
  sub: 'rsub',
  div: 'rdiv',
  gt: 'lt',
  ge: 'le',
  lt: 'gt',
  le: 'ge',
};

/** Elementwise binary op with broadcasting; a one-element CPU operand becomes a constant. */
export function gpuBinary(op: K.KernelBinaryOp, a: Tensor, b: Tensor, fill = 0): GpuStorage {
  const rt = runtimeOf(a, b);
  const outShape = broadcastShapes(a.shape, b.shape);
  const n = sizeOf(outShape);
  // A CPU scalar operand: no upload, the value goes in the parameters.
  if (op !== 'maskfill' && !b.gpu && b.size === 1 && a.size === n) {
    return gpuScalar(op, a, b.data[0]!, rt);
  }
  if (op !== 'maskfill' && !a.gpu && a.size === 1 && b.size === n) {
    const rop = (REVERSED[op as K.KernelScalarOp] ?? op) as K.KernelScalarOp;
    return gpuScalar(rop, b, a.data[0]!, rt);
  }
  const sa = storageOf(a, rt);
  const sb = storageOf(b, rt);
  const out = rt.alloc(n);
  const same = shapesEqual(a.shape, outShape) && shapesEqual(b.shape, outShape);
  const rank = same ? 0 : outShape.length;
  const params = new Array<number>(3 + 3 * rank).fill(0);
  params[0] = n;
  params[1] = rank;
  if (rank > 0) {
    outShape.forEach((d, i) => (params[2 + i] = d));
    broadcastStrides(a.shape, outShape).forEach((s, i) => (params[2 + rank + i] = s));
    broadcastStrides(b.shape, outShape).forEach((s, i) => (params[2 + 2 * rank + i] = s));
  }
  // Infinities become the largest finite float: some drivers mishandle inf in kernels.
  const finite = Number.isFinite(fill) ? fill : Math.sign(fill) * 3.4028234663852886e38;
  params[2 + 3 * rank] = floatBits(finite);
  rt.run(kernel(`binary_${op}`, () => K.binaryKernel(op)), [sa, sb], [out], params, n);
  return out;
}

/** y = op(x, c). */
export function gpuScalar(op: K.KernelScalarOp | K.KernelBinaryOp, x: Tensor, c: number, rt = runtimeOf(x)): GpuStorage {
  if (op === 'maskfill') throw new Error('maskfill needs a mask tensor.');
  const sx = storageOf(x, rt);
  const out = rt.alloc(x.size);
  rt.run(kernel(`scalar_${op}`, () => K.scalarKernel(op)), [sx], [out], [x.size, floatBits(c)], x.size);
  return out;
}

/** y = f(x) with up to two float parameters. */
export function gpuUnary(op: K.KernelUnaryOp, x: Tensor, p0 = 0, p1 = 0): GpuStorage {
  const rt = runtimeOf(x);
  const sx = storageOf(x, rt);
  const out = rt.alloc(x.size);
  rt.run(kernel(`unary_${op}`, () => K.unaryKernel(op)), [sx], [out], [x.size, floatBits(p0), floatBits(p1)], x.size);
  return out;
}

/** g * f'(x) given input x, output y and gradient g. */
export function gpuUnaryGrad(op: K.KernelUnaryOp, x: Tensor, y: Tensor, g: Tensor, p0 = 0, p1 = 0): GpuStorage {
  const rt = runtimeOf(x, y, g);
  const out = rt.alloc(x.size);
  rt.run(
    kernel(`unaryGrad_${op}`, () => K.unaryGradKernel(op)),
    [storageOf(x, rt), storageOf(y, rt), storageOf(g, rt)],
    [out],
    [x.size, floatBits(p0), floatBits(p1)],
    x.size,
  );
  return out;
}

/** Sum/max/min over the middle axis of [outer, len, inner]. */
export function gpuReduce(op: 'sum' | 'max' | 'min', x: Tensor, outer: number, len: number, inner: number): GpuStorage {
  const rt = runtimeOf(x);
  const out = rt.alloc(outer * inner);
  rt.run(kernel(`reduce_${op}`, () => K.reduceKernel(op)), [storageOf(x, rt)], [out], [outer, len, inner], outer * inner);
  return out;
}

/** Gradient of a max/min reduction. */
export function gpuReduceGrad(op: 'max' | 'min', x: Tensor, g: Tensor, outer: number, len: number, inner: number): GpuStorage {
  const rt = runtimeOf(x, g);
  const out = rt.alloc(x.size);
  rt.run(
    kernel(`reduceGrad_${op}`, () => K.reduceGradKernel(op)),
    [storageOf(x, rt), storageOf(g, rt)],
    [out],
    [outer, len, inner],
    outer * inner,
  );
  return out;
}

/** Index of the first max/min along the middle axis. */
export function gpuArg(op: 'argmax' | 'argmin', x: Tensor, outer: number, len: number, inner: number): GpuStorage {
  const rt = runtimeOf(x);
  const out = rt.alloc(outer * inner);
  rt.run(kernel(op, () => K.argKernel(op)), [storageOf(x, rt)], [out], [outer, len, inner], outer * inner);
  return out;
}

/**
 * Batched matmul. With `transA` the last two axes of `a` are [k, m] (it is
 * used transposed); with `transB` those of `b` are [n, k]. Batch axes must
 * match or be absent on one side (the caller expands otherwise).
 */
export function gpuMatmul(a: Tensor, b: Tensor, transA = false, transB = false): { storage: GpuStorage; shape: number[] } {
  const rt = runtimeOf(a, b);
  const aMat = transA ? [...a.shape.slice(0, -2), a.shape.at(-1)!, a.shape.at(-2)!] : a.shape;
  const bMat = transB ? [...b.shape.slice(0, -2), b.shape.at(-1)!, b.shape.at(-2)!] : b.shape;
  const plan = matmulPlan(aMat, bMat);
  if (!plan) throw new GpuLimitError(`matmul ${formatShape(a.shape)} @ ${formatShape(b.shape)} needs a general batch broadcast.`);
  const tile = chooseMatmulTile(rt.limits);
  const out = rt.alloc(plan.batch * plan.m * plan.n);
  const grid: [number, number, number] = [Math.ceil(plan.n / tile), Math.ceil(plan.m / tile), plan.batch];
  rt.run(
    kernel(`matmul${tile}`, () => K.matmulKernel(tile)),
    [storageOf(a, rt), storageOf(b, rt)],
    [out],
    [plan.m, plan.k, plan.n, plan.aStride, plan.bStride, transA ? 1 : 0, transB ? 1 : 0, 0],
    grid,
  );
  return { storage: out, shape: plan.outShape };
}

/** Y[i] = X[offset + sum(coord_d * strides_d)] over `shape`. */
export function gpuStrided(x: Tensor, shape: Shape, strides: readonly number[], offset = 0): GpuStorage {
  const rt = runtimeOf(x);
  const n = sizeOf(shape);
  const out = rt.alloc(n);
  const rank = shape.length;
  rt.run(kernel('strided', K.stridedKernel), [storageOf(x, rt)], [out], [n, rank, offset, ...shape, ...strides], n);
  return out;
}

/** Permuted copy: result axis i is x's axis perm[i]. */
export function gpuPermute(x: Tensor, perm: number[]): GpuStorage {
  const strides = stridesOf(x.shape);
  return gpuStrided(x, perm.map((p) => x.shape[p]!), perm.map((p) => strides[p]!));
}

/** Broadcast copy to a larger shape. */
export function gpuExpand(x: Tensor, shape: Shape): GpuStorage {
  return gpuStrided(x, shape, broadcastStrides(x.shape, shape));
}

/** Elements start..start+len-1 along axis `ax`. */
export function gpuSlice(x: Tensor, ax: number, start: number, len: number): GpuStorage {
  const strides = stridesOf(x.shape);
  const shape = x.shape.map((d, i) => (i === ax ? len : d));
  return gpuStrided(x, shape, strides, start * strides[ax]!);
}

/** Gradient of slice: g placed back into zeros of the input's shape [outer, d, inner]. */
export function gpuSliceGrad(g: Tensor, outer: number, d: number, inner: number, start: number, len: number): GpuStorage {
  const rt = runtimeOf(g);
  const n = outer * d * inner;
  const out = rt.alloc(n);
  rt.run(kernel('sliceGrad', K.sliceGradKernel), [storageOf(g, rt)], [out], [n, d, inner, start, len], n);
  return out;
}

/** Concatenation along `ax` of tensors with equal other axes. */
export function gpuConcat(parts: Tensor[], ax: number, shape: Shape): GpuStorage {
  const rt = runtimeOf(...parts);
  const out = rt.alloc(sizeOf(shape));
  const total = shape[ax]!;
  const inner = sizeOf(shape.slice(ax + 1));
  let offset = 0;
  for (const p of parts) {
    const len = p.shape[ax]!;
    if (p.size > 0)
      rt.run(kernel('insert', K.insertKernel), [storageOf(p, rt)], [out], [p.size, len, inner, total, offset], p.size);
    offset += len;
  }
  return out;
}

/** Elementwise select: x where mask is 0, else `value`. */
export function gpuMaskedFill(x: Tensor, mask: Tensor, value: number): GpuStorage {
  return gpuBinary('maskfill', x, mask, value);
}

/** indexSelect on [outer, d, inner] with a list of indices. */
export function gpuIndexSelect(x: Tensor, idx: Int32Array, outer: number, d: number, inner: number): GpuStorage {
  const rt = runtimeOf(x);
  const n = outer * idx.length * inner;
  const out = rt.alloc(n);
  if (n > 0)
    rt.run(kernel('indexRows', K.indexRowsKernel), [storageOf(x, rt), uploadIndices(rt, idx)], [out], [n, idx.length, inner, d], n);
  return out;
}

/** Y[i] = X[sources[i]]. */
export function gpuTake(x: Tensor, sources: Int32Array): GpuStorage {
  const rt = runtimeOf(x);
  const out = rt.alloc(sources.length);
  if (sources.length > 0)
    rt.run(kernel('take', K.takeKernel), [storageOf(x, rt), uploadIndices(rt, sources)], [out], [sources.length], sources.length);
  return out;
}

/**
 * Scatter-add of rows of `g` ([positions, inner]) into a zero tensor of
 * `count` rows: row dest[k] += g[k]. Groups positions by destination on the
 * CPU (the indices are known there) so the kernel needs no atomics.
 */
export function gpuScatterAdd(g: Tensor, dest: Int32Array, count: number, inner: number): GpuStorage {
  const rt = runtimeOf(g);
  const out = gpuFill(rt, [count * inner], 0);
  if (dest.length === 0 || inner === 0) return out;
  const order = Array.from(dest.keys()).sort((p, q) => dest[p]! - dest[q]! || p - q);
  const dests: number[] = [];
  const offsets: number[] = [];
  order.forEach((pos, k) => {
    if (k === 0 || dest[pos] !== dest[order[k - 1]!]) {
      dests.push(dest[pos]!);
      offsets.push(k);
    }
  });
  offsets.push(order.length);
  const lists = Uint32Array.from([...dests, ...offsets, ...order]);
  const unique = dests.length;
  rt.run(
    kernel('scatterAdd', K.scatterAddKernel),
    [storageOf(g, rt), rt.upload(lists, false)],
    [out],
    [unique, inner, unique, 2 * unique + 1],
    unique * inner,
  );
  return out;
}

/** Softmax or log-softmax over the last axis. */
export function gpuSoftmax(x: Tensor, log: boolean): GpuStorage {
  const rt = runtimeOf(x);
  const cols = x.shape[x.rank - 1] ?? 1;
  const rows = x.size / Math.max(1, cols);
  const out = rt.alloc(x.size);
  rt.run(kernel(log ? 'logSoftmax' : 'softmax', () => K.softmaxRowsKernel(log)), [storageOf(x, rt)], [out], [rows, cols], rows);
  return out;
}

/** Backward of softmax / log-softmax given the forward output y. */
export function gpuSoftmaxGrad(y: Tensor, g: Tensor, log: boolean): GpuStorage {
  const rt = runtimeOf(y, g);
  const cols = y.shape[y.rank - 1] ?? 1;
  const rows = y.size / Math.max(1, cols);
  const out = rt.alloc(y.size);
  rt.run(
    kernel(log ? 'logSoftmaxGrad' : 'softmaxGrad', () => K.softmaxGradKernel(log)),
    [storageOf(y, rt), storageOf(g, rt)],
    [out],
    [rows, cols],
    rows,
  );
  return out;
}

/** In-place optimizer update kernels. */
export function gpuAdam(
  w: GpuStorage,
  g: Tensor,
  m: GpuStorage,
  v: GpuStorage,
  h: { lr: number; beta1: number; beta2: number; eps: number; weightDecay: number; c1: number; c2: number; decoupled: boolean },
): void {
  const rt = w.runtime;
  rt.run(
    kernel('adam', K.adamKernel),
    [storageOf(g, rt)],
    [w, m, v],
    [
      w.count,
      floatBits(h.lr),
      floatBits(h.beta1),
      floatBits(h.beta2),
      floatBits(h.eps),
      floatBits(h.weightDecay),
      floatBits(h.c1),
      floatBits(h.c2),
      h.decoupled ? 1 : 0,
    ],
    w.count,
  );
}

export function gpuSgd(w: GpuStorage, g: Tensor, velocity: GpuStorage, lr: number, momentum: number, weightDecay: number): void {
  const rt = w.runtime;
  rt.run(
    kernel('sgd', K.sgdKernel),
    [storageOf(g, rt)],
    [w, velocity],
    [w.count, floatBits(lr), floatBits(momentum), floatBits(weightDecay)],
    w.count,
  );
}

/** A one-element GPU flag: 1 if any value of x is NaN or infinite. */
export function gpuNonFinite(x: Tensor): GpuStorage {
  const rt = runtimeOf(x);
  const flag = gpuFill(rt, [1], 0);
  if (x.size > 0) rt.run(kernel('nonFinite', K.nonFiniteKernel), [storageOf(x, rt)], [flag], [x.size], x.size);
  return flag;
}

// ---------------------------------------------------------------------------
// Fused layers with their own backward kernels
// ---------------------------------------------------------------------------

/** Layer norm with scale and shift over the last axis, as one autograd op. */
export function layerNormOp(x: Tensor, gamma: Tensor, beta: Tensor, eps: number): Tensor {
  const rt = runtimeOf(x, gamma, beta);
  const cols = x.shape[x.rank - 1] ?? 1;
  if (gamma.size !== cols || beta.size !== cols)
    throw new RangeError(`layerNorm: gamma/beta of size ${gamma.size} for rows of ${cols}.`);
  const rows = x.size / Math.max(1, cols);
  const y = rt.alloc(x.size);
  const stats = rt.alloc(2 * rows);
  const sx = storageOf(x, rt);
  const sg = storageOf(gamma, rt);
  rt.run(
    kernel('layerNorm', K.layerNormKernel),
    [sx, sg, storageOf(beta, rt)],
    [y, stats],
    [rows, cols, floatBits(eps)],
    rows,
  );
  return Tensor.fromOp('layerNorm', y, x.shape, [x, gamma, beta], (g) => {
    const sgrad = storageOf(g, rt);
    let dx: Tensor | null = null;
    if (x.requiresGrad) {
      const out = rt.alloc(x.size);
      rt.run(kernel('layerNormGrad', K.layerNormGradKernel), [sx, sg, stats, sgrad], [out], [rows, cols], rows);
      dx = new Tensor(out, x.shape);
    }
    let dgamma: Tensor | null = null;
    let dbeta: Tensor | null = null;
    if (gamma.requiresGrad || beta.requiresGrad) {
      const og = rt.alloc(cols);
      const ob = rt.alloc(cols);
      rt.run(kernel('layerNormParamGrad', K.layerNormParamGradKernel), [sx, stats, sgrad], [og, ob], [rows, cols], cols);
      dgamma = gamma.requiresGrad ? new Tensor(og, gamma.shape) : null;
      dbeta = beta.requiresGrad ? new Tensor(ob, beta.shape) : null;
    }
    return [dx, dgamma, dbeta];
  });
}

/** Per-row cross-entropy of [rows, classes] logits against class ids, as one autograd op. */
export function crossEntropyRowsOp(logits: Tensor, ids: Int32Array): Tensor {
  const rt = runtimeOf(logits);
  const [rows, cols] = logits.shape as [number, number];
  for (const t of ids)
    if (t < 0 || t >= cols) throw new RangeError(`crossEntropy: target ${t} out of range (classes ${cols}).`);
  const loss = rt.alloc(rows);
  const lse = rt.alloc(rows);
  const sx = storageOf(logits, rt);
  const targets = uploadIndices(rt, ids);
  rt.run(kernel('crossEntropy', K.crossEntropyKernel), [sx, targets], [loss, lse], [rows, cols], rows);
  return Tensor.fromOp('crossEntropy', loss, [rows], [logits], (g) => {
    const out = rt.alloc(rows * cols);
    rt.run(
      kernel('crossEntropyGrad', K.crossEntropyGradKernel),
      [sx, targets, lse, storageOf(g, rt)],
      [out],
      [rows, cols],
      rows * cols,
    );
    return [new Tensor(out, logits.shape)];
  });
}
