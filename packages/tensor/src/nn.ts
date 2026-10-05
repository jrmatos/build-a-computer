/**
 * The 'nn' module: layers built from Tensor operations, plus losses.
 *
 * A layer is a `Module`: it holds parameters (tensors with `requiresGrad`)
 * and has a `forward(x)` method. Modules nest; `parameters()` finds every
 * parameter inside, and `stateDict()` / `loadStateDict()` save and restore
 * them (checkpoints, E-ML-06).
 */
import { defaultRng, type Rng } from './random';
import { formatShape, shapesEqual } from './shape';
import {
  noGrad,
  ones,
  randn,
  tensor,
  Tensor,
  triuMask,
  uniform,
  zeros,
  type DType,
  type Indices,
} from './tensor';

/** Saved parameters: name -> plain `{ shape, data }`, safe to JSON-encode. */
export type StateDict = Record<string, { shape: number[]; data: number[] }>;

/** Options most layers accept. */
export interface LayerOptions {
  /** Generator for the initial weights (default: the shared seeded one). */
  rng?: Rng;
  dtype?: DType;
}

/** Base class for layers and models. */
export abstract class Module {
  /** False after `eval()`: dropout is switched off. */
  training = true;

  /** Computes the layer's output. */
  abstract forward(x: Tensor): Tensor;

  /**
   * Every parameter with a dotted path name, in a stable order. Found by
   * looking at this object's fields: tensors that require a gradient are
   * parameters, Modules (and arrays of Modules) are searched recursively.
   */
  namedParameters(prefix = ''): [string, Tensor][] {
    const out: [string, Tensor][] = [];
    for (const [key, value] of Object.entries(this)) {
      const name = prefix + key;
      if (value instanceof Tensor && value.requiresGrad) out.push([name, value]);
      else if (value instanceof Module) out.push(...value.namedParameters(`${name}.`));
      else if (Array.isArray(value)) {
        value.forEach((item, i) => {
          if (item instanceof Module) out.push(...item.namedParameters(`${name}.${i}.`));
          else if (item instanceof Tensor && item.requiresGrad) out.push([`${name}.${i}`, item]);
        });
      }
    }
    return out;
  }

  /** Every parameter (pass this to an optimizer). */
  parameters(): Tensor[] {
    return this.namedParameters().map(([, p]) => p);
  }

  /** Total number of trainable numbers. */
  parameterCount(): number {
    return this.parameters().reduce((n, p) => n + p.size, 0);
  }

  /** Child modules, found the same way as parameters. */
  children(): Module[] {
    const out: Module[] = [];
    for (const value of Object.values(this)) {
      if (value instanceof Module) out.push(value);
      else if (Array.isArray(value))
        for (const item of value) if (item instanceof Module) out.push(item);
    }
    return out;
  }

  /** Training mode (dropout active). Applies to children too. */
  train(on = true): this {
    this.training = on;
    for (const child of this.children()) child.train(on);
    return this;
  }

  /** Evaluation mode (dropout off). */
  eval(): this {
    return this.train(false);
  }

  /** Clears `.grad` on every parameter. */
  zeroGrad(): void {
    for (const p of this.parameters()) p.grad = null;
  }

  /** A JSON-safe copy of every parameter. */
  stateDict(): StateDict {
    const out: StateDict = {};
    for (const [name, p] of this.namedParameters())
      out[name] = { shape: [...p.shape], data: Array.from(p.data) };
    return out;
  }

  /**
   * Restores parameters saved by `stateDict()`. Shapes must match. With
   * `strict` (default) every parameter must be present and no extras allowed.
   */
  loadStateDict(state: StateDict, strict = true): void {
    const params = new Map(this.namedParameters());
    if (strict) {
      const missing = [...params.keys()].filter((k) => !(k in state));
      const extra = Object.keys(state).filter((k) => !params.has(k));
      if (missing.length || extra.length) {
        throw new Error(
          `loadStateDict: missing [${missing.join(', ')}], unexpected [${extra.join(', ')}].`,
        );
      }
    }
    for (const [name, saved] of Object.entries(state)) {
      const p = params.get(name);
      if (!p) continue;
      if (!shapesEqual(p.shape, saved.shape) || saved.data.length !== p.size) {
        throw new Error(
          `loadStateDict: ${name} has shape ${formatShape(p.shape)} but the saved one is ${formatShape(saved.shape)}.`,
        );
      }
      p.data.set(saved.data);
    }
  }
}

function param(t: Tensor, name: string): Tensor {
  t.requiresGrad = true;
  t.name = name;
  return t;
}

/**
 * Fully connected layer: y = x @ weight + bias. The weight has shape
 * [inFeatures, outFeatures] so the formula reads left to right.
 * Weights start uniform in ±1/sqrt(inFeatures).
 */
export class Linear extends Module {
  weight: Tensor;
  bias: Tensor | null;

