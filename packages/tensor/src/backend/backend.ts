/**
 * One interface for the compute backends. The CPU backend runs the typed-array
 * kernels; the WebGPU backend (webgpu.ts) runs WGSL kernels. Calls are async
 * because reading results back from a GPU is. Neither records autograd: they
 * accelerate forward computation (inference, sampling, benchmarks); training
 * with gradients runs on the Tensor class.
 */
import { noGrad, Tensor } from '../tensor';
import type { GpuBinaryOp, GpuLimits, GpuReduceOp, GpuUnaryOp } from './wgsl';

export type { GpuBinaryOp as BinaryOp, GpuUnaryOp as UnaryOp, GpuReduceOp as ReduceOp };

/** What every backend can do. */
export interface ComputeBackend {
  readonly name: 'cpu' | 'webgpu';
  /** a @ b with batch broadcasting. */
  matmul(a: Tensor, b: Tensor): Promise<Tensor>;
  /** Elementwise op with broadcasting. */
  binary(op: GpuBinaryOp, a: Tensor, b: Tensor): Promise<Tensor>;
  /** Elementwise function. */
  unary(op: GpuUnaryOp, x: Tensor): Promise<Tensor>;
  /** Sum or max over one axis (the axis is removed). */
  reduce(op: GpuReduceOp, x: Tensor, axis: number): Promise<Tensor>;
  /** Softmax over the last axis. */
  softmax(x: Tensor): Promise<Tensor>;
  /** Layer norm (no scale/shift) over the last axis. */
  layerNorm(x: Tensor, eps?: number): Promise<Tensor>;
  /** Frees GPU resources. */
  dispose(): void;
}

/** The reference backend: Tensor operations on typed arrays. */
export class CpuBackend implements ComputeBackend {
  readonly name = 'cpu' as const;

  async matmul(a: Tensor, b: Tensor): Promise<Tensor> {
    return noGrad(() => a.matmul(b));
  }

  async binary(op: GpuBinaryOp, a: Tensor, b: Tensor): Promise<Tensor> {
    return noGrad(() => a[op](b));
  }

  async unary(op: GpuUnaryOp, x: Tensor): Promise<Tensor> {
    return noGrad(() => x[op]());
  }

  async reduce(op: GpuReduceOp, x: Tensor, axis: number): Promise<Tensor> {
    return noGrad(() => (op === 'sum' ? x.sum(axis) : x.max(axis)));
  }

  async softmax(x: Tensor): Promise<Tensor> {
    return noGrad(() => x.softmax(-1));
  }

  async layerNorm(x: Tensor, eps = 1e-5): Promise<Tensor> {
    return noGrad(() => {
      const centered = x.sub(x.mean(-1, true));
      return centered.div(centered.square().mean(-1, true).add(eps).sqrt());
    });
  }

  dispose(): void {}
}

// ---------------------------------------------------------------------------
// Fitting a model to the device (E-ML-04, and the smaller CPU config of E-ML-01)
// ---------------------------------------------------------------------------

/** Size of a GPT-style model and its training batch. */
export interface ModelConfig {
  vocabSize: number;
  dModel: number;
  nHeads: number;
  nLayers: number;
  contextLength: number;
  batchSize: number;
}

/** Memory a backend can offer. */
export interface MemoryBudget {
  /** Largest single buffer, in bytes. */
  maxBufferBytes: number;
  /** All buffers together, in bytes. */
  totalBytes: number;
}

/** A conservative budget for CPU training in a browser tab. */
export const CPU_BUDGET: MemoryBudget = { maxBufferBytes: 64 * 2 ** 20, totalBytes: 256 * 2 ** 20 };

/** The budget a GPU's limits allow (total: a quarter of the max buffer size times 8, a rough guess). */
export function gpuBudget(limits: GpuLimits): MemoryBudget {
  const maxBufferBytes = Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize);
  return { maxBufferBytes, totalBytes: maxBufferBytes * 4 };
}

/** Estimated memory for training a config in float32 (Adam: weights, grads, m, v). */
export function estimateMemory(c: ModelConfig): {
  params: number;
  largestBufferBytes: number;
  totalBytes: number;
} {
  const d = c.dModel;
  const perLayer = 4 * d * d + 4 * d + 2 * (4 * d * d) + 5 * d + 4 * d; // attention + MLP + norms
  const params =
    c.vocabSize * d +
    c.contextLength * d +
    c.nLayers * perLayer +
    2 * d +
    d * c.vocabSize +
    c.vocabSize;
  const tokens = c.batchSize * c.contextLength;
  const buffers = [
    c.vocabSize * d, // embedding table / output projection
    4 * d * d, // MLP weight
    tokens * 4 * d, // MLP activations
    c.batchSize * c.nHeads * c.contextLength * c.contextLength, // attention scores
    tokens * c.vocabSize, // logits
  ];
  const largestBufferBytes = 4 * Math.max(...buffers);
  // Activations kept for backward: roughly 16 vectors of width d per token per layer, plus scores and logits.
  const activations =
    c.nLayers * (tokens * 16 * d + 2 * c.batchSize * c.nHeads * c.contextLength * c.contextLength) +
    2 * tokens * c.vocabSize;
  return { params, largestBufferBytes, totalBytes: 4 * (4 * params + activations) };
}

/** The result of `fitConfig`. */
export interface FittedConfig {
  config: ModelConfig;
  /** True if anything was made smaller. */
  scaled: boolean;
  /** Explanation for the player (empty when nothing changed). */
  message: string;
}

/**
 * Shrinks a config until it fits the budget: first the batch, then the
 * context, then the width, then the depth. Returns the new config and a
 * message saying what changed (E-ML-04).
 */
export function fitConfig(config: ModelConfig, budget: MemoryBudget): FittedConfig {
  const c = { ...config };
  const fits = (): boolean => {
    const m = estimateMemory(c);
    return m.largestBufferBytes <= budget.maxBufferBytes && m.totalBytes <= budget.totalBytes;
  };
  const changes: string[] = [];
  const shrink = (key: keyof ModelConfig, min: number, next: (v: number) => number): void => {
    const before = c[key];
    while (!fits() && c[key] > min) c[key] = Math.max(min, next(c[key]));
    if (c[key] !== before) changes.push(`${key} ${before} → ${c[key]}`);
  };
  shrink('batchSize', 1, (v) => Math.floor(v / 2));
  shrink('contextLength', 8, (v) => Math.floor(v / 2));
  // Keep dModel a multiple of nHeads.
  shrink('dModel', c.nHeads, (v) => Math.max(c.nHeads, Math.floor(v / 2 / c.nHeads) * c.nHeads));
  shrink('nLayers', 1, (v) => v - 1);
  if (!fits()) {
    throw new RangeError(
      `This model cannot fit even at its smallest (${formatConfig(c)}). Use a smaller vocabulary.`,
    );
  }
  if (changes.length === 0) return { config: c, scaled: false, message: '' };
  return {
    config: c,
    scaled: true,
    message: `The model was too big for this device's memory, so it was scaled down: ${changes.join(', ')}.`,
  };
}

function formatConfig(c: ModelConfig): string {
  return Object.entries(c)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}
