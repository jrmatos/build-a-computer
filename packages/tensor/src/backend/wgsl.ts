/**
 * WGSL compute shaders for the WebGPU backend, generated as strings, plus the
 * shape and dispatch arithmetic around them. Nothing here touches the GPU, so
 * it is unit-tested in Node; webgpu.ts compiles and runs these.
 *
 * Conventions: every buffer is array<f32>. Large 1-D jobs are spread over a
 * 2-D grid of workgroups (x, y) because one grid axis is limited to
 * maxComputeWorkgroupsPerDimension (usually 65535); shaders rebuild the flat
 * index as gid.x + gid.y * (num_workgroups.x * WORKGROUP).
 */
import { broadcastShapes, broadcastStrides, sizeOf, type Shape } from '../shape';

/** Threads per workgroup for 1-D kernels. */
export const WORKGROUP = 64;

export type GpuBinaryOp = 'add' | 'sub' | 'mul' | 'div' | 'maximum' | 'minimum';
export type GpuUnaryOp =
  'neg' | 'exp' | 'log' | 'sqrt' | 'abs' | 'tanh' | 'sigmoid' | 'relu' | 'gelu';
export type GpuReduceOp = 'sum' | 'max';

export const BINARY_EXPR: Record<GpuBinaryOp, string> = {
  add: 'a + b',
  sub: 'a - b',
  mul: 'a * b',
  div: 'a / b',
  maximum: 'max(a, b)',
  minimum: 'min(a, b)',
};

// tanh() is clamped: some drivers compute it via exp() and return NaN for large |x|.
export const UNARY_EXPR: Record<GpuUnaryOp, string> = {
  neg: '-x',
  exp: 'exp(x)',
  log: 'log(x)',
  sqrt: 'sqrt(x)',
  abs: 'abs(x)',
  tanh: 'tanh(clamp(x, -15.0, 15.0))',
  sigmoid: '1.0 / (1.0 + exp(-x))',
  relu: 'max(x, 0.0)',
  gelu: '0.5 * x * (1.0 + tanh(clamp(0.7978845608 * (x + 0.044715 * x * x * x), -15.0, 15.0)))',
};

const FLAT_INDEX = `let i = gid.x + gid.y * nwg.x * ${WORKGROUP}u;`;
const ENTRY_1D = `@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>)`;

/**
 * Elementwise binary op with broadcasting. The `dims` buffer (named so
 * because `meta` is a reserved word in WGSL) holds
 * [n, rank, outShape[rank], aStrides[rank], bStrides[rank]] (see binaryMeta).
 */
export function binaryShader(op: GpuBinaryOp): string {
  return `@group(0) @binding(0) var<storage, read> A: array<f32>;
@group(0) @binding(1) var<storage, read> B: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<storage, read> dims: array<u32>;

${ENTRY_1D} {
  ${FLAT_INDEX}
  if (i >= dims[0]) { return; }
  let rank = dims[1];
  var rest = i;
  var ia = 0u;
  var ib = 0u;
  for (var d = 0u; d < rank; d = d + 1u) {
    let ax = rank - 1u - d;
    let size = dims[2u + ax];
    let coord = rest % size;
    rest = rest / size;
    ia = ia + coord * dims[2u + rank + ax];
    ib = ib + coord * dims[2u + 2u * rank + ax];
  }
  let a = A[ia];
  let b = B[ib];
  Y[i] = ${BINARY_EXPR[op]};
}
`;
}

/** The `meta` array for binaryShader: sizes and broadcast strides (0 on stretched axes). */
export function binaryMeta(
  aShape: Shape,
  bShape: Shape,
): { outShape: number[]; meta: Uint32Array } {
  const outShape = broadcastShapes(aShape, bShape);
  const rank = outShape.length;
  const meta = new Uint32Array(2 + 3 * rank);
  meta[0] = sizeOf(outShape);
  meta[1] = rank;
  meta.set(outShape, 2);
  meta.set(broadcastStrides(aShape, outShape), 2 + rank);
  meta.set(broadcastStrides(bShape, outShape), 2 + 2 * rank);
  return { outShape, meta };
}

/** Elementwise unary op. Params: [n, 0, 0, 0]. */
export function unaryShader(op: GpuUnaryOp): string {
  return `@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> Y: array<f32>;
@group(0) @binding(2) var<uniform> p: vec4<u32>;

${ENTRY_1D} {
  ${FLAT_INDEX}
  if (i >= p.x) { return; }
  let x = X[i];
  Y[i] = ${UNARY_EXPR[op]};
}
`;
}

/**
 * Reduces the middle axis of [outer, len, inner]; one thread per output.
 * Params: [outer, len, inner, 0].
 */
