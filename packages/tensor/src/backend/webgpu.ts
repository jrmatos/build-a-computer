/**
 * WebGPU backend: runs the WGSL kernels from wgsl.ts on the GPU.
 *
 * This is the only file in the package allowed to touch `navigator`
 * (eslint.config.js has a file-level exception). It declares the small part
 * of the WebGPU API it uses, so the package needs no extra type dependency,
 * and so tests can pass in a fake GPU.
 *
 * Only float32 runs here; float64 tensors (gradient checks, E-ML-05) are
 * refused and run on the CPU instead (see select.ts).
 */
import { formatShape, normalizeAxis, sizeOf } from '../shape';
import { Tensor } from '../tensor';
import type { ComputeBackend } from './backend';
import {
  binaryMeta,
  binaryShader,
  bufferBytes,
  checkBufferSize,
  chooseMatmulTile,
  DEFAULT_GPU_LIMITS,
  dispatch1D,
  dispatchMatmul,
  GpuLimitError,
  layerNormShader,
  matmulPlan,
  matmulShader,
  reduceShader,
  softmaxShader,
  unaryShader,
  type GpuBinaryOp,
  type GpuLimits,
  type GpuReduceOp,
  type GpuUnaryOp,
} from './wgsl';

// -- The slice of the WebGPU API this file uses ------------------------------

export interface GpuBufferLike {
  readonly size: number;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}
export interface GpuPassLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, group: unknown): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}
export interface GpuEncoderLike {
  beginComputePass(): GpuPassLike;
  copyBufferToBuffer(
    src: GpuBufferLike,
    srcOffset: number,
    dst: GpuBufferLike,
    dstOffset: number,
    size: number,
  ): void;
  finish(): unknown;
}
export interface GpuPipelineLike {
  getBindGroupLayout(index: number): unknown;
}
export interface GpuDeviceLike {
  readonly limits: Partial<GpuLimits>;
  readonly lost: Promise<{ reason?: string; message?: string }>;
  readonly queue: {
    writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView): void;
    submit(commands: unknown[]): void;
  };
  createBuffer(desc: { size: number; usage: number }): GpuBufferLike;
  createShaderModule(desc: { code: string }): unknown;
  createComputePipeline(desc: {
    layout: 'auto';
    compute: { module: unknown; entryPoint: string };
  }): GpuPipelineLike;
  createBindGroup(desc: {
    layout: unknown;
    entries: { binding: number; resource: { buffer: GpuBufferLike } }[];
  }): unknown;
  createCommandEncoder(): GpuEncoderLike;
  destroy(): void;
}
export interface GpuAdapterLike {
  readonly limits: Partial<GpuLimits>;
  requestDevice(desc?: { requiredLimits?: Record<string, number> }): Promise<GpuDeviceLike>;
}
export interface GpuLike {
  requestAdapter(options?: {
    powerPreference?: 'high-performance' | 'low-power';
  }): Promise<GpuAdapterLike | null>;
}

// WebGPU flag values (GPUBufferUsage / GPUMapMode), written out so this file
// does not depend on browser globals.
const USAGE = {
  MAP_READ: 0x1,
  COPY_SRC: 0x4,
  COPY_DST: 0x8,
  UNIFORM: 0x40,
  STORAGE: 0x80,
} as const;
const MAP_READ = 0x1;

/** `navigator.gpu` when this browser (or worker) has WebGPU, else null. */
export function navigatorGpu(): GpuLike | null {
  if (typeof navigator === 'undefined') return null;
  const gpu = (navigator as { gpu?: GpuLike }).gpu;
  return gpu ?? null;
}

/** Reads the limits we care about from an adapter, filling gaps with the spec minimums. */
export function readLimits(source: Partial<GpuLimits>): GpuLimits {
  const out = { ...DEFAULT_GPU_LIMITS };
  for (const key of Object.keys(out) as (keyof GpuLimits)[]) {
    const v = source[key];
    if (typeof v === 'number' && v > 0) out[key] = v;
  }
  return out;
}

