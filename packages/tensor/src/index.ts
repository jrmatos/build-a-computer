/**
 * @build-a-computer/tensor: tensors, autograd, neural-network layers and
 * optimizers for Track 2 (plan M12: ML-01..ML-04), with CPU and WebGPU backends.
 *
 * Module map. Player code in the sandbox imports these by name (JsSetup.modules):
 *
 *   import { tensor, zeros, randn } from 'tensor';   // Tensor class, creation, ops
 *   import { noGrad, gradCheck } from 'autograd';    // gradient switches and checks
 *   import { Linear, crossEntropy } from 'nn';       // layers and losses
 *   import { Adam, assertFinite } from 'optim';      // optimizers, schedules, NaN guard
 *
 * `JS_MODULE_MAP` below is what the sandbox exposes for each name.
 */
import * as autograd from './autograd';
import * as backend from './backend/index';
import * as nn from './nn';
import * as optim from './optim';
import * as tensor from './tensor';

export { autograd, backend, nn, optim, tensor };

/** The library modules the sandbox can unlock, keyed by their import name. */
export const JS_MODULE_MAP = { tensor, autograd, nn, optim } as const;
export type TensorModuleName = keyof typeof JS_MODULE_MAP;

// Direct exports for TypeScript callers (apps/web, the worker).
export { Tensor, type DType, type NestedArray, type TensorOptions } from './tensor';
export { Rng, manualSeed } from './random';
export { Module, type StateDict } from './nn';
export { Optimizer, NonFiniteError, type Checkpoint } from './optim';
export {
  createBackend,
  CpuBackend,
  fitConfig,
  type ComputeBackend,
  type ModelConfig,
} from './backend/index';

/** Bumped when the public API changes incompatibly. */
export const TENSOR_VERSION = 1;
