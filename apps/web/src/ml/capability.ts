/**
 * Which backend training can use (E-ML-01): a WebGPU adapter, or the CPU.
 * Checked once per page; the answer is cached.
 */

export type Backend = 'webgpu' | 'cpu';

interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

let cached: Promise<Backend> | null = null;

/** Resolve 'webgpu' when the browser exposes navigator.gpu and grants an adapter, else 'cpu'. */
export function detectBackend(nav: { gpu?: GpuLike } | undefined = typeof navigator === 'undefined' ? undefined : (navigator as unknown as { gpu?: GpuLike })): Promise<Backend> {
  const gpu = nav?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return Promise.resolve('cpu');
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2000));
  return Promise.race([gpu.requestAdapter().catch(() => null), timeout]).then((a) => (a ? 'webgpu' : 'cpu'));
}

/** detectBackend() for this page, computed once. */
export function backend(): Promise<Backend> {
  cached ??= detectBackend();
  return cached;
}
