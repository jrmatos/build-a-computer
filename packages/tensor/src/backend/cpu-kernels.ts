/**
 * CPU kernels: plain loops over typed arrays. Each function reads its inputs
 * and writes into a preallocated `out` array, so callers decide the dtype.
 * These are the reference implementation the WebGPU kernels are tested against.
 */
import { broadcastStrides, sizeOf, stridesOf, type Shape } from '../shape';

/** Float32Array or Float64Array: the storage behind every tensor. */
export type FloatArray = Float32Array | Float64Array;

/**
 * Elementwise binary op with broadcasting. `outShape` must be
 * broadcastShapes(aShape, bShape).
 */
export function binaryKernel(
  f: (x: number, y: number) => number,
  a: FloatArray,
  aShape: Shape,
  b: FloatArray,
  bShape: Shape,
  out: FloatArray,
  outShape: Shape,
): void {
  const n = out.length;
  // Fast paths: same shape, or one side is a single number.
  if (a.length === n && b.length === n) {
    for (let i = 0; i < n; i++) out[i] = f(a[i]!, b[i]!);
    return;
  }
  if (b.length === 1 && a.length === n) {
    const y = b[0]!;
    for (let i = 0; i < n; i++) out[i] = f(a[i]!, y);
    return;
  }
  if (a.length === 1 && b.length === n) {
    const x = a[0]!;
    for (let i = 0; i < n; i++) out[i] = f(x, b[i]!);
    return;
  }
  // General case: walk the output index like an odometer and keep one flat
  // offset into each input (broadcast axes have stride 0).
  const rank = outShape.length;
  const sa = broadcastStrides(aShape, outShape);
  const sb = broadcastStrides(bShape, outShape);
  const idx = new Array<number>(rank).fill(0);
  let ia = 0;
  let ib = 0;
  for (let i = 0; i < n; i++) {
    out[i] = f(a[ia]!, b[ib]!);
    for (let ax = rank - 1; ax >= 0; ax--) {
      idx[ax]!++;
      ia += sa[ax]!;
      ib += sb[ax]!;
      if (idx[ax]! < outShape[ax]!) break;
      ia -= sa[ax]! * outShape[ax]!;
      ib -= sb[ax]! * outShape[ax]!;
      idx[ax] = 0;
    }
  }
}

/** Copies `x` (of `shape`) into the larger broadcast `target` shape. */
export function expandKernel(x: FloatArray, shape: Shape, out: FloatArray, target: Shape): void {
  binaryKernel((v) => v, x, shape, ONE, [], out, target);
}
const ONE = new Float64Array([0]);

/**
 * Matrix multiply on the last two axes, with broadcasting over the leading
 * "batch" axes: [..., m, k] @ [..., k, n] -> [..., m, n].
 * `aBatch`/`bBatch` are the leading shapes; `outBatch` is their broadcast.
 */
export function matmulKernel(
  a: FloatArray,
  aBatch: Shape,
  b: FloatArray,
  bBatch: Shape,
  out: FloatArray,
  outBatch: Shape,
  m: number,
  k: number,
  n: number,
): void {
  const batches = sizeOf(outBatch);
  const sa = broadcastStrides(aBatch, outBatch);
  const sb = broadcastStrides(bBatch, outBatch);
  const outStrides = stridesOf(outBatch);
  // Work in float64 (exact products, no float32 conversions in the hot loop)
  // and keep each B matrix transposed, so both inner reads walk memory in order.
  const a64 = a instanceof Float64Array ? a : Float64Array.from(a);
  const transposed = new Map<number, Float64Array>();
  for (let batch = 0; batch < batches; batch++) {
    // Turn the batch number into offsets into a and b.
    let rest = batch;
    let ma = 0;
    let mb = 0;
    for (let ax = 0; ax < outBatch.length; ax++) {
      const i = Math.floor(rest / outStrides[ax]!);
      rest -= i * outStrides[ax]!;
      ma += i * sa[ax]!;
      mb += i * sb[ax]!;
    }
    let bt = transposed.get(mb);
    if (!bt) {
      bt = transposeMatrix(b, mb * k * n, k, n);
      transposed.set(mb, bt);
    }
    matmul2d(a64, ma * m * k, bt, out, batch * m * n, m, k, n);
  }
}

/** Copies the [rows, cols] matrix at `offset` into a new [cols, rows] float64 array. */
function transposeMatrix(x: FloatArray, offset: number, rows: number, cols: number): Float64Array {
  const t = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) t[c * rows + r] = x[offset + r * cols + c]!;
  return t;
}

/**
 * C[m,n] = A[m,k] @ B[k,n] for one matrix, given B transposed (bt is [n, k]),
 * so C[i][j] is the dot product of row i of A and row j of bt.
 *
 * The speed trick is a 4×4 "register tile": each pass of the p loop loads 4
 * values of A and 4 of B and does 16 multiply-adds into 16 local variables,
 * so every value read from memory is used 4 times. Edges that do not fill a
 * whole tile use the plain dot product.
 */