  constructor(
    inFeatures: number,
    outFeatures: number,
    options: LayerOptions & { bias?: boolean } = {},
  ) {
    super();
    const bound = 1 / Math.sqrt(inFeatures);
    const opts = { rng: options.rng ?? defaultRng(), dtype: options.dtype ?? 'float32' };
    this.weight = param(uniform([inFeatures, outFeatures], -bound, bound, opts), 'weight');
    this.bias =
      options.bias === false ? null : param(uniform([outFeatures], -bound, bound, opts), 'bias');
  }

  forward(x: Tensor): Tensor {
    const y = x.matmul(this.weight);
    return this.bias ? y.add(this.bias) : y;
  }
}

/**
 * Lookup table: row i of `weight` is the vector for token i. Forward takes
 * token ids (any shape S) and returns shape [...S, dim].
 */
export class Embedding extends Module {
  weight: Tensor;

  constructor(count: number, dim: number, options: LayerOptions & { std?: number } = {}) {
    super();
    const w = randn([count, dim], {
      rng: options.rng ?? defaultRng(),
      dtype: options.dtype ?? 'float32',
    });
    this.weight = param(options.std === undefined ? w : w.mul(options.std).detach(), 'weight');
  }

  forward(ids: Tensor | Indices): Tensor {
    return this.weight.indexSelect(0, ids);
  }
}

/**
 * Layer normalization over the last axis: rescale each vector to mean 0 and
 * variance 1, then apply a learned scale (gamma) and shift (beta).
 */
export class LayerNorm extends Module {
  gamma: Tensor;
  beta: Tensor;
  eps: number;

  constructor(dim: number, options: { eps?: number; dtype?: DType } = {}) {
    super();
    this.eps = options.eps ?? 1e-5;
    this.gamma = param(ones([dim], { dtype: options.dtype }), 'gamma');
    this.beta = param(zeros([dim], { dtype: options.dtype }), 'beta');
  }

  forward(x: Tensor): Tensor {
    const mean = x.mean(-1, true);
    const centered = x.sub(mean);
    const variance = centered.square().mean(-1, true);
    return centered.div(variance.add(this.eps).sqrt()).mul(this.gamma).add(this.beta);
  }
}

/** max(0, x). */
export class ReLU extends Module {
  forward(x: Tensor): Tensor {
    return x.relu();
  }
}

/** Gaussian Error Linear Unit (tanh approximation). */
export class GELU extends Module {
  forward(x: Tensor): Tensor {
    return x.gelu();
  }
}

/** Hyperbolic tangent. */
export class Tanh extends Module {
  forward(x: Tensor): Tensor {
    return x.tanh();
  }
}

/** Logistic sigmoid. */
export class Sigmoid extends Module {
  forward(x: Tensor): Tensor {
    return x.sigmoid();
  }
}

/**
 * Dropout: in training, zero each value with probability p and scale the
 * rest by 1/(1-p); in eval mode, pass through. Uses a seeded generator.
 */
export class Dropout extends Module {
  p: number;
  private rng: Rng;

  constructor(p = 0.1, options: { rng?: Rng } = {}) {
    super();
    if (!(p >= 0 && p < 1)) throw new RangeError('Dropout: p must be in [0, 1).');
    this.p = p;
    this.rng = options.rng ?? defaultRng();
  }

  forward(x: Tensor): Tensor {
    if (!this.training || this.p === 0) return x;
    const keep = zeros(x.shape, { dtype: x.dtype });
    const scale = 1 / (1 - this.p);
    for (let i = 0; i < keep.size; i++) keep.data[i] = this.rng.uniform() >= this.p ? scale : 0;
    return x.mul(keep);
  }
}

/** Runs layers one after another. */
export class Sequential extends Module {
  layers: Module[];

  constructor(...layers: Module[]) {
    super();
    this.layers = layers;
  }

  forward(x: Tensor): Tensor {
    let out = x;
    for (const layer of this.layers) out = layer.forward(out);
    return out;
  }
}

/** Options for attention and transformer blocks. */
export interface AttentionOptions extends LayerOptions {
  /** Hide future positions (each token sees only itself and earlier ones). Default true. */
  causal?: boolean;
  /** Dropout on the attention weights and outputs (default 0). */
  dropout?: number;
}

/**
 * Multi-head self-attention. Input [batch, time, dModel] (or [time, dModel]).
 * Each head looks at dModel / nHeads features:
 *   weights = softmax(Q Kᵀ / sqrt(headDim))   (with future positions masked)
 *   output  = weights V, heads concatenated, then a final projection.
 * After each forward, `attentionWeights` holds [batch, heads, time, time]
 * (detached) for visualisation.
 */
export class MultiHeadAttention extends Module {
  query: Linear;
  key: Linear;
  value: Linear;
  proj: Linear;
  dropout: Dropout;
  readonly nHeads: number;
  readonly headDim: number;
  readonly causal: boolean;
  attentionWeights: Tensor | null = null;

  constructor(dModel: number, nHeads: number, options: AttentionOptions = {}) {
    super();
    if (dModel % nHeads !== 0)
      throw new RangeError(
        `MultiHeadAttention: dModel ${dModel} is not divisible by nHeads ${nHeads}.`,
      );
    this.nHeads = nHeads;
    this.headDim = dModel / nHeads;
    this.causal = options.causal ?? true;
    this.query = new Linear(dModel, dModel, options);
    this.key = new Linear(dModel, dModel, options);
    this.value = new Linear(dModel, dModel, options);
    this.proj = new Linear(dModel, dModel, options);
    this.dropout = new Dropout(options.dropout ?? 0, options);
  }

