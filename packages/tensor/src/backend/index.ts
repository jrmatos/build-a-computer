/** Compute backends: the CPU reference, WebGPU, and automatic selection with fallback. */
export * from './backend';
export * from './select';
export {
  navigatorGpu,
  readLimits,
  requestGpuDevice,
  WebGpuBackend,
  type GpuAdapterLike,
  type GpuDeviceLike,
  type GpuLike,
} from './webgpu';
export * as wgsl from './wgsl';
export { DEFAULT_GPU_LIMITS, GpuKernelError, GpuLimitError, type GpuLimits } from './wgsl';
export {
  autoDevice,
  deviceMessage,
  FreedTensorError,
  GpuDeviceLostError,
  gpuRuntime,
  GpuRuntime,
  GpuStorage,
  initGpu,
  setGpuRuntime,
  type GpuStats,
  type InitGpuOptions,
} from './gpu-runtime';
export {
  benchmarkTraining,
  TINY_GPT,
  TINY_GPT_BATCH,
  trainingSelfTest,
  type GpuCheckRow,
  type TrainingBenchmark,
} from './gpu-selftest';
export * as gpuKernels from './gpu-kernels';
