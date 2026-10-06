/**
 * The 'tensor' module: an n-dimensional array of numbers with automatic
 * differentiation built in.
 *
 * How it works, in three ideas:
 * 1. A Tensor is a flat typed array (`data`) plus a `shape`. Element
 *    (i, j) of a [rows, cols] tensor lives at data[i * cols + j].
 * 2. Every operation returns a new tensor. If any input has
 *    `requiresGrad`, the result remembers its inputs and a small `backward`
 *    function that turns "gradient of the output" into "gradients of the inputs".
 * 3. `loss.backward()` visits that graph from the loss back to the leaves
 *    (chain rule) and stores the result in each leaf's `.grad`.
 *
 * Storage is float32 by default; pass `{ dtype: 'float64' }` for gradient
 * checks (E-ML-05). Mixing the two gives float64.
 *
 * Devices: a tensor lives on the CPU (a typed array) or on the GPU
 * (`t.to('webgpu')`, or `model.to('auto')` for a whole model). Operations on
 * GPU tensors run WGSL kernels and keep their results on the GPU, gradients
 * included; nothing is copied back until you ask: `await t.read()`,
 * `await t.itemAsync()`, `await t.cpu()`, or `report({ loss })` in the
 * sandbox. Reading `t.data` / `t.item()` of a GPU tensor works only after
 * such a read. GPU tensors are float32 only.
 */
import {
  binaryKernel,
  expandKernel,
  matmulKernel,
  permuteKernel,
  reduceKernel,
  softmaxKernel,
  type FloatArray,
} from './backend/cpu-kernels';
import type * as K from './backend/gpu-kernels';
import * as gpu from './backend/gpu-ops';
import { autoDevice, GpuStorage, gpuRuntime } from './backend/gpu-runtime';
import { defaultRng, type Rng } from './random';
import {
  broadcastShapes,
  checkShape,
  formatShape,
  inferReshape,
  normalizeAxis,
  shapesEqual,
  sizeOf,
  stridesOf,
  type Shape,
} from './shape';

export { defaultRng, manualSeed, Rng } from './random';

export type DType = 'float32' | 'float64';
/** Where a tensor's numbers live. */
export type Device = 'cpu' | 'webgpu';
/** A device to move to: 'gpu' means 'webgpu'; 'auto' is the GPU when one is available, else the CPU. */
export type DeviceRequest = Device | 'gpu' | 'auto';

/** Thrown when GPU values are read synchronously before being copied back. */
export class DeviceReadError extends Error {
  constructor(what = 'This tensor') {
    super(
      `${what} lives on the GPU, so its values cannot be read synchronously. ` +
        'Use await t.read(), await t.itemAsync() or await t.cpu() (or report({ loss }) to plot it); after that, t.data and t.item() work.',
    );
    this.name = 'DeviceReadError';
  }
}

/** The device `to('auto')` picks right now: 'webgpu' when a GPU is connected, else 'cpu'. */
export function defaultDevice(): Device {
  return autoDevice();
}

function resolveDevice(request: DeviceRequest): Device {
  if (request === 'auto') return autoDevice();
  return request === 'gpu' ? 'webgpu' : request;
}
export type { Shape, FloatArray };

/** Nested arrays of numbers, e.g. [[1, 2], [3, 4]]. */
export type NestedArray = number | NestedArray[];

/** Options shared by the tensor creation functions. */
export interface TensorOptions {
  /** 'float32' (default) or 'float64'. */
  dtype?: DType;
  /** Track operations on this tensor so `backward()` can compute its gradient. */
  requiresGrad?: boolean;
}

/** Options for the random creation functions. */
export interface RandomOptions extends TensorOptions {
  /** Generator to draw from; defaults to the shared one (see `manualSeed`). */
  rng?: Rng;
}

/** Index lists accepted by gather / indexSelect / embedding lookups. */
export type Indices = Tensor | readonly number[] | Int32Array;

/** The autograd record kept on a tensor produced by an operation. */
interface GradNode {
  op: string;
  inputs: Tensor[];
  /** Maps the output gradient to one gradient per input (null = no gradient). */
  backward: (grad: Tensor) => (Tensor | null)[];
}

// ---------------------------------------------------------------------------
// Gradient mode
// ---------------------------------------------------------------------------

let gradEnabled = true;

/**
 * Runs `fn` without recording operations for autograd: use it for evaluation,
 * sampling, and optimizer updates. Returns whatever `fn` returns.
 */
export function noGrad<T>(fn: () => T): T {
  const previous = gradEnabled;
  gradEnabled = false;
  try {
    return fn();
  } finally {
    gradEnabled = previous;
  }
}

/** True unless inside `noGrad`. */
export function isGradEnabled(): boolean {
  return gradEnabled;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allocate(dtype: DType, size: number): FloatArray {
  return dtype === 'float64' ? new Float64Array(size) : new Float32Array(size);
}

function resultType(a: DType, b: DType): DType {
  return a === 'float64' || b === 'float64' ? 'float64' : 'float32';
}

function flattenNested(value: NestedArray, shape: number[], out: number[], depth: number): void {
  if (typeof value === 'number') {
    if (depth !== shape.length) throw new RangeError('tensor: ragged nested array (mixed depths).');
    out.push(value);
    return;
  }
  if (!Array.isArray(value))
    throw new TypeError('tensor: expected numbers or nested arrays of numbers.');
  if (depth === shape.length) shape.push(value.length);
  else if (shape[depth] !== value.length) {
    throw new RangeError(
      `tensor: ragged nested array (expected length ${shape[depth]}, got ${value.length}).`,
    );
  }
  for (const v of value) flattenNested(v, shape, out, depth + 1);
}

function toIndexArray(indices: Indices): Int32Array {
  const raw = indices instanceof Tensor ? indices.data : indices;
  const out = new Int32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]!;
    if (!Number.isInteger(v)) throw new RangeError(`Index ${v} is not an integer.`);
    out[i] = v;
  }
  return out;
}

function indexShape(indices: Indices): number[] {
  return indices instanceof Tensor ? [...indices.shape] : [indices.length];
}

/**
 * Sums a broadcast gradient back down to the shape of the input that was
 * stretched. Example: b of shape [3] was added to a of shape [2, 3], so
 * grad b = grad.sum(axis 0).
 */
function unbroadcast(grad: Tensor, shape: Shape): Tensor {
  if (shapesEqual(grad.shape, shape)) return grad;
  let g = grad;
  const extra = g.shape.length - shape.length;
  for (let i = 0; i < extra; i++) g = g.sum(0);
  for (let ax = 0; ax < shape.length; ax++) {
    if (shape[ax] === 1 && g.shape[ax] !== 1) g = g.sum(ax, true);
  }
  return g.reshape(shape);
}

/** A GPU matmul result as a plain (no-autograd) tensor; used by matmul's backward pass. */
function gpuMm(a: Tensor, b: Tensor, transA: boolean, transB: boolean): Tensor {
  const { storage, shape } = gpu.gpuMatmul(a, b, transA, transB);
  return new Tensor(storage, shape);
}

// ---------------------------------------------------------------------------
// The Tensor class
// ---------------------------------------------------------------------------

