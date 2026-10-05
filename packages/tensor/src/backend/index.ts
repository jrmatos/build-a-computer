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
export { DEFAULT_GPU_LIMITS, GpuLimitError, type GpuLimits } from './wgsl';