export function reduceShader(op: GpuReduceOp): string {
  const combine = op === 'sum' ? 'acc + v' : 'max(acc, v)';
  return `@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> Y: array<f32>;
@group(0) @binding(2) var<uniform> p: vec4<u32>;

${ENTRY_1D} {
  ${FLAT_INDEX}
  if (i >= p.x * p.z) { return; }
  let o = i / p.z;
  let j = i % p.z;
  let base = o * p.y * p.z + j;
  var acc = ${op === 'sum' ? '0.0' : 'X[base]'};
  for (var r = ${op === 'sum' ? '0u' : '1u'}; r < p.y; r = r + 1u) {
    let v = X[base + r * p.z];
    acc = ${combine};
  }
  Y[i] = acc;
}
`;
}

/** Numerically stable softmax over the last axis of [rows, cols]; one thread per row. Params: [rows, cols, 0, 0]. */
export function softmaxShader(): string {
  return `@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> Y: array<f32>;
@group(0) @binding(2) var<uniform> p: vec4<u32>;

${ENTRY_1D} {
  ${FLAT_INDEX}
  if (i >= p.x) { return; }
  let base = i * p.y;
  var m = X[base];
  for (var c = 1u; c < p.y; c = c + 1u) { m = max(m, X[base + c]); }
  var s = 0.0;
  for (var c = 0u; c < p.y; c = c + 1u) { s = s + exp(X[base + c] - m); }
  for (var c = 0u; c < p.y; c = c + 1u) { Y[base + c] = exp(X[base + c] - m) / s; }
}
`;
}

/** Layer norm (no scale/shift) over the last axis of [rows, cols]; one thread per row. */
export function layerNormShader(): string {
  return `struct Params { rows: u32, cols: u32, eps: f32, pad: u32 };
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> Y: array<f32>;
@group(0) @binding(2) var<uniform> p: Params;

${ENTRY_1D} {
  ${FLAT_INDEX}
  if (i >= p.rows) { return; }
  let base = i * p.cols;
  let n = f32(p.cols);
  var mean = 0.0;
  for (var c = 0u; c < p.cols; c = c + 1u) { mean = mean + X[base + c]; }
  mean = mean / n;
  var variance = 0.0;
  for (var c = 0u; c < p.cols; c = c + 1u) { let d = X[base + c] - mean; variance = variance + d * d; }
  let inv = inverseSqrt(variance / n + p.eps);
  for (var c = 0u; c < p.cols; c = c + 1u) { Y[base + c] = (X[base + c] - mean) * inv; }
}
`;
}

/**
 * Tiled matrix multiply: each workgroup computes a tile×tile block of C,
 * staging tiles of A and B in fast workgroup memory. grid z = batch.
 * Params: [M, K, N, aBatchStride, bBatchStride, 0, 0, 0].
 */
export function matmulShader(tile: number): string {
  return `struct Params { M: u32, K: u32, N: u32, aStride: u32, bStride: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<storage, read> A: array<f32>;
@group(0) @binding(1) var<storage, read> B: array<f32>;
@group(0) @binding(2) var<storage, read_write> C: array<f32>;
@group(0) @binding(3) var<uniform> p: Params;

const TILE: u32 = ${tile}u;
var<workgroup> tileA: array<array<f32, ${tile}>, ${tile}>;
var<workgroup> tileB: array<array<f32, ${tile}>, ${tile}>;

@compute @workgroup_size(${tile}, ${tile}, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let row = wg.y * TILE + lid.y;
  let col = wg.x * TILE + lid.x;
  let aBase = wg.z * p.aStride;
  let bBase = wg.z * p.bStride;
  var acc = 0.0;
  let tiles = (p.K + TILE - 1u) / TILE;
  for (var t = 0u; t < tiles; t = t + 1u) {
    let ak = t * TILE + lid.x;
    let bk = t * TILE + lid.y;
    var av = 0.0;
    if (row < p.M && ak < p.K) { av = A[aBase + row * p.K + ak]; }
    var bv = 0.0;
    if (bk < p.K && col < p.N) { bv = B[bBase + bk * p.N + col]; }
    tileA[lid.y][lid.x] = av;
    tileB[lid.y][lid.x] = bv;
    workgroupBarrier();
    for (var k = 0u; k < TILE; k = k + 1u) { acc = acc + tileA[lid.y][k] * tileB[k][lid.x]; }
    workgroupBarrier();
  }
  if (row < p.M && col < p.N) { C[wg.z * p.M * p.N + row * p.N + col] = acc; }
}
`;
}

/** The GPU limits the backend reads from the adapter before allocating (E-ML-04). */
export interface GpuLimits {
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  maxComputeWorkgroupsPerDimension: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupSizeX: number;
  maxComputeWorkgroupSizeY: number;
  maxComputeWorkgroupStorageSize: number;
}