/** An n-dimensional array of numbers that can track gradients. */
export class Tensor {
  readonly shape: readonly number[];
  readonly dtype: DType;
  /** When true, operations on this tensor are recorded for `backward()`. */
  requiresGrad: boolean;
  /** Gradient of the last `backward()` call (leaves, or tensors that called `retainGrad()`). */
  grad: Tensor | null = null;
  /** Optional label shown in error messages and `toString()`. */
  name = '';
  /** Number of elements. */
  readonly size: number;
  /** GPU memory when the tensor lives on the GPU (see `device`). */
  gpu: GpuStorage | null = null;
  private node: GradNode | null = null;
  private keepGrad = false;
  /** CPU values: the storage of a CPU tensor, or a copy read back from the GPU. */
  private cpuData: FloatArray | null;

  /** Prefer the creation functions (`tensor`, `zeros`, `randn`, ...). */
  constructor(data: FloatArray | GpuStorage, shape: Shape, requiresGrad = false) {
    checkShape(shape);
    const size = sizeOf(shape);
    if (data instanceof GpuStorage) {
      if (data.count < size)
        throw new RangeError(`Tensor: GPU storage of ${data.count} values is too small for ${formatShape(shape)}.`);
      this.gpu = data;
      this.cpuData = null;
      this.dtype = 'float32';
    } else {
      if (data.length !== size) {
        throw new RangeError(`Tensor: ${data.length} values do not fit shape ${formatShape(shape)}.`);
      }
      this.cpuData = data;
      this.dtype = data instanceof Float64Array ? 'float64' : 'float32';
    }
    this.size = size;
    this.shape = Object.freeze([...shape]);
    this.requiresGrad = requiresGrad;
  }

  /**
   * Flat row-major values. Optimizers update CPU tensors in place. For a GPU
   * tensor this is the copy made by the last `await t.read()` (throws a
   * DeviceReadError before that); writing to that copy does not change the GPU.
   */
  get data(): FloatArray {
    const d = this.cpuData;
    if (d) return d;
    throw new DeviceReadError(this.name ? `Tensor '${this.name}'` : undefined);
  }

  /** Replacing the values moves the tensor to the CPU. */
  set data(values: FloatArray) {
    if (values.length !== this.size)
      throw new RangeError(`Tensor: ${values.length} values do not fit shape ${formatShape(this.shape)}.`);
    this.cpuData = values;
    this.gpu = null;
  }

  /** 'webgpu' when the values live on the GPU, else 'cpu'. */
  get device(): Device {
    return this.gpu ? 'webgpu' : 'cpu';
  }

  /** True when synchronous reads (`data`, `item()`) work: CPU tensors, or GPU tensors after `read()`. */
  get readable(): boolean {
    return this.cpuData !== null;
  }

  /** The GPU storage or the CPU values, whichever is authoritative (for sharing in views). */
  private get storage(): FloatArray | GpuStorage {
    return this.gpu ?? this.cpuData!;
  }

  /** Forgets the CPU copy of a GPU tensor (after a kernel wrote to its storage in place). */
  dropCpuCopy(): void {
    if (this.gpu) this.cpuData = null;
  }

  // -- Moving between devices --------------------------------------------------

  /**
   * Copies the values back from the GPU (no-op on the CPU) and returns them.
   * Afterwards `t.data` and `t.item()` work on this tensor.
   */
  async read(): Promise<FloatArray> {
    const storage = this.gpu;
    if (!storage) return this.data;
    const values = await storage.runtime.read(storage, this.size);
    if (this.gpu === storage) this.cpuData = values;
    return values;
  }

  /** The value of a one-element tensor, from either device. */
  async itemAsync(): Promise<number> {
    await this.read();
    return this.item();
  }

  /** Nested arrays, from either device. */
  async toArrayAsync(): Promise<NestedArray> {
    await this.read();
    return this.toArray();
  }

  /** A CPU copy (detached from the graph); the tensor itself when it is on the CPU. */
  async cpu(): Promise<Tensor> {
    if (!this.gpu) return this;
    const values = await this.read();
    return new Tensor(values.slice(), this.shape);
  }

  /**
   * Overwrites the values in place (same size), on either device. Used to
   * load checkpoints into parameters that live on the GPU.
   */
  assign(values: ArrayLike<number>): this {
    if (values.length !== this.size)
      throw new RangeError(`assign: ${values.length} values for a tensor of ${this.size}.`);
    if (this.gpu) {
      const copy = Float32Array.from(values);
      this.gpu.runtime.write(this.gpu, copy);
      this.cpuData = copy;
    } else this.data.set(values);
    return this;
  }

  /** Keeps a GPU tensor's memory past the end of the next optimizer step (see gpu-runtime.ts). */
  keep(): this {
    this.gpu?.keep();
    return this;
  }

  /**
   * Moves this tensor to a device in place (keeping its identity, so an
   * optimizer holding it keeps working). Used by `Module.to()`. Moving from
   * the GPU to the CPU needs the values on the CPU first (`await t.read()`).
   */
  moveTo(request: DeviceRequest): this {
    const device = resolveDevice(request);
    if (device === this.device) return this;
    if (device === 'cpu') {
      if (!this.cpuData) throw new DeviceReadError(this.name ? `Tensor '${this.name}'` : undefined);
      this.gpu = null;
      return this;
    }
    if (this.dtype === 'float64') {
      if (request === 'auto') return this;
      throw new RangeError('float64 tensors stay on the CPU (gradient checks, E-ML-05); call .float() first.');
    }
    const rt = gpuRuntime();
    if (!rt) {
      if (request === 'auto') return this;
      throw new Error("No GPU is available here; use to('auto') to fall back to the CPU.");
    }
    // The CPU copy stays valid until a kernel writes to the GPU storage.
    this.gpu = rt.upload(this.cpuData!, true);
    return this;
  }

  // -- Basic properties ------------------------------------------------------

  /** Number of dimensions. */
  get rank(): number {
    return this.shape.length;
  }

  /** Row-major strides (storage is always contiguous). */
  get strides(): number[] {
    return stridesOf(this.shape);
  }

  /** The name of the operation that produced this tensor, or null for a leaf. */
  get op(): string | null {
    return this.node?.op ?? null;
  }

  /** True for tensors created directly (not by an operation). */
  get isLeaf(): boolean {
    return this.node === null;
  }

  /** The value of a one-element tensor as a plain number. */
  item(): number {
    if (this.size !== 1)
      throw new RangeError(`item() needs a single element, got shape ${formatShape(this.shape)}.`);
    return this.data[0]!;
  }

  /** Reads one element: t.get(i, j). */
  get(...index: number[]): number {
    if (index.length !== this.rank) throw new RangeError(`get() needs ${this.rank} indices.`);
    let flat = 0;
    const strides = this.strides;
    for (let i = 0; i < index.length; i++) {
      const d = this.shape[i]!;
      const v = index[i]! < 0 ? index[i]! + d : index[i]!;
      if (v < 0 || v >= d)
        throw new RangeError(`Index ${index[i]} out of range for axis ${i} (size ${d}).`);
      flat += v * strides[i]!;
    }
    return this.data[flat]!;
  }

