/**
 * WGSL kernels for GPU-resident tensors (forward and backward passes and
 * optimizer updates). Generated as strings; gpu-runtime.ts compiles and
 * dispatches them, and gpu-emulator.ts runs a JavaScript twin of each one
 * so the host logic is testable in Node.
 *
 * Conventions shared by every kernel here:
 * - the first line is `// kernel: <name>` (the emulator keys on it);
 * - bindings: inputs (read) first, then outputs (read_write), then the
 *   parameter words `P: array<u32>` last; floats travel as bit patterns
 *   (bitcast<f32>);
 * - 1-D kernels use WORKGROUP threads per group and rebuild the flat index
 *   from a 2-D grid (see dispatch1D in wgsl.ts);
 * - every binding is read somewhere, because layout: 'auto' drops unused ones;
 * - never name anything `meta` (a reserved word in WGSL).
 */
import { WORKGROUP } from './wgsl';

export type KernelBinaryOp =
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'maximum'
  | 'minimum'
  | 'eq'
  | 'gt'
  | 'ge'
  | 'lt'
  | 'le'
  | 'maskfill';

export type KernelScalarOp =
  | 'add'
  | 'sub'
  | 'rsub'
  | 'mul'
  | 'div'
  | 'rdiv'
  | 'maximum'
  | 'minimum'
  | 'eq'
  | 'gt'
  | 'ge'
  | 'lt'
  | 'le';

export type KernelUnaryOp =
  | 'neg'
  | 'exp'
  | 'log'
  | 'sqrt'
  | 'abs'
  | 'tanh'
  | 'sigmoid'
  | 'relu'
  | 'gelu'
  | 'square'
  | 'sin'
  | 'cos'
  | 'copy'
  | 'clamp'
  | 'pow';

const B2F = (cond: string): string => `select(0.0, 1.0, ${cond})`;

export const KERNEL_BINARY: Record<KernelBinaryOp, string> = {
  add: 'a + b',
  sub: 'a - b',
  mul: 'a * b',
  div: 'a / b',
  maximum: 'select(b, a, a >= b)',
  minimum: 'select(b, a, a <= b)',
  eq: B2F('a == b'),
  gt: B2F('a > b'),
  ge: B2F('a >= b'),
  lt: B2F('a < b'),
  le: B2F('a <= b'),
  // b is the mask; the fill value travels in the parameters.
  maskfill: 'select(a, fillValue, b != 0.0)',
};

export const KERNEL_SCALAR: Record<KernelScalarOp, string> = {
  add: 'x + c',
  sub: 'x - c',
  rsub: 'c - x',
  mul: 'x * c',
  div: 'x / c',
  rdiv: 'c / x',
  maximum: 'select(c, x, x >= c)',
  minimum: 'select(c, x, x <= c)',
  eq: B2F('x == c'),
  gt: B2F('x > c'),
  ge: B2F('x >= c'),
  lt: B2F('x < c'),
  le: B2F('x <= c'),
};

// p0, p1: float parameters (clamp bounds, pow exponent). tanh is clamped:
// some drivers compute it via exp() and return NaN for large |x|.
const GELU_C = '0.7978845608';
export const KERNEL_UNARY: Record<KernelUnaryOp, string> = {
  neg: '-x',
  exp: 'exp(x)',
  log: 'log(x)',
  sqrt: 'sqrt(x)',
  abs: 'abs(x)',
  tanh: 'tanh(clamp(x, -15.0, 15.0))',
  sigmoid: '1.0 / (1.0 + exp(-x))',
  relu: 'max(x, 0.0)',
  gelu: `0.5 * x * (1.0 + tanh(clamp(${GELU_C} * (x + 0.044715 * x * x * x), -15.0, 15.0)))`,
  square: 'x * x',
  sin: 'sin(x)',
  cos: 'cos(x)',
  copy: 'x',
  clamp: 'min(p1, max(p0, x))',
  pow: 'powi(x, p0)',
};

