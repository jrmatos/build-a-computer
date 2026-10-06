/**
 * The GPU runtime behind GPU-resident tensors: one device, its buffers, and
 * a queue of kernel dispatches.
 *
 * - Work is recorded, not run at once: dispatches pile up and are encoded
 *   into one command buffer at the next flush (a readback, an upload, or
 *   every FLUSH_EVERY dispatches). Parameters for all of them go up in one
 *   writeBuffer. Nothing waits for the GPU except `read()`.
 * - Memory: results of GPU operations live in a step arena. At each
 *   optimizer step (`endStep()`), storages that were not used during the
 *   step that just ended are returned to a pool and reused, because a
 *   training loop allocates the same shapes every step and the JavaScript
 *   garbage collector cannot see GPU memory. Parameters, optimizer state,
 *   uploads and tensors marked with `keep()` are persistent and are freed
 *   when garbage-collected. Using a freed storage throws (never silently
 *   reads reused memory).
 * - Device loss (E-ML-01) marks the runtime lost; every later use throws a
 *   GpuDeviceLostError, and 'auto' picks the CPU from then on.
 */
import { GpuKernelError, GpuLimitError, dispatch1D, type GpuLimits } from './wgsl';
import {
  navigatorGpu,
  requestGpuDevice,
  type GpuBufferLike,
  type GpuDeviceLike,
  type GpuLike,
  type GpuPipelineLike,
} from './webgpu';

/** WebGPU flag values (GPUBufferUsage / GPUMapMode). */
export const BUFFER_USAGE = {
  MAP_READ: 0x1,
  COPY_SRC: 0x4,
  COPY_DST: 0x8,
  STORAGE: 0x80,
} as const;

/** Dispatches recorded before an automatic flush. */
const FLUSH_EVERY = 256;
/** Parameter blocks are aligned to this many bytes (the largest allowed minStorageBufferOffsetAlignment). */
const PARAM_ALIGN = 256;
/** Pooled free buffers above this many bytes are destroyed instead. */
const POOL_LIMIT_BYTES = 512 * 2 ** 20;

/** Thrown when a GPU tensor is used after its device was lost (E-ML-01). */
export class GpuDeviceLostError extends Error {
  constructor(reason: string) {
    super(
      `The GPU stopped responding (${reason}). GPU tensors are gone; training continues on the CPU: resume from your last checkpoint.`,
    );
    this.name = 'GpuDeviceLostError';
  }
}

/** Thrown when a GPU tensor's memory was already returned to the pool. */
export class FreedTensorError extends Error {
  constructor() {
    super(
      'This GPU tensor was freed: results of GPU operations are kept until the end of the next optimizer step after their last use. ' +
        'Call t.keep() on a GPU tensor you want to keep for longer.',
    );
    this.name = 'FreedTensorError';
  }
}

/** One GPU buffer and whether it went back to the pool. */
interface Slot {
  buffer: GpuBufferLike;
  bytes: number;
  released: boolean;
}

/** The GPU memory behind a tensor (shared by reshape views). Float32 or u32 words. */
export class GpuStorage {
  /** Arena window of the last use (allocation, kernel input or readback). */
  lastUse: number;
  persistent: boolean;

  constructor(
    readonly runtime: GpuRuntime,
    readonly slot: Slot,
    /** Number of 4-byte words. */
    readonly count: number,
    persistent: boolean,
  ) {
    this.lastUse = runtime.window;
    this.persistent = persistent;
  }

  /** The buffer, checking it is still alive; marks it used in this step. */
  use(): GpuBufferLike {
    this.runtime.checkAlive();
    if (this.slot.released) throw new FreedTensorError();
    this.lastUse = this.runtime.window;
    return this.slot.buffer;
  }

  get freed(): boolean {
    return this.slot.released;
  }

  /** Keeps this storage until it is garbage-collected. */
  keep(): void {
    this.persistent = true;
  }
}

type Pending =
  | {
      kind: 'dispatch';
      pipeline: GpuPipelineLike;
      layout: unknown;
      buffers: GpuBufferLike[];
      paramOffset: number;
      paramWords: number;
      grid: [number, number, number];
    }
  | { kind: 'copy'; src: GpuBufferLike; dst: GpuBufferLike; bytes: number };