  /** Nested JavaScript arrays (a plain number for a scalar). */
  toArray(): NestedArray {
    if (this.rank === 0) return this.data[0]!;
    const build = (axis: number, offset: number): NestedArray[] => {
      const n = this.shape[axis]!;
      const stride = this.strides[axis]!;
      const out: NestedArray[] = [];
      for (let i = 0; i < n; i++) {
        out.push(
          axis === this.rank - 1 ? this.data[offset + i]! : build(axis + 1, offset + i * stride),
        );
      }
      return out;
    };
    return build(0, 0);
  }

  /** Plain JSON form `{ shape, data }`, the shape level checks compare against. */
  toJSON(): { shape: number[]; data: number[] } {
    return { shape: [...this.shape], data: Array.from(this.data) };
  }

  toString(): string {
    const where = this.gpu ? ', webgpu' : '';
    const head = `Tensor(${formatShape(this.shape)}, ${this.dtype}${where}${this.requiresGrad ? ', requiresGrad' : ''})`;
    if (this.size > 64) return head;
    if (!this.cpuData) return `${head} (on the GPU: await t.read() to see the values)`;
    return `${head} ${JSON.stringify(this.toArray())}`;
  }

  // -- Copies and conversion -------------------------------------------------

  /** A copy with its own storage (gradients flow through it). */
  clone(): Tensor {
    return this.unary(
      'clone',
      (x) => x,
      () => 1,
      'copy',
    );
  }

  /** The same values, cut off from the autograd graph. */
  detach(): Tensor {
    const out = new Tensor(this.storage, this.shape);
    if (this.gpu) out.cpuData = this.cpuData;
    return out;
  }

  /**
   * Converts to another dtype (gradients flow back in the original dtype),
   * or copies to a device: 'webgpu' (or 'gpu'), 'cpu', or 'auto' (the GPU
   * when available). A device copy is a new leaf that keeps `requiresGrad`.
   */
  to(target: DType | DeviceRequest): Tensor {
    if (target !== 'float32' && target !== 'float64') return this.toDevice(target);
    const dtype = target;
    if (dtype === this.dtype) return this;
    if (this.gpu) throw new RangeError('GPU tensors are float32 only; float64 work (gradient checks) stays on the CPU (E-ML-05).');
    const data = allocate(dtype, this.size);
    data.set(this.data);
    return Tensor.fromOp('to', data, this.shape, [this], (g) => [g.to(this.dtype)]);
  }

  /** Converts to float64. */
  double(): Tensor {
    return this.to('float64');
  }

  /** Converts to float32. */
  float(): Tensor {
    return this.to('float32');
  }

  private toDevice(request: DeviceRequest): Tensor {
    const device = resolveDevice(request);
    if (device === this.device) return this;
    if (device === 'cpu') {
      if (!this.cpuData) throw new DeviceReadError(this.name ? `Tensor '${this.name}'` : undefined);
      return new Tensor(this.cpuData.slice(), this.shape, this.requiresGrad && this.isLeaf);
    }
    const out = new Tensor(this.cpuData!.slice(), this.shape, this.requiresGrad && this.isLeaf);
    out.name = this.name;
    out.moveTo(request);
    return out;
  }

  // -- Autograd --------------------------------------------------------------

  /** Builds an operation result and, when needed, records how to backpropagate. */
  static fromOp(
    op: string,
    data: FloatArray | GpuStorage,
    shape: Shape,
    inputs: Tensor[],
    backward: (grad: Tensor) => (Tensor | null)[],
  ): Tensor {
    const out = new Tensor(data, shape);
    if (gradEnabled && inputs.some((t) => t.requiresGrad)) {
      out.requiresGrad = true;
      out.node = { op, inputs, backward };
    }
    return out;
  }

  /** Also store `.grad` on this non-leaf tensor during `backward()` (handy for teaching). */
  retainGrad(): this {
    this.keepGrad = true;
    return this;
  }

  /** Sets `.grad` back to null. */
  zeroGrad(): void {
    this.grad = null;
  }

  /**
   * Backpropagation: computes d(this)/d(leaf) for every leaf that requires a
   * gradient and adds it to `leaf.grad`. `this` must be a single number (a
   * loss) unless an output gradient is given. The graph is freed afterwards
   * unless `retainGraph` is true.
   */
  backward(grad?: Tensor, options: { retainGraph?: boolean } = {}): void {
    if (!this.requiresGrad) {
      throw new Error(
        'backward(): this tensor does not require a gradient. Did you set requiresGrad on the inputs?',
      );
    }
    // A loss on the GPU is usually reported or read after the step: keep it past the step arena.
    this.gpu?.keep();
    if (!grad && this.size !== 1) {
      throw new Error(
        `backward(): call it on a single number (like a loss), not shape ${formatShape(this.shape)}.`,
      );
    }
    const seed =
      grad ??
      (this.gpu
        ? new Tensor(gpu.gpuFill(this.gpu.runtime, this.shape, 1), this.shape)
        : new Tensor(allocate(this.dtype, 1).fill(1), this.shape));

    // 1. Order the graph so each tensor comes after everything it depends on.
    const order: Tensor[] = [];
    const visited = new Set<Tensor>();
    const stack: [Tensor, boolean][] = [[this, false]];
    while (stack.length > 0) {
      const [t, expanded] = stack.pop()!;
      if (expanded) {
        order.push(t);
        continue;
      }
      if (visited.has(t)) continue;
      visited.add(t);
      stack.push([t, true]);
      for (const input of t.node?.inputs ?? [])
        if (input.requiresGrad && !visited.has(input)) stack.push([input, false]);
    }

    // 2. Walk it backwards, applying the chain rule at each step.
    const grads = new Map<Tensor, Tensor>([[this, seed]]);
    noGrad(() => {
      for (let i = order.length - 1; i >= 0; i--) {
        const t = order[i]!;
        const g = grads.get(t);
        if (!g) continue;
        grads.delete(t);
        if (t.node === null || t.keepGrad) t.grad = t.grad ? t.grad.add(g) : g;
        if (t.node === null) continue;
        const inputGrads = t.node.backward(g);
        t.node.inputs.forEach((input, k) => {
          const ig = inputGrads[k];
          if (!ig || !input.requiresGrad) return;
          const prev = grads.get(input);
          grads.set(input, prev ? prev.add(ig) : ig);
        });
        if (!options.retainGraph) t.node = null;
      }
    });
  }

  // -- Elementwise operations ------------------------------------------------

  private binary(
    op: 'add' | 'sub' | 'mul' | 'div' | 'maximum' | 'minimum',
    other: Tensor | number,
    f: (x: number, y: number) => number,
    gradA: (g: Tensor, a: Tensor, b: Tensor) => Tensor,
    gradB: (g: Tensor, a: Tensor, b: Tensor) => Tensor,
  ): Tensor {
    const b = typeof other === 'number' ? scalar(other, this.dtype) : other;
    const shape = broadcastShapes(this.shape, b.shape);
    let data: FloatArray | GpuStorage;
    if (this.gpu || b.gpu) data = gpu.gpuBinary(op, this, b);
    else {
      data = allocate(resultType(this.dtype, b.dtype), sizeOf(shape));
      binaryKernel(f, this.data, this.shape, b.data, b.shape, data, shape);
    }
    return Tensor.fromOp(op, data, shape, [this, b], (g) => [
      this.requiresGrad ? unbroadcast(gradA(g, this, b), this.shape) : null,
      b.requiresGrad ? unbroadcast(gradB(g, this, b), b.shape) : null,
    ]);
  }