/** g * d(op)/dx, given x (input), y (output) and g (output gradient). */
export const KERNEL_UNARY_GRAD: Record<KernelUnaryOp, string> = {
  neg: '-g',
  exp: 'g * y',
  log: 'g / x',
  sqrt: 'g * 0.5 / y',
  abs: 'g * sign(x)',
  tanh: 'g * (1.0 - y * y)',
  sigmoid: 'g * y * (1.0 - y)',
  relu: 'select(0.0, g, x > 0.0)',
  gelu: `g * geluGrad(x)`,
  square: 'g * 2.0 * x',
  sin: 'g * cos(x)',
  cos: '-g * sin(x)',
  copy: 'g',
  clamp: 'select(0.0, g, x >= p0 && x <= p1)',
  pow: 'g * p0 * powi(x, p0 - 1.0)',
};

const ENTRY = `@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>)`;
const INDEX = `let i = gid.x + gid.y * nwg.x * ${WORKGROUP}u;`;

/** x^e that also works for negative x with an integer exponent (WGSL pow needs x >= 0). */
const POWI = `fn powi(x: f32, e: f32) -> f32 {
  if (e == 0.0) { return 1.0; }
  if (e == 1.0) { return x; }
  if (e == 2.0) { return x * x; }
  let r = pow(abs(x), e);
  if (x >= 0.0) { return r; }
  // Not a number, built at run time: WGSL rejects such a constant.
  if (fract(e) != 0.0) { return bitcast<f32>(0x7fc00000u | (P[0] & 0u)); }
  let odd = fract(e * 0.5) != 0.0;
  return select(r, -r, odd);
}`;

const GELU_GRAD = `fn geluGrad(x: f32) -> f32 {
  let t = tanh(clamp(${GELU_C} * (x + 0.044715 * x * x * x), -15.0, 15.0));
  return 0.5 * (1.0 + t) + 0.5 * x * (1.0 - t * t) * ${GELU_C} * (1.0 + 3.0 * 0.044715 * x * x);
}`;

type Access = 'read' | 'read_write';
type Elem = 'f32' | 'u32';

/** Binding declarations: [name, access, element type] in binding order, then P. */
function bindings(list: [string, Access, Elem?][]): string {
  const lines = list.map(
    ([name, access, elem], k) =>
      `@group(0) @binding(${k}) var<storage, ${access}> ${name}: array<${elem ?? 'f32'}>;`,
  );
  lines.push(`@group(0) @binding(${list.length}) var<storage, read> P: array<u32>;`);
  return lines.join('\n');
}

const head = (name: string): string => `// kernel: ${name}\n`;
const F = (k: number): string => `bitcast<f32>(P[${k}])`;

/** Y[i] = value. P = [n, value]. */
export function fillKernel(): string {
  return `${head('fill')}${bindings([['Y', 'read_write']])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  Y[i] = ${F(1)};
}
`;
}

/**
 * Broadcast binary op. P = [n, rank, shape[rank], aStrides[rank],
 * bStrides[rank], fillValue]. rank 0 means "same shape, contiguous".
 */
export function binaryKernel(op: KernelBinaryOp): string {
  return `${head(`binary_${op}`)}${bindings([
    ['A', 'read'],
    ['B', 'read'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let rank = P[1];
  var ia = i;
  var ib = i;
  if (rank > 0u) {
    var rest = i;
    ia = 0u;
    ib = 0u;
    for (var d = 0u; d < rank; d = d + 1u) {
      let ax = rank - 1u - d;
      let size = P[2u + ax];
      let coord = rest % size;
      rest = rest / size;
      ia = ia + coord * P[2u + rank + ax];
      ib = ib + coord * P[2u + 2u * rank + ax];
    }
  }
  let fillValue = bitcast<f32>(P[2u + 3u * rank]);
  let a = A[ia];
  let b = B[ib];
  Y[i] = ${KERNEL_BINARY[op]};
}
`;
}