/** Counters for benchmarks and the dev page. */
export interface GpuStats {
  dispatches: number;
  flushes: number;
  reads: number;
  uploads: number;
  buffersCreated: number;
  pooledBytes: number;
  liveArenaStorages: number;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** The bit pattern of a float, for parameter words. */
export function floatBits(v: number): number {
  f32[0] = v;
  return u32[0]!;
}

/** Buffer size class: multiples of 256 bytes, then steps of 1/8 of a power of two. */
function sizeClass(bytes: number): number {
  const b = Math.max(16, Math.ceil(bytes / 4) * 4);
  if (b <= 4096) return Math.ceil(b / 256) * 256;
  const step = 2 ** (Math.floor(Math.log2(b)) - 3);
  return Math.ceil(b / step) * step;
}

/** A device plus everything needed to run tensor kernels on it. */
export class GpuRuntime {
  readonly device: GpuDeviceLike;
  readonly limits: GpuLimits;
  /** Set when the device is lost. */
  lostReason: string | null = null;
  /** First error the device reported for a kernel (shader or validation), if any. */
  kernelError: string | null = null;
  /** Current arena window (incremented by endStep). */
  window = 0;
  /** Called the first time a kernel runs (the app's CPU/GPU badge listens). */
  onFirstUse: (() => void) | null = null;
  readonly stats: GpuStats = {
    dispatches: 0,
    flushes: 0,
    reads: 0,
    uploads: 0,
    buffersCreated: 0,
    pooledBytes: 0,
    liveArenaStorages: 0,
  };

  private readonly pipelines = new Map<string, { pipeline: GpuPipelineLike; layout: unknown }>();
  private pending: Pending[] = [];
  private params = new Uint32Array(4096);
  private paramWords = 0;
  private paramBuffer: GpuBufferLike | null = null;
  private readonly pool = new Map<number, GpuBufferLike[]>();
  private readonly arena = new Set<WeakRef<GpuStorage>>();
  private readonly destroyLater: GpuBufferLike[] = [];
  private readonly finalizer = new FinalizationRegistry<Slot>((slot) => this.release(slot));

  constructor(device: GpuDeviceLike, limits: GpuLimits, onLost?: (reason: string) => void) {
    this.device = device;
    this.limits = limits;
    void device.lost.then((info) => {
      this.lostReason = info.message || info.reason || 'unknown reason';
      this.pending = [];
      onLost?.(this.lostReason);
    });
  }

  /** True while the device works. */
  get alive(): boolean {
    return this.lostReason === null;
  }

  checkAlive(): void {
    if (this.lostReason !== null) throw new GpuDeviceLostError(this.lostReason);
  }

  // -- Memory ----------------------------------------------------------------

  /** A storage of `count` words (contents undefined until a kernel writes them). */
  alloc(count: number, persistent = false): GpuStorage {
    this.checkAlive();
    const bytes = sizeClass(count * 4);
    const max = Math.min(this.limits.maxBufferSize, this.limits.maxStorageBufferBindingSize);
    if (count * 4 > max) {
      throw new GpuLimitError(
        `A GPU tensor of ${count} numbers needs ${count * 4} bytes but this GPU binds at most ${max} bytes per buffer.`,
      );
    }
    let buffer = this.pool.get(bytes)?.pop();
    if (buffer) this.stats.pooledBytes -= bytes;
    else {
      buffer = this.device.createBuffer({
        size: bytes,
        usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.COPY_DST,
      });
      this.stats.buffersCreated++;
    }
    const slot: Slot = { buffer, bytes, released: false };
    const storage = new GpuStorage(this, slot, count, persistent);
    this.finalizer.register(storage, slot, slot);
    if (!persistent) this.arena.add(new WeakRef(storage));
    return storage;
  }

  /** Copies data to a new persistent storage (it is freed when garbage-collected). */
  upload(data: Float32Array | Uint32Array | Float64Array, persistent = true): GpuStorage {
    const words = data instanceof Float64Array ? Float32Array.from(data) : data;
    const storage = this.alloc(Math.max(1, words.length), persistent);
    this.write(storage, words);
    this.stats.uploads++;
    return storage;
  }

  /** Overwrites a storage's contents (ordered after all recorded work). */
  write(storage: GpuStorage, data: Float32Array | Uint32Array): void {
    const buffer = storage.use();
    this.flush(); // queue.writeBuffer runs before unsubmitted work, so submit that first
    if (data.length > 0) this.device.queue.writeBuffer(buffer, 0, data);
  }

  /** Returns a slot's buffer to the pool (or destroys it when the pool is full). */
  private release(slot: Slot): void {
    if (slot.released) return;
    slot.released = true;
    this.finalizer.unregister(slot);
    if (this.lostReason !== null) return;
    if (this.stats.pooledBytes + slot.bytes > POOL_LIMIT_BYTES) {
      // Recorded work may still use it: destroy after the next submit.
      this.destroyLater.push(slot.buffer);
      if (this.pending.length === 0) this.flush();
      return;
    }
    let list = this.pool.get(slot.bytes);
    if (!list) this.pool.set(slot.bytes, (list = []));
    list.push(slot.buffer);
    this.stats.pooledBytes += slot.bytes;
  }