  /**
   * Elementwise function of one tensor. `df(x, y)` is the local derivative
   * dy/dx given the input x and the output y.
   */
  private unary(
    op: string,
    f: (x: number) => number,
    df: (x: number, y: number) => number,
    gpuOp?: K.KernelUnaryOp,
    p0 = 0,
    p1 = 0,
  ): Tensor {
    if (this.gpu) {
      if (!gpuOp) throw new Error(`${op}() is not supported on the GPU yet: use await t.cpu() first.`);
      const y: Tensor = Tensor.fromOp(op, gpu.gpuUnary(gpuOp, this, p0, p1), this.shape, [this], (g) => [
        new Tensor(gpu.gpuUnaryGrad(gpuOp, this, y, g, p0, p1), this.shape),
      ]);
      return y;
    }
    const data = allocate(this.dtype, this.size);
    for (let i = 0; i < data.length; i++) data[i] = f(this.data[i]!);
    return Tensor.fromOp(op, data, this.shape, [this], (g) => {
      const gd = allocate(g.dtype, g.size);
      for (let i = 0; i < gd.length; i++) gd[i] = g.data[i]! * df(this.data[i]!, data[i]!);
      return [new Tensor(gd, g.shape)];
    });
  }

  /** this + other (broadcasting). */
  add(other: Tensor | number): Tensor {
    return this.binary(
      'add',
      other,
      (x, y) => x + y,
      (g) => g,
      (g) => g,
    );
  }

  /** this - other (broadcasting). */
  sub(other: Tensor | number): Tensor {
    return this.binary(
      'sub',
      other,
      (x, y) => x - y,
      (g) => g,
      (g) => g.neg(),
    );
  }

  /** this * other, elementwise (broadcasting). */
  mul(other: Tensor | number): Tensor {
    return this.binary(
      'mul',
      other,
      (x, y) => x * y,
      (g, _a, b) => g.mul(b),
      (g, a) => g.mul(a),
    );
  }

  /** this / other, elementwise (broadcasting). */
  div(other: Tensor | number): Tensor {
    return this.binary(
      'div',
      other,
      (x, y) => x / y,
      (g, _a, b) => g.div(b),
      (g, a, b) => g.mul(a).div(b.mul(b)).neg(),
    );
  }

  /** Elementwise maximum of two tensors (ties send the gradient to `this`). */
  maximum(other: Tensor | number): Tensor {
    return this.binary(
      'maximum',
      other,
      (x, y) => (x >= y ? x : y),
      (g, a, b) => g.mul(a.ge(b)),
      (g, a, b) => g.mul(a.lt(b)),
    );
  }

  /** Elementwise minimum of two tensors (ties send the gradient to `this`). */
  minimum(other: Tensor | number): Tensor {
    return this.binary(
      'minimum',
      other,
      (x, y) => (x <= y ? x : y),
      (g, a, b) => g.mul(a.le(b)),
      (g, a, b) => g.mul(a.gt(b)),
    );
  }

  /** this ** exponent, for a constant exponent. */
  pow(exponent: number): Tensor {
    return this.unary(
      'pow',
      (x) => x ** exponent,
      (x) => exponent * x ** (exponent - 1),
      'pow',
      exponent,
    );
  }

  /** 1.0 where this == other, else 0.0 (no gradient). */
  eq(other: Tensor | number): Tensor {
    return this.compare(other, (x, y) => x === y, 'eq');
  }
  /** 1.0 where this > other, else 0.0 (no gradient). */
  gt(other: Tensor | number): Tensor {
    return this.compare(other, (x, y) => x > y, 'gt');
  }
  /** 1.0 where this >= other, else 0.0 (no gradient). */
  ge(other: Tensor | number): Tensor {
    return this.compare(other, (x, y) => x >= y, 'ge');
  }
  /** 1.0 where this < other, else 0.0 (no gradient). */
  lt(other: Tensor | number): Tensor {
    return this.compare(other, (x, y) => x < y, 'lt');
  }
  /** 1.0 where this <= other, else 0.0 (no gradient). */
  le(other: Tensor | number): Tensor {
    return this.compare(other, (x, y) => x <= y, 'le');
  }

  private compare(
    other: Tensor | number,
    test: (x: number, y: number) => boolean,
    op: 'eq' | 'gt' | 'ge' | 'lt' | 'le',
  ): Tensor {
    const b = typeof other === 'number' ? scalar(other, this.dtype) : other;
    const shape = broadcastShapes(this.shape, b.shape);
    if (this.gpu || b.gpu) return new Tensor(gpu.gpuBinary(op, this, b), shape);
    const data = allocate(this.dtype, sizeOf(shape));
    binaryKernel(
      (x, y) => (test(x, y) ? 1 : 0),
      this.data,
      this.shape,
      b.data,
      b.shape,
      data,
      shape,
    );
    return new Tensor(data, shape);
  }

  neg(): Tensor {
    return this.unary(
      'neg',
      (x) => -x,
      () => -1,
      'neg',
    );
  }
  abs(): Tensor {
    return this.unary('abs', Math.abs, (x) => Math.sign(x), 'abs');
  }
  square(): Tensor {
    return this.unary(
      'square',
      (x) => x * x,
      (x) => 2 * x,
      'square',
    );
  }
  sqrt(): Tensor {
    return this.unary('sqrt', Math.sqrt, (_x, y) => 0.5 / y, 'sqrt');
  }
  exp(): Tensor {
    return this.unary('exp', Math.exp, (_x, y) => y, 'exp');
  }
  log(): Tensor {
    return this.unary('log', Math.log, (x) => 1 / x, 'log');
  }
  sin(): Tensor {
    return this.unary('sin', Math.sin, (x) => Math.cos(x), 'sin');
  }
  cos(): Tensor {
    return this.unary('cos', Math.cos, (x) => -Math.sin(x), 'cos');
  }
  tanh(): Tensor {
    return this.unary('tanh', Math.tanh, (_x, y) => 1 - y * y, 'tanh');
  }
  sigmoid(): Tensor {
    return this.unary(
      'sigmoid',
      (x) => 1 / (1 + Math.exp(-x)),
      (_x, y) => y * (1 - y),
      'sigmoid',
    );
  }
  /** max(0, x). */
  relu(): Tensor {
    return this.unary(
      'relu',
      (x) => (x > 0 ? x : 0),
      (x) => (x > 0 ? 1 : 0),
      'relu',
    );
  }
  /** GELU, tanh approximation (as in GPT-2). */
  gelu(): Tensor {
    const c = Math.sqrt(2 / Math.PI);
    return this.unary(
      'gelu',
      (x) => 0.5 * x * (1 + Math.tanh(c * (x + 0.044715 * x * x * x))),
      (x) => {
        const t = Math.tanh(c * (x + 0.044715 * x * x * x));
        return 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * c * (1 + 3 * 0.044715 * x * x);
      },
      'gelu',
    );
  }
  /** Limits values to [min, max] (gradient 0 outside the range). */
  clamp(min: number, max: number): Tensor {
    return this.unary(
      'clamp',
      (x) => Math.min(max, Math.max(min, x)),
      (x) => (x >= min && x <= max ? 1 : 0),
      'clamp',
      min,
      max,
    );
  }