// prettier-ignore
function matmul2d(a: Float64Array, aOff: number, bt: Float64Array, c: FloatArray, cOff: number, m: number, k: number, n: number): void {
  for (let i = 0; i < m; i += 4) {
    for (let j = 0; j < n; j += 4) {
      if (i + 4 > m || j + 4 > n) {
        for (let ii = i; ii < Math.min(i + 4, m); ii++) {
          for (let jj = j; jj < Math.min(j + 4, n); jj++) {
            let s = 0;
            for (let p = 0; p < k; p++) s += a[aOff + ii * k + p]! * bt[jj * k + p]!;
            c[cOff + ii * n + jj] = s;
          }
        }
        continue;
      }
      let s00 = 0, s01 = 0, s02 = 0, s03 = 0;
      let s10 = 0, s11 = 0, s12 = 0, s13 = 0;
      let s20 = 0, s21 = 0, s22 = 0, s23 = 0;
      let s30 = 0, s31 = 0, s32 = 0, s33 = 0;
      const r0 = aOff + i * k, r1 = r0 + k, r2 = r1 + k, r3 = r2 + k;
      const q0 = j * k, q1 = q0 + k, q2 = q1 + k, q3 = q2 + k;
      for (let p = 0; p < k; p++) {
        const x0 = a[r0 + p]!, x1 = a[r1 + p]!, x2 = a[r2 + p]!, x3 = a[r3 + p]!;
        const y0 = bt[q0 + p]!, y1 = bt[q1 + p]!, y2 = bt[q2 + p]!, y3 = bt[q3 + p]!;
        s00 += x0 * y0; s01 += x0 * y1; s02 += x0 * y2; s03 += x0 * y3;
        s10 += x1 * y0; s11 += x1 * y1; s12 += x1 * y2; s13 += x1 * y3;
        s20 += x2 * y0; s21 += x2 * y1; s22 += x2 * y2; s23 += x2 * y3;
        s30 += x3 * y0; s31 += x3 * y1; s32 += x3 * y2; s33 += x3 * y3;
      }
      let o = cOff + i * n + j;
      c[o] = s00; c[o + 1] = s01; c[o + 2] = s02; c[o + 3] = s03;
      o += n;
      c[o] = s10; c[o + 1] = s11; c[o + 2] = s12; c[o + 3] = s13;
      o += n;
      c[o] = s20; c[o + 1] = s21; c[o + 2] = s22; c[o + 3] = s23;
      o += n;
      c[o] = s30; c[o + 1] = s31; c[o + 2] = s32; c[o + 3] = s33;
    }
  }
}

/**
 * Reduces the middle axis of a tensor viewed as [outer, len, inner].
 * 'sum' adds, 'max' keeps the largest, 'argmax' stores the index of the largest.
 */
export function reduceKernel(
  kind: 'sum' | 'max' | 'min' | 'argmax' | 'argmin',
  x: FloatArray,
  outer: number,
  len: number,
  inner: number,
  out: FloatArray,
): void {
  for (let o = 0; o < outer; o++) {
    for (let i = 0; i < inner; i++) {
      const base = o * len * inner + i;
      let acc = kind === 'sum' ? 0 : x[base]!;
      let best = 0;
      for (let r = kind === 'sum' ? 0 : 1; r < len; r++) {
        const v = x[base + r * inner]!;
        if (kind === 'sum') {
          acc += v;
        } else if (Number.isNaN(acc)) {
          break; // NaN wins: a broken value should not be hidden by max/min
        } else if (Number.isNaN(v) || (kind === 'max' || kind === 'argmax' ? v > acc : v < acc)) {
          acc = v;
          best = r;
        }
      }
      out[o * inner + i] = kind === 'argmax' || kind === 'argmin' ? best : acc;
    }
  }
}

/**
 * Softmax (or log-softmax) over the last axis of [rows, cols]. Subtracting the
 * row maximum first keeps exp() from overflowing.
 */
export function softmaxKernel(
  x: FloatArray,
  rows: number,
  cols: number,
  out: FloatArray,
  log: boolean,
): void {
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let max = -Infinity;
    for (let c = 0; c < cols; c++) max = Math.max(max, x[base + c]!);
    if (max === -Infinity) max = 0; // a fully masked row: avoid -inf - -inf = NaN
    let sum = 0;
    for (let c = 0; c < cols; c++) sum += Math.exp(x[base + c]! - max);
    if (log) {
      const logSum = Math.log(sum) + max;
      for (let c = 0; c < cols; c++) out[base + c] = x[base + c]! - logSum;
    } else {
      for (let c = 0; c < cols; c++) out[base + c] = Math.exp(x[base + c]! - max) / sum;
    }
  }
}

/** Layer normalization over the last axis of [rows, cols] (no scale/shift). */
export function layerNormKernel(
  x: FloatArray,
  rows: number,
  cols: number,
  eps: number,
  out: FloatArray,
): void {
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let mean = 0;
    for (let c = 0; c < cols; c++) mean += x[base + c]!;
    mean /= cols;
    let variance = 0;
    for (let c = 0; c < cols; c++) variance += (x[base + c]! - mean) ** 2;
    variance /= cols;
    const inv = 1 / Math.sqrt(variance + eps);
    for (let c = 0; c < cols; c++) out[base + c] = (x[base + c]! - mean) * inv;
  }
}

/** Reorders axes: out axis i is input axis perm[i]. */
export function permuteKernel(
  x: FloatArray,
  shape: Shape,
  perm: readonly number[],
  out: FloatArray,
): void {
  const rank = shape.length;
  const inStrides = stridesOf(shape);
  const outShape = perm.map((p) => shape[p]!);
  const step = perm.map((p) => inStrides[p]!); // input stride for each output axis
  const idx = new Array<number>(rank).fill(0);
  let src = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = x[src]!;
    for (let ax = rank - 1; ax >= 0; ax--) {
      idx[ax]!++;
      src += step[ax]!;
      if (idx[ax]! < outShape[ax]!) break;
      src -= step[ax]! * outShape[ax]!;
      idx[ax] = 0;
    }
  }
}
