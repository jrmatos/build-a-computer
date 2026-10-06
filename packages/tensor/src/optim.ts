/**
 * The 'optim' module: optimizers that update parameters from their gradients,
 * gradient clipping, learning-rate schedules, and a NaN/Inf guard.
 *
 * Parameters on the GPU (`model.to('auto')`) are updated by GPU kernels;
 * their optimizer state stays on the GPU too. Each step() also ends a GPU
 * memory window (gpu-runtime.ts): intermediate GPU results not used during
 * the step are recycled.
 *
 * The training loop every level uses:
 *   const opt = new Adam(model.parameters(), { lr: 1e-3 });
 *   for (let step = 0; step < steps; step++) {
 *     opt.zeroGrad();
 *     const loss = lossFn(model.forward(x), y);
 *     assertFinite(loss, { step, lr: opt.lr });
 *     loss.backward();
 *     opt.step();
 *   }
 */
import type { FloatArray } from './backend/cpu-kernels';
import { gpuAdam, gpuNonFinite, gpuSgd } from './backend/gpu-ops';
import type { GpuRuntime, GpuStorage } from './backend/gpu-runtime';
import { DeviceReadError, Tensor } from './tensor';

/** Saved optimizer state: hyperparameters, step count and per-parameter buffers. */
export interface OptimizerState {
  kind: string;
  lr: number;
  stepCount: number;
  buffers: Record<string, number[][]>;
}

/** Base class: holds the parameters and the learning rate. */
export abstract class Optimizer {
  /** Name saved in checkpoints ('SGD', 'Adam', 'AdamW'). */
  abstract readonly kind: string;
  readonly params: Tensor[];
  /** Learning rate; schedules change it between steps. */
  lr: number;
  /** Number of `step()` calls so far. */
  stepCount = 0;

  constructor(params: Tensor[], lr: number) {
    if (!(lr > 0)) throw new RangeError('Optimizer: lr must be a positive number.');
    this.params = params;
    this.lr = lr;
  }

  /** Clears every parameter's gradient (call before each `backward()`). */
  zeroGrad(): void {
    for (const p of this.params) p.grad = null;
  }

  /** Applies one update to every parameter that has a gradient. */
  step(): void {
    this.stepCount++;
    const runtimes = new Set<GpuRuntime>();
    this.params.forEach((p, i) => {
      if (!p.grad) return;
      if (p.gpu) {
        this.updateGpu(p.gpu, p.grad, i);
        p.dropCpuCopy();
        runtimes.add(p.gpu.runtime);
      } else this.update(p.data, p.grad.data, i);
    });
    for (const rt of runtimes) rt.endStep();
  }

  /** Updates one parameter's values in place from its gradient. */
  protected abstract update(value: FloatArray, grad: FloatArray, index: number): void;

  /** The same update for a parameter on the GPU. */
  protected abstract updateGpu(value: GpuStorage, grad: Tensor, index: number): void;

  /** GPU copies of the per-parameter buffers, made on the first GPU step. */
  protected gpuState = new Map<number, Record<string, GpuStorage>>();

  /** The GPU buffers of parameter `index` (uploaded from the CPU buffers the first time). */
  protected gpuBuffers(value: GpuStorage, index: number): Record<string, GpuStorage> {
    let state = this.gpuState.get(index);
    if (!state) {
      state = {};
      for (const [name, list] of Object.entries(this.buffers()))
        state[name] = value.runtime.upload(Float32Array.from(list[index]!), true);
      this.gpuState.set(index, state);
    }
    return state;
  }

  /** Named per-parameter buffers (momentum etc.) to save in checkpoints. */
  protected abstract buffers(): Record<string, FloatArray[]>;

  /** A JSON-safe snapshot so training can resume from a checkpoint (E-ML-06). */
  stateDict(): OptimizerState {
    if (this.gpuState.size > 0 && !this.cpuSynced) {
      throw new Error('stateDict(): the optimizer state is on the GPU. Use await opt.readStateDict().');
    }
    const buffers: OptimizerState['buffers'] = {};
    for (const [name, list] of Object.entries(this.buffers()))
      buffers[name] = list.map((b) => Array.from(b));
    return { kind: this.kind, lr: this.lr, stepCount: this.stepCount, buffers };
  }

  /** True right after readStateDict(): the CPU buffers match the GPU ones. */
  private cpuSynced = false;