  /** Replaces values where `mask` is non-zero by `value` (used for the causal attention mask). */
  maskedFill(mask: Tensor, value: number): Tensor {
    const shape = broadcastShapes(this.shape, mask.shape);
    if (!shapesEqual(shape, this.shape)) {
      throw new RangeError(
        `maskedFill: mask ${formatShape(mask.shape)} must broadcast to ${formatShape(this.shape)}.`,
      );
    }
    if (this.gpu || mask.gpu) {
      return Tensor.fromOp('maskedFill', gpu.gpuMaskedFill(this, mask, value), shape, [this], (g) => [
        g.mul(mask.eq(0)),
      ]);
    }
    const data = allocate(this.dtype, this.size);
    binaryKernel(
      (x, m) => (m !== 0 ? value : x),
      this.data,
      this.shape,
      mask.data,
      mask.shape,
      data,
      shape,
    );
    return Tensor.fromOp('maskedFill', data, shape, [this], (g) => [g.mul(mask.eq(0))]);
  }

  // -- Matrix multiply -------------------------------------------------------

  /**
   * Matrix product. [m, k] @ [k, n] -> [m, n]. Leading axes are batch axes
   * and broadcast: [b, m, k] @ [k, n] -> [b, m, n]. A 1-D input is treated as
   * a row (left) or column (right) vector and that axis is dropped again.
   */
  matmul(other: Tensor): Tensor {
    if (this.rank === 0 || other.rank === 0)
      throw new RangeError('matmul: inputs must have at least 1 dimension.');
    if (this.rank === 1) return this.reshape([1, this.size]).matmul(other).squeeze(-2);
    if (other.rank === 1) return this.matmul(other.reshape([other.size, 1])).squeeze(-1);
    const [m, k] = this.shape.slice(-2) as [number, number];
    const [k2, n] = other.shape.slice(-2) as [number, number];
    if (k !== k2) {
      throw new RangeError(
        `matmul: inner sizes differ: ${formatShape(this.shape)} @ ${formatShape(other.shape)} (${k} vs ${k2}).`,
      );
    }
    const aBatch = this.shape.slice(0, -2);
    const bBatch = other.shape.slice(0, -2);
    const outBatch = broadcastShapes(aBatch, bBatch);
    const shape = [...outBatch, m, n];
    if (this.gpu || other.gpu) return this.matmulGpu(other, outBatch, shape);
    const data = allocate(resultType(this.dtype, other.dtype), sizeOf(shape));
    matmulKernel(this.data, aBatch, other.data, bBatch, data, outBatch, m, k, n);
    return Tensor.fromOp('matmul', data, shape, [this, other], (g) => [
      this.requiresGrad ? unbroadcast(g.matmul(other.transpose()), this.shape) : null,
      other.requiresGrad ? unbroadcast(this.transpose().matmul(g), other.shape) : null,
    ]);
  }

  /** matmul of 2-D-or-more tensors on the GPU, with transposed-operand kernels for the backward pass. */
  private matmulGpu(other: Tensor, outBatch: number[], shape: number[]): Tensor {
    const [m, k] = this.shape.slice(-2) as [number, number];
    const n = other.shape.at(-1)!;
    // The kernel handles one un-batched side; a general broadcast expands first.
    const sizeA = sizeOf(this.shape.slice(0, -2));
    const sizeB = sizeOf(other.shape.slice(0, -2));
    const batch = sizeOf(outBatch);
    const a = sizeA === 1 || sizeA === batch ? this : this.expandTo([...outBatch, m, k]);
    const b = sizeB === 1 || sizeB === batch ? other : other.expandTo([...outBatch, k, n]);
    const { storage } = gpu.gpuMatmul(a, b);
    return Tensor.fromOp('matmul', storage, shape, [this, other], (g) => {
      let ga: Tensor | null = null;
      let gb: Tensor | null = null;
      if (this.requiresGrad) ga = unbroadcast(gpuMm(g, b, false, true), this.shape);
      if (other.requiresGrad) {
        if (b.rank === 2 && a.rank > 2) {
          // dB = Aᵀ @ g summed over the batch = (A as [batch·m, k])ᵀ @ (g as [batch·m, n]).
          gb = gpuMm(a.reshape([-1, k]), g.reshape([-1, n]), true, false);
        } else gb = unbroadcast(gpuMm(a, g, true, false), other.shape);
      }
      return [ga, gb];
    });
  }

  /** Dot product of two 1-D tensors. */
  dot(other: Tensor): Tensor {
    if (this.rank !== 1 || other.rank !== 1) throw new RangeError('dot: both inputs must be 1-D.');
    return this.mul(other).sum();
  }

  // -- Reductions ------------------------------------------------------------

  private reduceAxis(kind: 'sum' | 'max' | 'min', axis: number, keepDims: boolean): Tensor {
    const ax = normalizeAxis(axis, this.rank);
    const len = this.shape[ax]!;
    if (len === 0 && kind !== 'sum') throw new RangeError(`${kind}: cannot reduce an empty axis.`);
    const outer = sizeOf(this.shape.slice(0, ax));
    const inner = sizeOf(this.shape.slice(ax + 1));
    const keptShape = this.shape.map((d, i) => (i === ax ? 1 : d));
    if (this.gpu) {
      const out: Tensor = Tensor.fromOp(kind, gpu.gpuReduce(kind, this, outer, len, inner), keptShape, [this], (g) => [
        kind === 'sum'
          ? g.expandTo(this.shape)
          : new Tensor(gpu.gpuReduceGrad(kind, this, g, outer, len, inner), this.shape),
      ]);
      return keepDims ? out : out.reshape(this.shape.filter((_d, i) => i !== ax));
    }
    const data = allocate(this.dtype, outer * inner);
    reduceKernel(kind, this.data, outer, len, inner, data);
    const out: Tensor = Tensor.fromOp(kind, data, keptShape, [this], (g) => {
      if (kind === 'sum') return [g.expandTo(this.shape)];
      // Gradient flows only to the first position that held the max/min.
      const winner = allocate(this.dtype, this.size);
      const best = allocate(this.dtype, outer * inner);
      reduceKernel(kind === 'max' ? 'argmax' : 'argmin', this.data, outer, len, inner, best);
      for (let o = 0; o < outer; o++) {
        for (let i = 0; i < inner; i++) winner[(o * len + best[o * inner + i]!) * inner + i] = 1;
      }
      return [new Tensor(winner, this.shape).mul(g)];
    });
    if (keepDims) return out;
    return out.reshape(this.shape.filter((_d, i) => i !== ax));
  }

  private reduce(
    kind: 'sum' | 'max' | 'min',
    axis: number | number[] | undefined,
    keepDims: boolean,
  ): Tensor {
    const axes =
      axis === undefined
        ? this.shape.map((_d, i) => i)
        : (Array.isArray(axis) ? axis : [axis]).map((a) => normalizeAxis(a, this.rank));
    const descending = [...new Set(axes)].sort((p, q) => q - p);
    const out = descending.reduce<Tensor>((t, ax) => t.reduceAxis(kind, ax, true), this);
    if (keepDims) return out;
    return out.reshape(this.shape.filter((_d, i) => !axes.includes(i)));
  }

  /** Sum over one or more axes (all of them by default). */
  sum(axis?: number | number[], keepDims = false): Tensor {
    return this.reduce('sum', axis, keepDims);
  }