/**
 * Asks for an adapter and a device. Returns null (with a reason) when WebGPU
 * is missing or refuses, so the caller can fall back to the CPU (E-ML-01).
 * The device is requested with the adapter's own buffer limits, read first
 * (E-ML-04), instead of the small defaults.
 */
export async function requestGpuDevice(
  gpu: GpuLike | null,
): Promise<{ device: GpuDeviceLike; limits: GpuLimits } | { device: null; reason: string }> {
  if (!gpu) return { device: null, reason: 'This browser has no WebGPU support.' };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter)
      return { device: null, reason: 'WebGPU is present but no GPU adapter is available.' };
    const limits = readLimits(adapter.limits);
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: limits.maxBufferSize,
        maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      },
    });
    return { device, limits: readLimits(device.limits) };
  } catch (err) {
    return { device: null, reason: `WebGPU device request failed: ${(err as Error).message}` };
  }
}

/** Runs kernels on one GPU device. Use `createBackend()` (select.ts) rather than this directly. */
export class WebGpuBackend implements ComputeBackend {
  readonly name = 'webgpu' as const;
  readonly limits: GpuLimits;
  /** Set when the device is lost; every later call throws. */
  lostReason: string | null = null;
  private readonly device: GpuDeviceLike;
  private readonly pipelines = new Map<string, GpuPipelineLike>();
  private readonly tile: number;

  constructor(device: GpuDeviceLike, limits: GpuLimits, onLost?: (reason: string) => void) {
    this.device = device;
    this.limits = limits;
    this.tile = chooseMatmulTile(limits);
    void device.lost.then((info) => {
      this.lostReason = info.message || info.reason || 'unknown reason';
      onLost?.(this.lostReason);
    });
  }

  async matmul(a: Tensor, b: Tensor): Promise<Tensor> {
    this.check(a, b);
    const plan = matmulPlan(a.shape, b.shape);
    if (!plan)
      throw new GpuLimitError(
        `matmul ${formatShape(a.shape)} @ ${formatShape(b.shape)} needs a general batch broadcast.`,
      );
    const grid = dispatchMatmul(plan.m, plan.n, plan.batch, this.tile, this.limits);
    const params = new Uint32Array([plan.m, plan.k, plan.n, plan.aStride, plan.bStride, 0, 0, 0]);
    return this.run(
      matmulShader(this.tile),
      [a.data, b.data],
      params,
      'uniform',
      plan.outShape,
      grid,
    );
  }

  async binary(op: GpuBinaryOp, a: Tensor, b: Tensor): Promise<Tensor> {
    this.check(a, b);
    const { outShape, meta } = binaryMeta(a.shape, b.shape);
    return this.run(
      binaryShader(op),
      [a.data, b.data],
      meta,
      'storage',
      outShape,
      dispatch1D(sizeOf(outShape), this.limits),
    );
  }

  async unary(op: GpuUnaryOp, x: Tensor): Promise<Tensor> {
    this.check(x);
    const params = new Uint32Array([x.size, 0, 0, 0]);
    return this.run(
      unaryShader(op),
      [x.data],
      params,
      'uniform',
      x.shape,
      dispatch1D(x.size, this.limits),
    );
  }

  async reduce(op: GpuReduceOp, x: Tensor, axis: number): Promise<Tensor> {
    this.check(x);
    const ax = normalizeAxis(axis, x.rank);
    const outer = sizeOf(x.shape.slice(0, ax));
    const len = x.shape[ax]!;
    const inner = sizeOf(x.shape.slice(ax + 1));
    if (len === 0) throw new GpuLimitError('reduce over an empty axis');
    const outShape = x.shape.filter((_d, i) => i !== ax);
    const params = new Uint32Array([outer, len, inner, 0]);
    return this.run(
      reduceShader(op),
      [x.data],
      params,
      'uniform',
      outShape,
      dispatch1D(outer * inner, this.limits),
    );
  }