  /** stateDict() that first copies GPU optimizer state back (works on either device). */
  async readStateDict(): Promise<OptimizerState> {
    const buffers = this.buffers();
    for (const [index, state] of this.gpuState) {
      for (const [name, storage] of Object.entries(state)) {
        const values = await storage.runtime.read(storage);
        buffers[name]![index]!.set(values.subarray(0, buffers[name]![index]!.length));
      }
    }
    this.cpuSynced = true;
    try {
      return this.stateDict();
    } finally {
      this.cpuSynced = false;
    }
  }

  /** Restores a snapshot from `stateDict()`. */
  loadStateDict(state: OptimizerState): void {
    if (state.kind !== this.kind) {
      throw new Error(`loadStateDict: saved state is for ${state.kind}, not ${this.kind}.`);
    }
    this.lr = state.lr;
    this.stepCount = state.stepCount;
    for (const [name, list] of Object.entries(this.buffers())) {
      const saved = state.buffers[name];
      if (!saved || saved.length !== list.length)
        throw new Error(`loadStateDict: buffer ${name} does not match.`);
      list.forEach((b, i) => {
        if (saved[i]!.length !== b.length)
          throw new Error(`loadStateDict: buffer ${name}[${i}] has the wrong size.`);
        b.set(saved[i]!);
        const gpu = this.gpuState.get(i)?.[name];
        if (gpu) gpu.runtime.write(gpu, Float32Array.from(b));
      });
    }
  }
}

function zerosLikeEach(params: Tensor[]): FloatArray[] {
  return params.map((p) =>
    p.dtype === 'float64' ? new Float64Array(p.size) : new Float32Array(p.size),
  );
}

/**
 * Stochastic gradient descent: p -= lr * grad. With momentum, a running
 * velocity v = momentum * v + grad is used instead of the raw gradient.
 */
export class SGD extends Optimizer {
  readonly kind: string = 'SGD';
  momentum: number;
  weightDecay: number;
  private velocity: FloatArray[];

  constructor(params: Tensor[], options: { lr: number; momentum?: number; weightDecay?: number }) {
    super(params, options.lr);
    this.momentum = options.momentum ?? 0;
    this.weightDecay = options.weightDecay ?? 0;
    this.velocity = zerosLikeEach(params);
  }

  protected update(value: FloatArray, grad: FloatArray, index: number): void {
    const v = this.velocity[index]!;
    for (let i = 0; i < value.length; i++) {
      const g = grad[i]! + this.weightDecay * value[i]!;
      v[i] = this.momentum * v[i]! + g;
      value[i]! -= this.lr * v[i]!;
    }
  }

  protected updateGpu(value: GpuStorage, grad: Tensor, index: number): void {
    const { velocity } = this.gpuBuffers(value, index);
    gpuSgd(value, grad, velocity!, this.lr, this.momentum, this.weightDecay);
  }

  protected buffers(): Record<string, FloatArray[]> {
    return { velocity: this.velocity };
  }
}

/** Options for Adam and AdamW. */
export interface AdamOptions {
  lr: number;
  /** Decay rates for the running mean of gradients and of squared gradients. */
  betas?: [number, number];
  eps?: number;
  weightDecay?: number;
}

/**
 * Adam: keeps a running mean (m) and a running mean of squares (v) of each
 * gradient, corrects their start-up bias, and steps by lr * m / (sqrt(v) + eps).
 * Weight decay here is plain L2 (added to the gradient).
 */
export class Adam extends Optimizer {
  readonly kind: string = 'Adam';
  beta1: number;
  beta2: number;
  eps: number;
  weightDecay: number;
  protected m: FloatArray[];
  protected v: FloatArray[];
  /** AdamW sets this: decay the weights directly instead of through the gradient. */
  protected decoupled = false;

  constructor(params: Tensor[], options: AdamOptions) {
    super(params, options.lr);
    [this.beta1, this.beta2] = options.betas ?? [0.9, 0.999];
    this.eps = options.eps ?? 1e-8;
    this.weightDecay = options.weightDecay ?? 0;
    this.m = zerosLikeEach(params);
    this.v = zerosLikeEach(params);
  }

  protected update(value: FloatArray, grad: FloatArray, index: number): void {
    const m = this.m[index]!;
    const v = this.v[index]!;
    const correction1 = 1 - this.beta1 ** this.stepCount;
    const correction2 = 1 - this.beta2 ** this.stepCount;
    for (let i = 0; i < value.length; i++) {
      let g = grad[i]!;
      if (this.decoupled) value[i]! -= this.lr * this.weightDecay * value[i]!;
      else g += this.weightDecay * value[i]!;
      m[i] = this.beta1 * m[i]! + (1 - this.beta1) * g;
      v[i] = this.beta2 * v[i]! + (1 - this.beta2) * g * g;
      const mHat = m[i]! / correction1;
      const vHat = v[i]! / correction2;
      value[i]! -= (this.lr * mHat) / (Math.sqrt(vHat) + this.eps);
    }
  }