  /** Mean over one or more axes (all of them by default). */
  mean(axis?: number | number[], keepDims = false): Tensor {
    const total = this.sum(axis, keepDims);
    const count = this.size / Math.max(1, total.size); // elements averaged per output
    return total.div(count);
  }

  /** Variance over axes (population variance, divides by N, as LayerNorm uses). */
  variance(axis?: number | number[], keepDims = false): Tensor {
    const centered = this.sub(this.mean(axis, true));
    return centered.square().mean(axis, keepDims);
  }

  /** Maximum over one or more axes (all of them by default). */
  max(axis?: number | number[], keepDims = false): Tensor {
    return this.reduce('max', axis, keepDims);
  }

  /** Minimum over one or more axes (all of them by default). */
  min(axis?: number | number[], keepDims = false): Tensor {
    return this.reduce('min', axis, keepDims);
  }

  /** Index of the largest value along an axis (no gradient). */
  argmax(axis = -1, keepDims = false): Tensor {
    const ax = normalizeAxis(axis, this.rank);
    const outer = sizeOf(this.shape.slice(0, ax));
    const inner = sizeOf(this.shape.slice(ax + 1));
    const shape = keepDims
      ? this.shape.map((d, i) => (i === ax ? 1 : d))
      : this.shape.filter((_d, i) => i !== ax);
    if (this.gpu) return new Tensor(gpu.gpuArg('argmax', this, outer, this.shape[ax]!, inner), shape);
    const data = allocate(this.dtype, outer * inner);
    reduceKernel('argmax', this.data, outer, this.shape[ax]!, inner, data);
    return new Tensor(data, shape);
  }

  /** Softmax along an axis (default: last): exp(x) / sum(exp(x)), numerically stable. */
  softmax(axis = -1): Tensor {
    return this.softmaxImpl(axis, false);
  }

  /** log(softmax(x)) computed stably (use it for cross-entropy). */
  logSoftmax(axis = -1): Tensor {
    return this.softmaxImpl(axis, true);
  }

  private softmaxImpl(axis: number, log: boolean): Tensor {
    const ax = normalizeAxis(axis, this.rank);
    if (ax !== this.rank - 1) return this.transpose(ax, -1).softmaxImpl(-1, log).transpose(ax, -1);
    if (this.gpu) {
      const y: Tensor = Tensor.fromOp(log ? 'logSoftmax' : 'softmax', gpu.gpuSoftmax(this, log), this.shape, [this], (g) => [
        new Tensor(gpu.gpuSoftmaxGrad(y, g, log), this.shape),
      ]);
      return y;
    }
    const cols = this.shape[ax]!;
    const rows = this.size / Math.max(1, cols);
    const data = allocate(this.dtype, this.size);
    softmaxKernel(this.data, rows, cols, data, log);
    const y = new Tensor(data, this.shape);
    return Tensor.fromOp(log ? 'logSoftmax' : 'softmax', data, this.shape, [this], (g) => {
      if (log) {
        // d/dx log_softmax: g - softmax(x) * sum(g)
        return [g.sub(y.exp().mul(g.sum(-1, true)))];
      }
      // d/dx softmax: y * (g - sum(g * y))
      return [y.mul(g.sub(g.mul(y).sum(-1, true)))];
    });
  }

  // -- Shape operations ------------------------------------------------------

  /** Same data, new shape (one entry may be -1 to infer it). */
  reshape(shape: Shape): Tensor {
    const target = inferReshape(this.size, shape);
    if (shapesEqual(target, this.shape)) return this;
    const out = Tensor.fromOp('reshape', this.storage, target, [this], (g) => [g.reshape(this.shape)]);
    if (this.gpu) out.cpuData = this.cpuData;
    return out;
  }

  /** Alias of reshape. */
  view(...shape: number[]): Tensor {
    return this.reshape(shape);
  }

  /** Flattens to 1-D. */
  flatten(): Tensor {
    return this.reshape([this.size]);
  }

  /** Inserts an axis of size 1. */
  unsqueeze(axis: number): Tensor {
    const ax = normalizeAxis(axis, this.rank + 1);
    const shape = [...this.shape];
    shape.splice(ax, 0, 1);
    return this.reshape(shape);
  }

  /** Removes an axis of size 1 (or all of them when no axis is given). */
  squeeze(axis?: number): Tensor {
    if (axis === undefined) return this.reshape(this.shape.filter((d) => d !== 1));
    const ax = normalizeAxis(axis, this.rank);
    if (this.shape[ax] !== 1)
      throw new RangeError(`squeeze: axis ${axis} has size ${this.shape[ax]}, not 1.`);
    return this.reshape(this.shape.filter((_d, i) => i !== ax));
  }

  /** Reorders axes: result axis i is this tensor's axis order[i]. */
  permute(...order: number[]): Tensor {
    const perm = order.map((a) => normalizeAxis(a, this.rank));
    if (perm.length !== this.rank || new Set(perm).size !== this.rank) {
      throw new RangeError(
        `permute: expected a permutation of ${this.rank} axes, got [${order.join(', ')}].`,
      );
    }
    const shape = perm.map((p) => this.shape[p]!);
    const inverse = new Array<number>(perm.length);
    perm.forEach((p, i) => (inverse[p] = i));
    if (this.gpu) {
      return Tensor.fromOp('permute', gpu.gpuPermute(this, perm), shape, [this], (g) => [g.permute(...inverse)]);
    }
    const data = allocate(this.dtype, this.size);
    permuteKernel(this.data, this.shape, perm, data);
    return Tensor.fromOp('permute', data, shape, [this], (g) => [g.permute(...inverse)]);
  }

  /** Swaps two axes (default: the last two, i.e. the matrix transpose). */
  transpose(axis0 = -2, axis1 = -1): Tensor {
    if (this.rank < 2) return this;
    const a = normalizeAxis(axis0, this.rank);
    const b = normalizeAxis(axis1, this.rank);
    if (a === b) return this;
    const perm = this.shape.map((_d, i) => i);
    perm[a] = b;
    perm[b] = a;
    return this.permute(...perm);
  }

  /** Matrix transpose of the last two axes. */
  get T(): Tensor {
    return this.transpose();
  }

  /** Copies this tensor into a larger broadcast-compatible shape. */
  expandTo(shape: Shape): Tensor {
    if (shapesEqual(shape, this.shape)) return this;
    const target = broadcastShapes(this.shape, shape);
    if (!shapesEqual(target, shape)) {
      throw new RangeError(
        `expandTo: ${formatShape(this.shape)} cannot expand to ${formatShape(shape)}.`,
      );
    }
    if (this.gpu) {
      return Tensor.fromOp('expand', gpu.gpuExpand(this, shape), shape, [this], (g) => [unbroadcast(g, this.shape)]);
    }
    const data = allocate(this.dtype, sizeOf(shape));
    expandKernel(this.data, this.shape, data, shape);
    return Tensor.fromOp('expand', data, shape, [this], (g) => [unbroadcast(g, this.shape)]);
  }