/** y = op(x, c) with a constant c. P = [n, c]. */
export function scalarKernel(op: KernelScalarOp): string {
  return `${head(`scalar_${op}`)}${bindings([
    ['X', 'read'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let c = ${F(1)};
  let x = X[i];
  Y[i] = ${KERNEL_SCALAR[op]};
}
`;
}

/** y = f(x). P = [n, p0, p1]. */
export function unaryKernel(op: KernelUnaryOp): string {
  return `${head(`unary_${op}`)}${bindings([
    ['X', 'read'],
    ['Y', 'read_write'],
  ])}

${POWI}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let p0 = ${F(1)};
  let p1 = ${F(2)};
  let x = X[i];
  Y[i] = ${KERNEL_UNARY[op]};
}
`;
}

/** dx = g * f'(x) from the input X, output Y and gradient G. P = [n, p0, p1]. */
export function unaryGradKernel(op: KernelUnaryOp): string {
  return `${head(`unaryGrad_${op}`)}${bindings([
    ['X', 'read'],
    ['Yv', 'read'],
    ['G', 'read'],
    ['DX', 'read_write'],
  ])}

${POWI}

${GELU_GRAD}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let p0 = ${F(1)};
  let p1 = ${F(2)};
  let x = X[i];
  let y = Yv[i];
  let g = G[i];
  DX[i] = ${KERNEL_UNARY_GRAD[op]};
}
`;
}

/** Reduces the middle axis of [outer, len, inner]. P = [outer, len, inner]. */
export function reduceKernel(op: 'sum' | 'max' | 'min'): string {
  const combine = { sum: 'acc + v', max: 'max(acc, v)', min: 'min(acc, v)' }[op];
  return `${head(`reduce_${op}`)}${bindings([
    ['X', 'read'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0] * P[2]) { return; }
  let o = i / P[2];
  let j = i % P[2];
  let base = o * P[1] * P[2] + j;
  var acc = ${op === 'sum' ? '0.0' : 'X[base]'};
  for (var r = ${op === 'sum' ? '0u' : '1u'}; r < P[1]; r = r + 1u) {
    let v = X[base + r * P[2]];
    acc = ${combine};
  }
  Y[i] = acc;
}
`;
}

/**
 * Index of the first max (or min) along the middle axis, as a float.
 * P = [outer, len, inner].
 */
export function argKernel(op: 'argmax' | 'argmin'): string {
  const better = op === 'argmax' ? 'v > best' : 'v < best';
  return `${head(op)}${bindings([
    ['X', 'read'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0] * P[2]) { return; }
  let o = i / P[2];
  let j = i % P[2];
  let base = o * P[1] * P[2] + j;
  var best = X[base];
  var at = 0u;
  for (var r = 1u; r < P[1]; r = r + 1u) {
    let v = X[base + r * P[2]];
    if (${better}) { best = v; at = r; }
  }
  Y[i] = f32(at);
}
`;
}

/**
 * Gradient of a max/min reduction: the output gradient goes to the first
 * position that held the extreme. One thread per output. P = [outer, len, inner].
 */
export function reduceGradKernel(op: 'max' | 'min'): string {
  const better = op === 'max' ? 'v > best' : 'v < best';
  return `${head(`reduceGrad_${op}`)}${bindings([
    ['X', 'read'],
    ['G', 'read'],
    ['DX', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0] * P[2]) { return; }
  let o = i / P[2];
  let j = i % P[2];
  let base = o * P[1] * P[2] + j;
  var best = X[base];
  var at = 0u;
  for (var r = 1u; r < P[1]; r = r + 1u) {
    let v = X[base + r * P[2]];
    if (${better}) { best = v; at = r; }
  }
  let g = G[i];
  for (var r = 0u; r < P[1]; r = r + 1u) {
    DX[base + r * P[2]] = select(0.0, g, r == at);
  }
}
`;
}