  /**
   * Ends an arena window (called by Optimizer.step): storages not used during
   * the window that just ended go back to the pool.
   */
  endStep(): void {
    const closing = this.window;
    for (const ref of this.arena) {
      const s = ref.deref();
      if (!s || s.slot.released) {
        this.arena.delete(ref);
        continue;
      }
      if (s.persistent) {
        this.arena.delete(ref);
        continue;
      }
      if (s.lastUse < closing) {
        this.release(s.slot);
        this.arena.delete(ref);
      }
    }
    this.stats.liveArenaStorages = this.arena.size;
    this.window++;
  }

  /** Frees a storage now (internal temporaries). */
  free(storage: GpuStorage): void {
    this.release(storage.slot);
  }

  // -- Kernels ---------------------------------------------------------------

  private pipeline(code: string): { pipeline: GpuPipelineLike; layout: unknown } {
    let p = this.pipelines.get(code);
    if (!p) {
      const module = this.device.createShaderModule({ code });
      const pipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
      p = { pipeline, layout: pipeline.getBindGroupLayout(0) };
      this.pipelines.set(code, p);
    }
    return p;
  }

  /**
   * Records one kernel dispatch. Bindings: `inputs` (read), then `outputs`
   * (read_write), then the parameter words. `grid` defaults to a 1-D grid
   * for `threads` threads.
   */
  run(
    code: string,
    inputs: GpuStorage[],
    outputs: GpuStorage[],
    params: ArrayLike<number>,
    threads: number | [number, number, number],
  ): void {
    this.checkAlive();
    if (this.stats.dispatches === 0) this.onFirstUse?.();
    const grid = typeof threads === 'number' ? dispatch1D(threads, this.limits) : threads;
    for (const g of grid) {
      if (g > this.limits.maxComputeWorkgroupsPerDimension)
        throw new GpuLimitError(`A kernel grid of ${grid.join('×')} is too big for this GPU.`);
    }
    const buffers = [...inputs, ...outputs].map((s) => s.use());
    const { pipeline, layout } = this.pipeline(code);
    const words = Math.max(4, params.length);
    const needed = this.paramWords + Math.ceil(words / (PARAM_ALIGN / 4)) * (PARAM_ALIGN / 4);
    if (needed > this.params.length) {
      const grown = new Uint32Array(Math.max(needed, this.params.length * 2));
      grown.set(this.params.subarray(0, this.paramWords));
      this.params = grown;
    }
    const paramOffset = this.paramWords;
    this.params.fill(0, paramOffset, paramOffset + words);
    for (let k = 0; k < params.length; k++) this.params[paramOffset + k] = params[k]! >>> 0;
    this.paramWords = needed;
    this.pending.push({ kind: 'dispatch', pipeline, layout, buffers, paramOffset, paramWords: words, grid });
    this.stats.dispatches++;
    if (this.pending.length >= FLUSH_EVERY) this.flush();
  }

  /** Encodes and submits everything recorded so far. */
  flush(): void {
    if (this.lostReason !== null) {
      this.pending = [];
      return;
    }
    if (this.pending.length === 0) {
      this.destroyNow();
      return;
    }
    const device = this.device;
    const paramBytes = this.paramWords * 4;
    if (paramBytes > 0 && (!this.paramBuffer || this.paramBuffer.size < paramBytes)) {
      if (this.paramBuffer) this.destroyLater.push(this.paramBuffer);
      this.paramBuffer = device.createBuffer({
        size: Math.max(4096, 2 ** Math.ceil(Math.log2(paramBytes))),
        usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
      });
    }
    device.pushErrorScope?.('validation');
    if (paramBytes > 0) device.queue.writeBuffer(this.paramBuffer!, 0, this.params.subarray(0, this.paramWords));
    const encoder = device.createCommandEncoder();
    let pass: ReturnType<typeof encoder.beginComputePass> | null = null;
    for (const item of this.pending) {
      if (item.kind === 'copy') {
        pass?.end();
        pass = null;
        encoder.copyBufferToBuffer(item.src, 0, item.dst, 0, item.bytes);
        continue;
      }
      pass ??= encoder.beginComputePass();
      const layout = item.layout;
      const entries: { binding: number; resource: { buffer: GpuBufferLike; offset?: number; size?: number } }[] =
        item.buffers.map((buffer, binding) => ({ binding, resource: { buffer } }));
      entries.push({
        binding: item.buffers.length,
        resource: { buffer: this.paramBuffer!, offset: item.paramOffset * 4, size: item.paramWords * 4 },
      });
      pass.setPipeline(item.pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout, entries }));
      pass.dispatchWorkgroups(...item.grid);
    }
    pass?.end();
    device.queue.submit([encoder.finish()]);
    const scope = device.popErrorScope?.();
    if (scope) {
      void scope.then((error) => {
        if (error && this.kernelError === null) this.kernelError = error.message;
      });
    }
    this.pending = [];
    this.paramWords = 0;
    this.stats.flushes++;
    this.destroyNow();
  }

  private destroyNow(): void {
    while (this.destroyLater.length) this.destroyLater.pop()!.destroy();
  }

  /** Reads a storage back (the only place the CPU waits for the GPU). */
  async read(storage: GpuStorage, count = storage.count): Promise<Float32Array> {
    const src = storage.use();
    const bytes = Math.max(4, count * 4);
    const staging = this.device.createBuffer({
      size: Math.ceil(bytes / 4) * 4,
      usage: BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST,
    });
    this.pending.push({ kind: 'copy', src, dst: staging, bytes });
    this.flush();
    this.stats.reads++;
    try {
      await staging.mapAsync(1);
      this.checkAlive();
      if (this.kernelError !== null) {
        const message = this.kernelError;
        this.kernelError = null; // reported once; later work may be fine
        throw new GpuKernelError(`The GPU rejected a kernel: ${message}`);
      }
      return new Float32Array(staging.getMappedRange().slice(0, count * 4));
    } catch (err) {
      if (this.lostReason !== null && !(err instanceof GpuDeviceLostError))
        throw new GpuDeviceLostError(this.lostReason);
      throw err;
    } finally {
      try {
        staging.unmap();
      } catch {
        /* never mapped */
      }
      staging.destroy();
    }
  }

  /** Frees the device. */
  dispose(): void {
    this.pending = [];
    this.pipelines.clear();
    this.device.destroy();
    if (current === this) current = null;
  }
}