  /** Elements start..end-1 along one axis (negative values count from the end). */
  slice(axis: number, start: number, end?: number): Tensor {
    const ax = normalizeAxis(axis, this.rank);
    const d = this.shape[ax]!;
    const clampIndex = (v: number): number => Math.min(d, Math.max(0, v < 0 ? v + d : v));
    const s = clampIndex(start);
    const e = Math.max(s, clampIndex(end ?? d));
    const outer = sizeOf(this.shape.slice(0, ax));
    const inner = sizeOf(this.shape.slice(ax + 1));
    const len = e - s;
    const shape = this.shape.map((v, i) => (i === ax ? len : v));
    if (this.gpu) {
      return Tensor.fromOp('slice', gpu.gpuSlice(this, ax, s, len), shape, [this], (g) => [
        new Tensor(gpu.gpuSliceGrad(g, outer, d, inner, s, len), this.shape),
      ]);
    }
    const data = allocate(this.dtype, outer * len * inner);
    for (let o = 0; o < outer; o++) {
      const from = (o * d + s) * inner;
      data.set(this.data.subarray(from, from + len * inner), o * len * inner);
    }
    return Tensor.fromOp('slice', data, shape, [this], (g) => {
      const gd = allocate(g.dtype, this.size);
      for (let o = 0; o < outer; o++)
        gd.set(g.data.subarray(o * len * inner, (o + 1) * len * inner), (o * d + s) * inner);
      return [new Tensor(gd, this.shape)];
    });
  }

  /**
   * Picks whole slices along an axis by index: for a [vocab, dim] table,
   * indexSelect(0, [3, 1]) returns rows 3 and 1 as [2, dim]. With a tensor of
   * indices of shape S, the result shape is S with the axis replaced.
   * This is how an embedding lookup works.
   */
  indexSelect(axis: number, indices: Indices): Tensor {
    const ax = normalizeAxis(axis, this.rank);
    const idx = toIndexArray(indices);
    const d = this.shape[ax]!;
    const outer = sizeOf(this.shape.slice(0, ax));
    const inner = sizeOf(this.shape.slice(ax + 1));
    for (const i of idx)
      if (i < 0 || i >= d)
        throw new RangeError(`indexSelect: index ${i} out of range (axis size ${d}).`);
    const shape = [...this.shape.slice(0, ax), ...indexShape(indices), ...this.shape.slice(ax + 1)];
    if (this.gpu) {
      return Tensor.fromOp('indexSelect', gpu.gpuIndexSelect(this, idx, outer, d, inner), shape, [this], (g) => {
        // Row (o, idx[j]) of the input receives row (o, j) of g.
        const dest = new Int32Array(outer * idx.length);
        for (let o = 0; o < outer; o++)
          for (let j = 0; j < idx.length; j++) dest[o * idx.length + j] = o * d + idx[j]!;
        return [new Tensor(gpu.gpuScatterAdd(g, dest, outer * d, inner), this.shape)];
      });
    }
    const data = allocate(this.dtype, outer * idx.length * inner);
    for (let o = 0; o < outer; o++) {
      for (let j = 0; j < idx.length; j++) {
        const from = (o * d + idx[j]!) * inner;
        data.set(this.data.subarray(from, from + inner), (o * idx.length + j) * inner);
      }
    }
    return Tensor.fromOp('indexSelect', data, shape, [this], (g) => {
      const gd = allocate(g.dtype, this.size);
      for (let o = 0; o < outer; o++) {
        for (let j = 0; j < idx.length; j++) {
          const to = (o * d + idx[j]!) * inner;
          const from = (o * idx.length + j) * inner;
          for (let i = 0; i < inner; i++) gd[to + i]! += g.data[from + i]!;
        }
      }
      return [new Tensor(gd, this.shape)];
    });
  }

  /**
   * PyTorch-style gather: out[..., i, ...] = this[..., index[..., i, ...], ...]
   * along `axis`. `index` has the same rank as this tensor. Picking the
   * logit of the correct class per row: logits.gather(1, targets.unsqueeze(1)).
   */
  gather(axis: number, index: Tensor): Tensor {
    const ax = normalizeAxis(axis, this.rank);
    if (index.rank !== this.rank)
      throw new RangeError('gather: index must have the same rank as the input.');
    const idx = toIndexArray(index);
    const shape = index.shape;
    const outStrides = stridesOf(shape);
    const inStrides = this.strides;
    const d = this.shape[ax]!;
    const sources = new Int32Array(idx.length);
    for (let flat = 0; flat < idx.length; flat++) {
      let rest = flat;
      let src = 0;
      for (let a = 0; a < shape.length; a++) {
        const i = Math.floor(rest / outStrides[a]!);
        rest -= i * outStrides[a]!;
        const coord = a === ax ? idx[flat]! : i;
        if (coord < 0 || coord >= (a === ax ? d : this.shape[a]!))
          throw new RangeError(`gather: index ${coord} out of range.`);
        src += coord * inStrides[a]!;
      }
      sources[flat] = src;
    }
    if (this.gpu) {
      return Tensor.fromOp('gather', gpu.gpuTake(this, sources), shape, [this], (g) => [
        new Tensor(gpu.gpuScatterAdd(g, sources, this.size, 1), this.shape),
      ]);
    }
    const data = allocate(this.dtype, idx.length);
    for (let i = 0; i < idx.length; i++) data[i] = this.data[sources[i]!]!;
    return Tensor.fromOp('gather', data, shape, [this], (g) => {
      const gd = allocate(g.dtype, this.size);
      for (let i = 0; i < idx.length; i++) gd[sources[i]!]! += g.data[i]!;
      return [new Tensor(gd, this.shape)];
    });
  }

  // -- Fluent aliases for functions defined below ------------------------------

  /** Joins tensors along an existing axis. */
  static concat(tensors: Tensor[], axis = 0): Tensor {
    return concat(tensors, axis);
  }
}

// ---------------------------------------------------------------------------
// Creation functions
// ---------------------------------------------------------------------------

function make(data: FloatArray, shape: Shape, options: TensorOptions): Tensor {
  return new Tensor(data, shape, options.requiresGrad ?? false);
}

/** A tensor from nested arrays, a flat list plus `shape`, or a single number. */
export function tensor(
  values: NestedArray | ArrayLike<number>,
  options: TensorOptions & { shape?: Shape } = {},
): Tensor {
  const dtype = options.dtype ?? 'float32';
  if (typeof values === 'number')
    return make(allocate(dtype, 1).fill(values), options.shape ?? [], options);
  let flat: ArrayLike<number>;
  let shape: number[];
  if (Array.isArray(values)) {
    shape = [];
    const list: number[] = [];
    if (values.length === 0) shape.push(0);
    else flattenNested(values, shape, list, 0);
    flat = list;
  } else {
    flat = values as ArrayLike<number>;
    shape = [flat.length];
  }
  if (options.shape) shape = inferReshape(flat.length, options.shape);
  const data = allocate(dtype, flat.length);
  data.set(flat);
  return make(data, shape, options);
}

/** Same as `tensor()`: build from nested arrays or a flat list plus a shape. */
export const fromArray = tensor;

/** A one-element tensor of shape [] (a scalar). */
export function scalar(value: number, dtype: DType = 'float32'): Tensor {
  return new Tensor(allocate(dtype, 1).fill(value), []);
}

/** A tensor of the given shape filled with `value`. */
export function full(shape: Shape, value: number, options: TensorOptions = {}): Tensor {
  checkShape(shape);
  return make(allocate(options.dtype ?? 'float32', sizeOf(shape)).fill(value), shape, options);
}