/**
 * Batched tiled matmul with optional transposed operands.
 * P = [M, K, N, aBatchStride, bBatchStride, transA, transB, 0].
 * Not transposed: A is [M, K], B is [K, N]; transposed: A is [K, M], B is [N, K].
 */
export function matmulKernel(tile: number): string {
  return `${head('matmul')}${bindings([
    ['A', 'read'],
    ['B', 'read'],
    ['C', 'read_write'],
  ])}

const TILE: u32 = ${tile}u;
var<workgroup> tileA: array<array<f32, ${tile}>, ${tile}>;
var<workgroup> tileB: array<array<f32, ${tile}>, ${tile}>;

@compute @workgroup_size(${tile}, ${tile}, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let M = P[0];
  let K = P[1];
  let N = P[2];
  let transA = P[5] != 0u;
  let transB = P[6] != 0u;
  let row = wg.y * TILE + lid.y;
  let col = wg.x * TILE + lid.x;
  let aBase = wg.z * P[3];
  let bBase = wg.z * P[4];
  var acc = 0.0;
  let tiles = (K + TILE - 1u) / TILE;
  for (var t = 0u; t < tiles; t = t + 1u) {
    let ak = t * TILE + lid.x;
    let bk = t * TILE + lid.y;
    var av = 0.0;
    if (row < M && ak < K) {
      av = A[aBase + select(row * K + ak, ak * M + row, transA)];
    }
    var bv = 0.0;
    if (bk < K && col < N) {
      bv = B[bBase + select(bk * N + col, col * K + bk, transB)];
    }
    tileA[lid.y][lid.x] = av;
    tileB[lid.y][lid.x] = bv;
    workgroupBarrier();
    for (var k = 0u; k < TILE; k = k + 1u) { acc = acc + tileA[lid.y][k] * tileB[k][lid.x]; }
    workgroupBarrier();
  }
  if (row < M && col < N) { C[wg.z * M * N + row * N + col] = acc; }
}
`;
}

/**
 * Strided copy: Y[i] = X[offset + sum(coord_d * stride_d)] over the output
 * shape. Serves permute, expand (stride 0) and slice (offset).
 * P = [n, rank, offset, shape[rank], strides[rank]].
 */
export function stridedKernel(): string {
  return `${head('strided')}${bindings([
    ['X', 'read'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let rank = P[1];
  var rest = i;
  var src = P[2];
  for (var d = 0u; d < rank; d = d + 1u) {
    let ax = rank - 1u - d;
    let size = P[3u + ax];
    src = src + (rest % size) * P[3u + rank + ax];
    rest = rest / size;
  }
  Y[i] = X[src];
}
`;
}

/**
 * Gradient of slice along one axis: zeros outside [start, start + len).
 * Output is the input's shape [outer, d, inner]. P = [n, d, inner, start, len].
 */
export function sliceGradKernel(): string {
  return `${head('sliceGrad')}${bindings([
    ['G', 'read'],
    ['DX', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let inner = P[2];
  let c = i % inner;
  let r = i / inner;
  let j = r % P[1];
  let o = r / P[1];
  var v = 0.0;
  if (j >= P[3] && j < P[3] + P[4]) { v = G[(o * P[4] + j - P[3]) * inner + c]; }
  DX[i] = v;
}
`;
}

/**
 * Writes X ([outer, len, inner]) into Y ([outer, total, inner]) at offset
 * along the middle axis (one part of a concat). P = [n, len, inner, total, offset].
 */
export function insertKernel(): string {
  return `${head('insert')}${bindings([
    ['X', 'read'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let inner = P[2];
  let c = i % inner;
  let r = i / inner;
  let j = r % P[1];
  let o = r / P[1];
  Y[(o * P[3] + P[4] + j) * inner + c] = X[i];
}
`;
}