  async softmax(x: Tensor): Promise<Tensor> {
    this.check(x);
    const cols = x.shape[x.rank - 1] ?? 1;
    const rows = x.size / Math.max(1, cols);
    const params = new Uint32Array([rows, cols, 0, 0]);
    return this.run(
      softmaxShader(),
      [x.data],
      params,
      'uniform',
      x.shape,
      dispatch1D(rows, this.limits),
    );
  }

  async layerNorm(x: Tensor, eps = 1e-5): Promise<Tensor> {
    this.check(x);
    const cols = x.shape[x.rank - 1] ?? 1;
    const rows = x.size / Math.max(1, cols);
    const params = new ArrayBuffer(16);
    new Uint32Array(params, 0, 2).set([rows, cols]);
    new Float32Array(params, 8, 1)[0] = eps;
    return this.run(
      layerNormShader(),
      [x.data],
      new Uint32Array(params),
      'uniform',
      x.shape,
      dispatch1D(rows, this.limits),
    );
  }

  dispose(): void {
    this.pipelines.clear();
    this.device.destroy();
  }

  /** Refuses work the GPU cannot do so the caller can use the CPU instead. */
  private check(...inputs: Tensor[]): void {
    if (this.lostReason) throw new GpuLimitError(`GPU device lost: ${this.lostReason}`);
    for (const t of inputs) {
      if (t.dtype !== 'float32')
        throw new GpuLimitError('The GPU backend runs float32 only (float64 stays on the CPU).');
      if (t.size === 0) throw new GpuLimitError('Empty tensors are handled on the CPU.');
      checkBufferSize(bufferBytes(t.size), this.limits, `A ${formatShape(t.shape)} tensor`);
    }
  }

  private pipeline(code: string): GpuPipelineLike {
    let p = this.pipelines.get(code);
    if (!p) {
      const module = this.device.createShaderModule({ code });
      p = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
      this.pipelines.set(code, p);
    }
    return p;
  }

  /**
   * Uploads inputs, runs one kernel and reads the output back.
   * Bindings: inputs at 0..n-1, output at n, parameters at n+1.
   */
  private async run(
    code: string,
    inputs: (Float32Array | Float64Array)[],
    params: Uint32Array,
    paramKind: 'uniform' | 'storage',
    outShape: readonly number[],
    grid: [number, number, number],
  ): Promise<Tensor> {
    const outCount = sizeOf(outShape);
    const outBytes = bufferBytes(outCount);
    checkBufferSize(outBytes, this.limits, `The ${formatShape(outShape)} result`);
    const device = this.device;
    const created: GpuBufferLike[] = [];
    const make = (size: number, usage: number): GpuBufferLike => {
      const buffer = device.createBuffer({ size, usage });
      created.push(buffer);
      return buffer;
    };
    try {
      const inputBuffers = inputs.map((data) => {
        const buffer = make(bufferBytes(data.length), USAGE.STORAGE | USAGE.COPY_DST);
        device.queue.writeBuffer(
          buffer,
          0,
          data instanceof Float32Array ? data : Float32Array.from(data),
        );
        return buffer;
      });
      const output = make(outBytes, USAGE.STORAGE | USAGE.COPY_SRC);
      const paramBytes = Math.max(16, Math.ceil(params.byteLength / 16) * 16);
      const paramBuffer = make(
        paramBytes,
        (paramKind === 'uniform' ? USAGE.UNIFORM : USAGE.STORAGE) | USAGE.COPY_DST,
      );
      const padded = new Uint32Array(paramBytes / 4);
      padded.set(params);
      device.queue.writeBuffer(paramBuffer, 0, padded);
      const staging = make(outBytes, USAGE.MAP_READ | USAGE.COPY_DST);

      const pipeline = this.pipeline(code);
      const buffers = [...inputBuffers, output, paramBuffer];
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(...grid);
      pass.end();
      encoder.copyBufferToBuffer(output, 0, staging, 0, outBytes);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(MAP_READ);
      const result = new Float32Array(staging.getMappedRange().slice(0, outCount * 4));
      staging.unmap();
      return new Tensor(result, outShape);
    } finally {
      for (const b of created) b.destroy();
    }
  }
}