/** All zeros. */
export function zeros(shape: Shape, options: TensorOptions = {}): Tensor {
  return full(shape, 0, options);
}

/** All ones. */
export function ones(shape: Shape, options: TensorOptions = {}): Tensor {
  return full(shape, 1, options);
}

/** Zeros with the same shape and dtype as `t`. */
export function zerosLike(t: Tensor, options: TensorOptions = {}): Tensor {
  return zeros(t.shape, { dtype: t.dtype, ...options });
}

/** Ones with the same shape and dtype as `t`. */
export function onesLike(t: Tensor, options: TensorOptions = {}): Tensor {
  return ones(t.shape, { dtype: t.dtype, ...options });
}

/** [start, start + step, ...] stopping before `end`; arange(5) = [0, 1, 2, 3, 4]. */
export function arange(start: number, end?: number, step = 1, options: TensorOptions = {}): Tensor {
  const [lo, hi] = end === undefined ? [0, start] : [start, end];
  if (step === 0) throw new RangeError('arange: step must not be 0.');
  const n = Math.max(0, Math.ceil((hi - lo) / step));
  const data = allocate(options.dtype ?? 'float32', n);
  for (let i = 0; i < n; i++) data[i] = lo + i * step;
  return make(data, [n], options);
}

/** `n` evenly spaced values from start to end inclusive. */
export function linspace(
  start: number,
  end: number,
  n: number,
  options: TensorOptions = {},
): Tensor {
  const data = allocate(options.dtype ?? 'float32', n);
  for (let i = 0; i < n; i++) data[i] = n === 1 ? start : start + ((end - start) * i) / (n - 1);
  return make(data, [n], options);
}

/** The n×n identity matrix. */
export function eye(n: number, options: TensorOptions = {}): Tensor {
  const t = zeros([n, n], options);
  for (let i = 0; i < n; i++) t.data[i * n + i] = 1;
  return t;
}

/** Uniform random values in [0, 1) from a seeded generator. */
export function rand(shape: Shape, options: RandomOptions = {}): Tensor {
  const rng = options.rng ?? defaultRng();
  const t = zeros(shape, options);
  for (let i = 0; i < t.size; i++) t.data[i] = rng.uniform();
  return t;
}

/** Uniform random values in [low, high) from a seeded generator. */
export function uniform(
  shape: Shape,
  low: number,
  high: number,
  options: RandomOptions = {},
): Tensor {
  const rng = options.rng ?? defaultRng();
  const t = zeros(shape, options);
  for (let i = 0; i < t.size; i++) t.data[i] = rng.range(low, high);
  return t;
}

/** Normally distributed random values (mean 0, std 1) from a seeded generator. */
export function randn(shape: Shape, options: RandomOptions = {}): Tensor {
  const rng = options.rng ?? defaultRng();
  const t = zeros(shape, options);
  for (let i = 0; i < t.size; i++) t.data[i] = rng.normal();
  return t;
}

/** Random integers in [low, high) (stored as floats). */
export function randint(
  low: number,
  high: number,
  shape: Shape,
  options: RandomOptions = {},
): Tensor {
  const rng = options.rng ?? defaultRng();
  const t = zeros(shape, options);
  for (let i = 0; i < t.size; i++) t.data[i] = low + rng.int(high - low);
  return t;
}

/** Upper-triangular mask: 1 above the diagonal (j > i), 0 elsewhere. Used as a causal mask. */
export function triuMask(n: number, options: TensorOptions = {}): Tensor {
  const t = zeros([n, n], options);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) t.data[i * n + j] = 1;
  return t;
}

// ---------------------------------------------------------------------------
// Functions on several tensors
// ---------------------------------------------------------------------------

/** Joins tensors along an existing axis; all other axes must match. */
export function concat(tensors: Tensor[], axis = 0): Tensor {
  if (tensors.length === 0) throw new RangeError('concat: need at least one tensor.');
  const first = tensors[0]!;
  const ax = normalizeAxis(axis, first.rank);
  let dtype: DType = 'float32';
  for (const t of tensors) {
    if (t.rank !== first.rank || t.shape.some((d, i) => i !== ax && d !== first.shape[i])) {
      throw new RangeError(
        `concat: shapes ${tensors.map((x) => formatShape(x.shape)).join(', ')} differ outside axis ${axis}.`,
      );
    }
    dtype = resultType(dtype, t.dtype);
  }
  const lengths = tensors.map((t) => t.shape[ax]!);
  const total = lengths.reduce((p, q) => p + q, 0);
  const outer = sizeOf(first.shape.slice(0, ax));
  const inner = sizeOf(first.shape.slice(ax + 1));
  const shape = first.shape.map((d, i) => (i === ax ? total : d));
  const backward = (g: Tensor): Tensor[] => {
    let start = 0;
    return lengths.map((len) => {
      const part = g.slice(ax, start, start + len);
      start += len;
      return part;
    });
  };
  if (tensors.some((t) => t.gpu)) return Tensor.fromOp('concat', gpu.gpuConcat(tensors, ax, shape), shape, tensors, backward);
  const data = allocate(dtype, outer * total * inner);
  let offset = 0;
  tensors.forEach((t, k) => {
    const len = lengths[k]!;
    for (let o = 0; o < outer; o++) {
      data.set(
        t.data.subarray(o * len * inner, (o + 1) * len * inner),
        (o * total + offset) * inner,
      );
    }
    offset += len;
  });
  return Tensor.fromOp('concat', data, shape, tensors, backward);
}

/** Stacks same-shaped tensors along a new axis. */
export function stack(tensors: Tensor[], axis = 0): Tensor {
  return concat(
    tensors.map((t) => t.unsqueeze(axis)),
    axis,
  );
}

/** a @ b. */
export function matmul(a: Tensor, b: Tensor): Tensor {
  return a.matmul(b);
}

/** Picks `cond ? a : b` elementwise (cond is non-zero / zero). Gradients flow to a and b. */
export function where(cond: Tensor, a: Tensor | number, b: Tensor | number): Tensor {
  const ta = typeof a === 'number' ? scalar(a, cond.dtype) : a;
  const tb = typeof b === 'number' ? scalar(b, cond.dtype) : b;
  const isZero = cond.eq(0);
  return ta.mul(isZero.neg().add(1)).add(tb.mul(isZero));
}

/** Draws one index from a 1-D tensor of probabilities (for sampling text). */
export function sampleCategorical(probs: Tensor, rng: Rng = defaultRng()): number {
  if (probs.rank !== 1)
    throw new RangeError('sampleCategorical: expected a 1-D tensor of probabilities.');
  return rng.categorical(probs.data);
}

/** True when every pair of values is within atol + rtol * |b| (never exact float equality, E-ML-02). */
export function allClose(a: Tensor, b: Tensor | NestedArray, rtol = 1e-5, atol = 1e-6): boolean {
  const tb = b instanceof Tensor ? b : tensor(b, { dtype: 'float64' });
  if (!shapesEqual(a.shape, tb.shape)) return false;
  for (let i = 0; i < a.size; i++) {
    const x = a.data[i]!;
    const y = tb.data[i]!;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x === y) continue; // also covers matching infinities
    if (!(Math.abs(x - y) <= atol + rtol * Math.abs(y))) return false;
  }
  return true;
}