/**
 * indexSelect: Y[o, j, c] = X[o, IDX[j], c] for X [outer, d, inner].
 * P = [n, nIdx, inner, d].
 */
export function indexRowsKernel(): string {
  return `${head('indexRows')}${bindings([
    ['X', 'read'],
    ['IDX', 'read', 'u32'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let inner = P[2];
  let c = i % inner;
  let r = i / inner;
  let j = r % P[1];
  let o = r / P[1];
  Y[i] = X[(o * P[3] + IDX[j]) * inner + c];
}
`;
}

/** Y[i] = X[SRC[i]]. P = [n]. */
export function takeKernel(): string {
  return `${head('take')}${bindings([
    ['X', 'read'],
    ['SRC', 'read', 'u32'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  Y[i] = X[SRC[i]];
}
`;
}

/**
 * Scatter-add without atomics (the backward of indexSelect and gather): the
 * host groups the positions by destination (CSR lists, built on the CPU from
 * the known indices), so each thread sums its own destination.
 * L = [dests[nUnique], offsets[nUnique + 1], positions[...]] (u32).
 * DX[dests[u] * inner + c] = sum over k of G[positions[k] * inner + c].
 * P = [nUnique, inner, offsetsStart, positionsStart]. DX is zero-filled first.
 */
export function scatterAddKernel(): string {
  return `${head('scatterAdd')}${bindings([
    ['G', 'read'],
    ['L', 'read', 'u32'],
    ['DX', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  let inner = P[1];
  if (i >= P[0] * inner) { return; }
  let u = i / inner;
  let c = i % inner;
  var s = 0.0;
  let first = L[P[2] + u];
  let last = L[P[2] + u + 1u];
  for (var k = first; k < last; k = k + 1u) {
    s = s + G[L[P[3] + k] * inner + c];
  }
  DX[L[u] * inner + c] = s;
}
`;
}

/** Softmax (or log-softmax) over the last axis of [rows, cols]; one thread per row. P = [rows, cols]. */
export function softmaxRowsKernel(log: boolean): string {
  const write = log ? 'X[base + c] - m - log(s)' : 'exp(X[base + c] - m) / s';
  return `${head(log ? 'logSoftmax' : 'softmax')}${bindings([
    ['X', 'read'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let cols = P[1];
  let base = i * cols;
  var m = X[base];
  for (var c = 1u; c < cols; c = c + 1u) { m = max(m, X[base + c]); }
  var s = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { s = s + exp(X[base + c] - m); }
  for (var c = 0u; c < cols; c = c + 1u) { Y[base + c] = ${write}; }
}
`;
}

/**
 * Backward of softmax (dx = y * (g - sum(g * y))) or log-softmax
 * (dx = g - exp(y) * sum(g)) over rows. P = [rows, cols].
 */
export function softmaxGradKernel(log: boolean): string {
  const acc = log ? 'G[base + c]' : 'G[base + c] * Yv[base + c]';
  const write = log
    ? 'G[base + c] - exp(Yv[base + c]) * s'
    : 'Yv[base + c] * (G[base + c] - s)';
  return `${head(log ? 'logSoftmaxGrad' : 'softmaxGrad')}${bindings([
    ['Yv', 'read'],
    ['G', 'read'],
    ['DX', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let cols = P[1];
  let base = i * cols;
  var s = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { s = s + ${acc}; }
  for (var c = 0u; c < cols; c = c + 1u) { DX[base + c] = ${write}; }
}
`;
}

/**
 * Fused layer norm with scale and shift over the last axis of [rows, cols];
 * one thread per row. Saves (mean, rstd) per row for the backward pass.
 * P = [rows, cols, eps].
 */