  protected updateGpu(value: GpuStorage, grad: Tensor, index: number): void {
    const { m, v } = this.gpuBuffers(value, index);
    gpuAdam(value, grad, m!, v!, {
      lr: this.lr,
      beta1: this.beta1,
      beta2: this.beta2,
      eps: this.eps,
      weightDecay: this.weightDecay,
      c1: 1 - this.beta1 ** this.stepCount,
      c2: 1 - this.beta2 ** this.stepCount,
      decoupled: this.decoupled,
    });
  }

  protected buffers(): Record<string, FloatArray[]> {
    return { m: this.m, v: this.v };
  }
}

/** Adam with decoupled weight decay (default 0.01), the usual choice for transformers. */
export class AdamW extends Adam {
  override readonly kind: string = 'AdamW';
  constructor(params: Tensor[], options: AdamOptions) {
    super(params, { weightDecay: 0.01, ...options });
    this.decoupled = true;
  }
}

/**
 * Scales all gradients down so their combined length (L2 norm) is at most
 * `maxNorm`. Returns the norm before clipping (on the GPU, as a one-element
 * GPU tensor, so nothing waits: report() it or await norm.itemAsync()). Gradients are replaced, not
 * edited in place, because several parameters may share one gradient tensor.
 */
export function clipGradNorm(params: Tensor[], maxNorm: number): number | Tensor {
  if (params.some((p) => p.grad?.gpu)) {
    // Everything on the GPU, no readback: scale = maxNorm / max(norm, maxNorm).
    let total: Tensor | null = null;
    for (const p of params) {
      if (!p.grad) continue;
      const s = p.grad.square().sum();
      total = total ? total.add(s) : s;
    }
    const norm = total!.sqrt();
    const scale = norm.maximum(maxNorm).pow(-1).mul(maxNorm);
    for (const p of params) if (p.grad) p.grad = p.grad.mul(scale);
    return norm;
  }
  let total = 0;
  for (const p of params) if (p.grad) for (const g of p.grad.data) total += g * g;
  const norm = Math.sqrt(total);
  if (norm > maxNorm && norm > 0) {
    const scale = maxNorm / norm;
    for (const p of params) if (p.grad) p.grad = p.grad.mul(scale);
  }
  return norm;
}

/** Clamps every gradient value into [-limit, limit] (replacing the gradient tensors). */
export function clipGradValue(params: Tensor[], limit: number): void {
  for (const p of params) if (p.grad) p.grad = p.grad.clamp(-limit, limit);
}

// ---------------------------------------------------------------------------
// Learning-rate schedules: functions from step number to learning rate.
// Use them as `opt.lr = schedule(step)` before `opt.step()`.
// ---------------------------------------------------------------------------

/** A learning-rate schedule. */
export type Schedule = (step: number) => number;

/** The same rate forever. */
export function constantLR(lr: number): Schedule {
  return () => lr;
}

/** Multiplies the rate by `gamma` every `stepSize` steps. */
export function stepLR(lr: number, stepSize: number, gamma = 0.1): Schedule {
  return (step) => lr * gamma ** Math.floor(step / stepSize);
}

/** Exponential decay: lr * gamma^step. */
export function exponentialLR(lr: number, gamma: number): Schedule {
  return (step) => lr * gamma ** step;
}

/**
 * Linear warm-up for `warmup` steps, then cosine decay to `minLr` at
 * `total` steps (held there afterwards). The usual transformer schedule.
 */
export function cosineLR(
  lr: number,
  total: number,
  options: { warmup?: number; minLr?: number } = {},
): Schedule {
  const warmup = options.warmup ?? 0;
  const minLr = options.minLr ?? 0;
  return (step) => {
    if (step < warmup) return (lr * (step + 1)) / warmup;
    const progress = Math.min(1, (step - warmup) / Math.max(1, total - warmup));
    return minLr + 0.5 * (lr - minLr) * (1 + Math.cos(Math.PI * progress));
  };
}

// ---------------------------------------------------------------------------
// NaN / Inf guard (E-ML-03)
// ---------------------------------------------------------------------------

/** Thrown when a loss or gradient stops being a finite number. */
export class NonFiniteError extends Error {
  readonly step: number | undefined;
  readonly value: number;