// ---------------------------------------------------------------------------
// The shared runtime ('auto' device)
// ---------------------------------------------------------------------------

let current: GpuRuntime | null = null;
let initMessage = 'WebGPU was not requested; tensors live on the CPU.';

/** The runtime GPU tensors use, or null when there is none (or it was lost). */
export function gpuRuntime(): GpuRuntime | null {
  return current && current.alive ? current : null;
}

/** Installs (or clears) the shared runtime. Tests pass an emulated device. */
export function setGpuRuntime(runtime: GpuRuntime | null, message = 'Using WebGPU.'): void {
  current = runtime;
  initMessage = runtime ? message : 'No GPU: tensors live on the CPU.';
}

/** What `to('auto')` means right now. */
export function autoDevice(): 'webgpu' | 'cpu' {
  return gpuRuntime() ? 'webgpu' : 'cpu';
}

/** Why the current device was chosen (for the badge and logs). */
export function deviceMessage(): string {
  if (current && !current.alive)
    return `The GPU stopped responding (${current.lostReason}); using the CPU.`;
  return initMessage;
}

/** Options for `initGpu`. */
export interface InitGpuOptions {
  /** The WebGPU entry point; defaults to navigator.gpu. */
  gpu?: GpuLike | null;
  /** Skip the GPU (e.g. the player asked for the CPU). */
  prefer?: 'webgpu' | 'cpu';
  /** Use a software adapter (SwiftShader) too; by default only hardware GPUs count. */
  allowFallbackAdapter?: boolean;
  /** Which GPU to ask for on machines with two (default 'high-performance'). */
  powerPreference?: 'high-performance' | 'low-power';
  /** Called when the device is lost (E-ML-01). */
  onLost?: (message: string) => void;
}

/**
 * Connects the shared runtime to a GPU when one is available (E-ML-01: when
 * not, everything stays on the CPU, with an explanation). Safe to call twice.
 */
export async function initGpu(
  options: InitGpuOptions = {},
): Promise<{ device: 'webgpu' | 'cpu'; message: string }> {
  if (gpuRuntime()) return { device: 'webgpu', message: initMessage };
  if (options.prefer === 'cpu') {
    setGpuRuntime(null);
    initMessage = 'Using the CPU (requested).';
    return { device: 'cpu', message: initMessage };
  }
  const gpu = options.gpu === undefined ? navigatorGpu() : options.gpu;
  const got = await requestGpuDevice(gpu, {
    allowFallbackAdapter: options.allowFallbackAdapter ?? false,
    powerPreference: options.powerPreference,
  });
  if (!got.device) {
    setGpuRuntime(null);
    initMessage = `${got.reason} Training runs on the CPU.`;
    return { device: 'cpu', message: initMessage };
  }
  const runtime = new GpuRuntime(got.device, got.limits, (reason) => {
    options.onLost?.(
      `The GPU stopped responding (${reason}). Switched to the CPU; resume from your last checkpoint.`,
    );
  });
  setGpuRuntime(runtime, 'Using WebGPU.');
  return { device: 'webgpu', message: initMessage };
}