export function layerNormKernel(): string {
  return `${head('layerNorm')}${bindings([
    ['X', 'read'],
    ['GAMMA', 'read'],
    ['BETA', 'read'],
    ['Y', 'read_write'],
    ['STATS', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let cols = P[1];
  let base = i * cols;
  let n = f32(cols);
  var mean = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { mean = mean + X[base + c]; }
  mean = mean / n;
  var variance = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { let d = X[base + c] - mean; variance = variance + d * d; }
  let rstd = 1.0 / sqrt(variance / n + ${F(2)});
  for (var c = 0u; c < cols; c = c + 1u) {
    Y[base + c] = (X[base + c] - mean) * rstd * GAMMA[c] + BETA[c];
  }
  STATS[2u * i] = mean;
  STATS[2u * i + 1u] = rstd;
}
`;
}

/**
 * Layer norm input gradient, one thread per row:
 * dx = rstd * (dxhat - mean(dxhat) - xhat * mean(dxhat * xhat)), dxhat = g * gamma.
 * P = [rows, cols].
 */
export function layerNormGradKernel(): string {
  return `${head('layerNormGrad')}${bindings([
    ['X', 'read'],
    ['GAMMA', 'read'],
    ['STATS', 'read'],
    ['G', 'read'],
    ['DX', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let cols = P[1];
  let base = i * cols;
  let n = f32(cols);
  let mean = STATS[2u * i];
  let rstd = STATS[2u * i + 1u];
  var sumD = 0.0;
  var sumDX = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) {
    let d = G[base + c] * GAMMA[c];
    sumD = sumD + d;
    sumDX = sumDX + d * (X[base + c] - mean) * rstd;
  }
  let meanD = sumD / n;
  let meanDX = sumDX / n;
  for (var c = 0u; c < cols; c = c + 1u) {
    let xhat = (X[base + c] - mean) * rstd;
    DX[base + c] = rstd * (G[base + c] * GAMMA[c] - meanD - xhat * meanDX);
  }
}
`;
}

/** Layer norm scale/shift gradients, one thread per column. P = [rows, cols]. */
export function layerNormParamGradKernel(): string {
  return `${head('layerNormParamGrad')}${bindings([
    ['X', 'read'],
    ['STATS', 'read'],
    ['G', 'read'],
    ['DGAMMA', 'read_write'],
    ['DBETA', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  let cols = P[1];
  if (i >= cols) { return; }
  var dg = 0.0;
  var db = 0.0;
  for (var r = 0u; r < P[0]; r = r + 1u) {
    let g = G[r * cols + i];
    dg = dg + g * (X[r * cols + i] - STATS[2u * r]) * STATS[2u * r + 1u];
    db = db + g;
  }
  DGAMMA[i] = dg;
  DBETA[i] = db;
}
`;
}

/**
 * Cross-entropy per row: loss = logsumexp(x) - x[target]. Saves logsumexp
 * per row for the backward pass. T holds class ids. P = [rows, cols].
 */
export function crossEntropyKernel(): string {
  return `${head('crossEntropy')}${bindings([
    ['X', 'read'],
    ['T', 'read', 'u32'],
    ['LOSS', 'read_write'],
    ['LSE', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let cols = P[1];
  let base = i * cols;
  var m = X[base];
  for (var c = 1u; c < cols; c = c + 1u) { m = max(m, X[base + c]); }
  var s = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { s = s + exp(X[base + c] - m); }
  let lse = m + log(s);
  LSE[i] = lse;
  LOSS[i] = lse - X[base + T[i]];
}
`;
}

/** Cross-entropy gradient: dx = (softmax(x) - onehot(target)) * g[row]. P = [rows, cols]. */
export function crossEntropyGradKernel(): string {
  return `${head('crossEntropyGrad')}${bindings([
    ['X', 'read'],
    ['T', 'read', 'u32'],
    ['LSE', 'read'],
    ['G', 'read'],
    ['DX', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  let cols = P[1];
  if (i >= P[0] * cols) { return; }
  let r = i / cols;
  let c = i % cols;
  let p = exp(X[i] - LSE[r]);
  DX[i] = (p - select(0.0, 1.0, c == T[r])) * G[r];
}
`;
}