  constructor(what: string, value: number, step?: number, lr?: number) {
    const where = step === undefined ? '' : ` at step ${step}`;
    const advice =
      lr === undefined
        ? 'Try a lower learning rate or clip the gradients.'
        : `The learning rate ${lr} is probably too high: try ${lr / 10} or clip the gradients.`;
    super(
      `${what} became ${value}${where}. The values exploded (or a log/divide hit 0), so training stopped. ${advice}`,
    );
    this.name = 'NonFiniteError';
    this.step = step;
    this.value = value;
  }
}

/** True when every value is a finite number (not NaN, not ±Infinity). */
export function isFiniteTensor(t: Tensor | number): boolean {
  if (typeof t === 'number') return Number.isFinite(t);
  if (!t.readable) throw new DeviceReadError('isFiniteTensor: this tensor');
  for (const v of t.data) if (!Number.isFinite(v)) return false;
  return true;
}

// GPU checks run without waiting: a flag is computed on the GPU and read
// back in the background; a failure is thrown by the next assertFinite call
// (or by flushFiniteChecks, which the sandbox awaits before finishing).
const pendingChecks = new Set<Promise<void>>();
let failedCheck: NonFiniteError | null = null;

function throwFailedCheck(): void {
  if (!failedCheck) return;
  const err = failedCheck;
  failedCheck = null;
  throw err;
}

function checkOnGpu(t: Tensor, context: { step?: number; lr?: number; what?: string }): void {
  const flag = new Tensor(gpuNonFinite(t), [1]);
  const check = flag
    .read()
    .then((values) => {
      if (values[0] !== 0 && !failedCheck)
        failedCheck = new NonFiniteError(context.what ?? 'The loss', NaN, context.step, context.lr);
    })
    .catch(() => {
      /* device lost: reported by the next GPU operation */
    })
    .finally(() => pendingChecks.delete(check));
  pendingChecks.add(check);
}

/** Waits for the background GPU checks of assertFinite and throws the first failure. */
export async function flushFiniteChecks(): Promise<void> {
  while (pendingChecks.size > 0) await Promise.all([...pendingChecks]);
  throwFailedCheck();
}

/**
 * Throws a NonFiniteError, with advice to lower the learning rate, if the
 * loss is NaN or infinite. Call it every step before `backward()`. For a
 * loss on the GPU the check runs in the background (no waiting): a failure
 * is thrown by a later call, a step or two late.
 */
export function assertFinite(
  loss: Tensor | number,
  context: { step?: number; lr?: number; what?: string } = {},
): void {
  throwFailedCheck();
  if (typeof loss !== 'number' && loss.gpu && !loss.readable) {
    checkOnGpu(loss, context);
    return;
  }
  if (isFiniteTensor(loss)) return;
  const value =
    typeof loss === 'number'
      ? loss
      : (Array.from(loss.data).find((v) => !Number.isFinite(v)) ?? NaN);
  throw new NonFiniteError(context.what ?? 'The loss', value, context.step, context.lr);
}

/** Like `assertFinite`, but checks every parameter's gradient. */
export function assertFiniteGrads(
  params: Tensor[],
  context: { step?: number; lr?: number } = {},
): void {
  params.forEach((p, i) => {
    if (p.grad?.gpu && !p.grad.readable) {
      assertFinite(p.grad, { ...context, what: `The gradient of parameter ${p.name || i}` });
      return;
    }
    if (p.grad && !isFiniteTensor(p.grad)) {
      assertFinite(p.grad, { ...context, what: `The gradient of parameter ${p.name || i}` });
    }
  });
}

// ---------------------------------------------------------------------------
// Checkpoints (E-ML-06): the app stores these JSON objects in IndexedDB.
// ---------------------------------------------------------------------------

/** Everything needed to resume training. */
export interface Checkpoint {
  version: 1;
  step: number;
  model: Record<string, { shape: number[]; data: number[] }>;
  optimizer: OptimizerState;
}

/** Bundles a model's and an optimizer's state into one JSON-safe object. */
export function saveCheckpoint(
  model: { stateDict(): Checkpoint['model'] },
  optimizer: Optimizer,
  step = optimizer.stepCount,
): Checkpoint {
  return { version: 1, step, model: model.stateDict(), optimizer: optimizer.stateDict() };
}

/** Restores a checkpoint into a model and optimizer; returns the saved step. */
export function loadCheckpoint(
  checkpoint: Checkpoint,
  model: { loadStateDict(state: Checkpoint['model']): void },
  optimizer: Optimizer,
): number {
  if (checkpoint.version !== 1)
    throw new Error(`loadCheckpoint: unknown checkpoint version ${String(checkpoint.version)}.`);
  model.loadStateDict(checkpoint.model);
  optimizer.loadStateDict(checkpoint.optimizer);
  return checkpoint.step;
}
