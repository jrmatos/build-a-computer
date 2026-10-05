/**
 * The 'autograd' module: gradient tools on top of the Tensor class.
 *
 * Every Tensor operation already records itself for backpropagation (see
 * tensor.ts). This module adds the switches and a numerical gradient check:
 * nudge each input by ±eps, watch how the output changes, and compare with
 * what `backward()` computed. Run checks in float64 (E-ML-05): in float32 the
 * rounding noise is as large as the nudge.
 */
import { isGradEnabled, noGrad, Tensor } from './tensor';

export { isGradEnabled, noGrad, Tensor };

/** Options for `gradCheck`. */
export interface GradCheckOptions {
  /** Step for the central difference (default 1e-6). */
  eps?: number;
  /** Absolute tolerance (default 1e-5). */
  atol?: number;
  /** Relative tolerance (default 1e-4). */
  rtol?: number;
}

/** What `gradCheck` found. */
export interface GradCheckResult {
  ok: boolean;
  /** Largest |analytic - numeric| over all checked entries. */
  maxAbsError: number;
  /** The first entry that failed, if any. */
  failure?: { input: number; index: number; analytic: number; numeric: number };
}

/** Reduces any output to one number: a scalar stays, otherwise a fixed weighted sum. */
function toScalar(out: Tensor): Tensor {
  if (out.size === 1) return out.sum();
  // Weights 1, 1.5, 2, ... (repeating) make output elements matter differently,
  // so a gradient sent to the wrong element is caught.
  const w = new Float64Array(out.size);
  for (let i = 0; i < w.length; i++) w[i] = 1 + (i % 7) * 0.5;
  return out.mul(new Tensor(out.dtype === 'float64' ? w : Float32Array.from(w), out.shape)).sum();
}

/**
 * Numerical gradient of `f` with respect to `input` by central differences:
 * (f(x + eps) - f(x - eps)) / (2 eps), one element at a time.
 */
export function numericalGradient(f: () => Tensor, input: Tensor, eps = 1e-6): Float64Array {
  const grad = new Float64Array(input.size);
  noGrad(() => {
    for (let i = 0; i < input.size; i++) {
      const original = input.data[i]!;
      input.data[i] = original + eps;
      const plus = toScalar(f()).item();
      input.data[i] = original - eps;
      const minus = toScalar(f()).item();
      input.data[i] = original;
      grad[i] = (plus - minus) / (2 * eps);
    }
  });
  return grad;
}

/**
 * Checks `backward()` against numerical gradients. `f` receives the inputs
 * and returns a tensor (non-scalar outputs are reduced by a fixed weighted
 * sum). Inputs should be float64; they get `requiresGrad` set.
 *
 * @example
 * const x = randn([3, 4], { dtype: 'float64' });
 * gradCheck((x) => x.tanh().sum(), [x]).ok // true
 */
export function gradCheck(
  f: (...inputs: Tensor[]) => Tensor,
  inputs: Tensor[],
  options: GradCheckOptions = {},
): GradCheckResult {
  const eps = options.eps ?? 1e-6;
  const atol = options.atol ?? 1e-5;
  const rtol = options.rtol ?? 1e-4;
  for (const x of inputs) {
    x.requiresGrad = true;
    x.grad = null;
  }
  toScalar(f(...inputs)).backward();
  let maxAbsError = 0;
  let failure: GradCheckResult['failure'];
  inputs.forEach((x, k) => {
    const numeric = numericalGradient(() => f(...inputs), x, eps);
    for (let i = 0; i < x.size; i++) {
      const analytic = x.grad ? x.grad.data[i]! : 0;
      const err = Math.abs(analytic - numeric[i]!);
      maxAbsError = Math.max(maxAbsError, err);
      if (!(err <= atol + rtol * Math.abs(numeric[i]!)) && !failure) {
        failure = { input: k, index: i, analytic, numeric: numeric[i]! };
      }
    }
  });
  return failure ? { ok: false, maxAbsError, failure } : { ok: true, maxAbsError };
}