/** WebGPU's guaranteed minimum limits (every adapter supports at least these). */
export const DEFAULT_GPU_LIMITS: GpuLimits = {
  maxBufferSize: 268435456,
  maxStorageBufferBindingSize: 134217728,
  maxComputeWorkgroupsPerDimension: 65535,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupStorageSize: 16384,
};

/** Largest power-of-two matmul tile (at most 16) the device's workgroup limits allow. */
export function chooseMatmulTile(limits: GpuLimits): number {
  let tile = 16;
  while (
    tile > 1 &&
    (tile * tile > limits.maxComputeInvocationsPerWorkgroup ||
      tile > limits.maxComputeWorkgroupSizeX ||
      tile > limits.maxComputeWorkgroupSizeY ||
      2 * tile * tile * 4 > limits.maxComputeWorkgroupStorageSize)
  ) {
    tile /= 2;
  }
  return tile;
}

/** Thrown when a job does not fit the device; the caller falls back to the CPU. */
export class GpuLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpuLimitError';
  }
}

/**
 * Thrown when the device rejects a kernel (shader compile or validation
 * error). A GpuLimitError, so callers fall back to the CPU the same way.
 */
export class GpuKernelError extends GpuLimitError {
  constructor(message: string) {
    super(message);
    this.name = 'GpuKernelError';
  }
}

/**
 * Workgroup grid for `n` threads of a 1-D kernel: x up to the per-dimension
 * limit, the rest on y.
 */
export function dispatch1D(n: number, limits: GpuLimits): [number, number, number] {
  const groups = Math.ceil(n / WORKGROUP);
  const max = limits.maxComputeWorkgroupsPerDimension;
  if (groups <= max) return [Math.max(1, groups), 1, 1];
  const y = Math.ceil(groups / max);
  if (y > max) throw new GpuLimitError(`${n} elements need more workgroups than this GPU allows.`);
  return [max, y, 1];
}

/** Workgroup grid for a batched matmul [batch, M, K] @ [batch, K, N]. */
export function dispatchMatmul(
  m: number,
  n: number,
  batch: number,
  tile: number,
  limits: GpuLimits,
): [number, number, number] {
  const grid: [number, number, number] = [Math.ceil(n / tile), Math.ceil(m / tile), batch];
  for (const g of grid) {
    if (g > limits.maxComputeWorkgroupsPerDimension) {
      throw new GpuLimitError(
        `matmul grid ${grid.join('×')} exceeds this GPU's ${limits.maxComputeWorkgroupsPerDimension} workgroups per dimension.`,
      );
    }
  }
  return grid;
}

/** Throws GpuLimitError if a buffer of `bytes` cannot be bound as storage on this device. */
export function checkBufferSize(bytes: number, limits: GpuLimits, what = 'buffer'): void {
  const max = Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize);
  if (bytes > max) {
    throw new GpuLimitError(
      `${what} needs ${bytes} bytes but this GPU binds at most ${max} bytes per buffer.`,
    );
  }
}

/** Bytes for a GPU buffer holding `count` f32/u32 values (at least 4, multiple of 4). */
export function bufferBytes(count: number): number {
  return Math.max(4, count * 4);
}

/**
 * How a batched matmul maps onto the shader: the shader supports a batch
 * stride per input, so one side may be un-batched (stride 0). Returns null
 * when the batch axes need a general broadcast (the host expands first).
 */
export function matmulPlan(
  aShape: Shape,
  bShape: Shape,
): {
  m: number;
  k: number;
  n: number;
  batch: number;
  aStride: number;
  bStride: number;
  outShape: number[];
} | null {
  if (aShape.length < 2 || bShape.length < 2) return null;
  const [m, k] = aShape.slice(-2) as [number, number];
  const [k2, n] = bShape.slice(-2) as [number, number];
  if (k !== k2) throw new RangeError(`matmul: inner sizes differ (${k} vs ${k2}).`);
  const aBatch = aShape.slice(0, -2);
  const bBatch = bShape.slice(0, -2);
  const outBatch = broadcastShapes(aBatch, bBatch);
  const batch = sizeOf(outBatch);
  const aCount = sizeOf(aBatch);
  const bCount = sizeOf(bBatch);
  if ((aCount !== 1 && aCount !== batch) || (bCount !== 1 && bCount !== batch)) return null;
  // If a side has as many matrices as the output, no batch axis of it was
  // stretched, so its matrices are already laid out in output order.
  return {
    m,
    k,
    n,
    batch,
    aStride: aCount === 1 ? 0 : m * k,
    bStride: bCount === 1 ? 0 : k * n,
    outShape: [...outBatch, m, n],
  };
}