  forward(input: Tensor): Tensor {
    const x = input.rank === 2 ? input.unsqueeze(0) : input;
    const [batch, time, dModel] = x.shape as [number, number, number];
    // [B, T, D] -> [B, H, T, headDim]
    const split = (t: Tensor): Tensor =>
      t.reshape([batch, time, this.nHeads, this.headDim]).permute(0, 2, 1, 3);
    const q = split(this.query.forward(x));
    const k = split(this.key.forward(x));
    const v = split(this.value.forward(x));
    let scores = q.matmul(k.transpose()).div(Math.sqrt(this.headDim)); // [B, H, T, T]
    if (this.causal) scores = scores.maskedFill(triuMask(time, { dtype: scores.dtype }), -Infinity);
    const weights = scores.softmax(-1);
    this.attentionWeights = weights.detach();
    const heads = this.dropout.forward(weights).matmul(v); // [B, H, T, headDim]
    const merged = heads.permute(0, 2, 1, 3).reshape([batch, time, dModel]);
    const out = this.dropout.forward(this.proj.forward(merged));
    return input.rank === 2 ? out.squeeze(0) : out;
  }
}

/**
 * A pre-norm transformer block (as in GPT-2):
 *   x = x + attention(layerNorm1(x))
 *   x = x + mlp(layerNorm2(x))      where mlp = Linear -> GELU -> Linear
 */
export class TransformerBlock extends Module {
  ln1: LayerNorm;
  attention: MultiHeadAttention;
  ln2: LayerNorm;
  mlp: Sequential;

  constructor(
    dModel: number,
    nHeads: number,
    options: AttentionOptions & { mlpHidden?: number } = {},
  ) {
    super();
    const hidden = options.mlpHidden ?? 4 * dModel;
    this.ln1 = new LayerNorm(dModel, options);
    this.attention = new MultiHeadAttention(dModel, nHeads, options);
    this.ln2 = new LayerNorm(dModel, options);
    this.mlp = new Sequential(
      new Linear(dModel, hidden, options),
      new GELU(),
      new Linear(hidden, dModel, options),
      new Dropout(options.dropout ?? 0, options),
    );
  }

  forward(x: Tensor): Tensor {
    const h = x.add(this.attention.forward(this.ln1.forward(x)));
    return h.add(this.mlp.forward(this.ln2.forward(h)));
  }
}

/**
 * Sinusoidal positional encoding ("Attention Is All You Need"):
 * [time, dim] with sin on even features and cos on odd ones.
 */
export function sinusoidalPositions(
  time: number,
  dim: number,
  options: { dtype?: DType } = {},
): Tensor {
  const out = zeros([time, dim], options);
  for (let t = 0; t < time; t++) {
    for (let i = 0; i < dim; i++) {
      const freq = 1 / 10000 ** ((2 * Math.floor(i / 2)) / dim);
      out.data[t * dim + i] = i % 2 === 0 ? Math.sin(t * freq) : Math.cos(t * freq);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Losses
// ---------------------------------------------------------------------------

/**
 * Cross-entropy for classification: the average of -log(softmax(logits)[target]).
 * logits: [..., classes]; targets: class ids with the leading shape of logits.
 */
export function crossEntropy(logits: Tensor, targets: Indices): Tensor {
  const classes = logits.shape[logits.rank - 1]!;
  const flat = logits.reshape([-1, classes]);
  const ids = targets instanceof Tensor ? targets.reshape([-1]) : tensor(Array.from(targets));
  if (ids.size !== flat.shape[0]) {
    throw new RangeError(`crossEntropy: ${ids.size} targets for ${flat.shape[0]} rows of logits.`);
  }
  const picked = flat.logSoftmax(-1).gather(1, ids.reshape([-1, 1]));
  return picked.mean().neg();
}

/** Mean squared error: average of (prediction - target)². */
export function mse(prediction: Tensor, target: Tensor | number): Tensor {
  return prediction.sub(target).square().mean();
}

/** Binary cross-entropy on probabilities in (0, 1) (clamped away from 0 and 1). */
export function binaryCrossEntropy(probability: Tensor, target: Tensor): Tensor {
  const p = probability.clamp(1e-7, 1 - 1e-7);
  return target
    .mul(p.log())
    .add(target.neg().add(1).mul(p.neg().add(1).log()))
    .mean()
    .neg();
}

/** Fraction of rows whose largest logit is the target class (no gradient). */
export function accuracy(logits: Tensor, targets: Indices): number {
  return noGrad(() => {
    const classes = logits.shape[logits.rank - 1]!;
    const predicted = logits.reshape([-1, classes]).argmax(-1);
    const ids = targets instanceof Tensor ? targets.data : targets;
    let correct = 0;
    for (let i = 0; i < predicted.size; i++) if (predicted.data[i] === ids[i]) correct++;
    return correct / Math.max(1, predicted.size);
  });
}