/**
 * Adam / AdamW update in place. P = [n, lr, beta1, beta2, eps, weightDecay,
 * correction1, correction2, decoupled].
 */
export function adamKernel(): string {
  return `${head('adam')}${bindings([
    ['G', 'read'],
    ['W', 'read_write'],
    ['M', 'read_write'],
    ['V', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let lr = ${F(1)};
  let b1 = ${F(2)};
  let b2 = ${F(3)};
  let eps = ${F(4)};
  let wd = ${F(5)};
  var w = W[i];
  var g = G[i];
  if (P[8] != 0u) { w = w - lr * wd * w; } else { g = g + wd * w; }
  let m = b1 * M[i] + (1.0 - b1) * g;
  let v = b2 * V[i] + (1.0 - b2) * g * g;
  M[i] = m;
  V[i] = v;
  let mHat = m / ${F(6)};
  let vHat = v / ${F(7)};
  W[i] = w - lr * mHat / (sqrt(vHat) + eps);
}
`;
}

/** SGD with momentum in place. P = [n, lr, momentum, weightDecay]. */
export function sgdKernel(): string {
  return `${head('sgd')}${bindings([
    ['G', 'read'],
    ['W', 'read_write'],
    ['VEL', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  let w = W[i];
  let g = G[i] + ${F(3)} * w;
  let v = ${F(2)} * VEL[i] + g;
  VEL[i] = v;
  W[i] = w - ${F(1)} * v;
}
`;
}

/**
 * Sets Y[0] to 1 if any X is NaN or infinite (Y is zero-filled first). Uses
 * the bit pattern: drivers may optimize isNan-style comparisons away.
 * P = [n].
 */
export function nonFiniteKernel(): string {
  return `${head('nonFinite')}${bindings([
    ['X', 'read'],
    ['Y', 'read_write'],
  ])}

${ENTRY} {
  ${INDEX}
  if (i >= P[0]) { return; }
  if ((bitcast<u32>(X[i]) & 0x7f800000u) == 0x7f800000u) { Y[0] = 1.0; }
}
`;
}

/** The name on a kernel's first line. */
export function kernelName(code: string): string {
  const m = /^\/\/ kernel: (\S+)/.exec(code);
  if (!m) throw new Error('Not a gpu-kernels.ts kernel.');
  return m[1]!;
}

/** Every kernel variant (for tests and the shader check on a real GPU). */
export function allKernels(tile = 16): string[] {
  return [
    fillKernel(),
    ...(Object.keys(KERNEL_BINARY) as KernelBinaryOp[]).map(binaryKernel),
    ...(Object.keys(KERNEL_SCALAR) as KernelScalarOp[]).map(scalarKernel),
    ...(Object.keys(KERNEL_UNARY) as KernelUnaryOp[]).map(unaryKernel),
    ...(Object.keys(KERNEL_UNARY) as KernelUnaryOp[]).map(unaryGradKernel),
    reduceKernel('sum'),
    reduceKernel('max'),
    reduceKernel('min'),
    argKernel('argmax'),
    argKernel('argmin'),
    reduceGradKernel('max'),
    reduceGradKernel('min'),
    matmulKernel(tile),
    stridedKernel(),
    sliceGradKernel(),
    insertKernel(),
    indexRowsKernel(),
    takeKernel(),
    scatterAddKernel(),
    softmaxRowsKernel(false),
    softmaxRowsKernel(true),
    softmaxGradKernel(false),
    softmaxGradKernel(true),
    layerNormKernel(),
    layerNormGradKernel(),
    layerNormParamGradKernel(),
    crossEntropyKernel(),
    crossEntropyGradKernel(),
    adamKernel(),
    sgdKernel(),
    nonFiniteKernel(),
  ];
}
