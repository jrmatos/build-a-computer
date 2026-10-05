/**
 * Picking a backend: try WebGPU, fall back to the CPU, and keep working if
 * the GPU disappears mid-run (E-ML-01).
 *
 *   const { backend, message } = await createBackend();
 *   const y = await backend.matmul(a, b);   // GPU if possible, else CPU
 *
 * Checking the GPU kernels in a real browser: open the app (pnpm dev) in a
 * WebGPU browser, and in the dev-tools console of a page that bundles this
 * package run
 *   const { backend } = await createBackend();
 *   console.table(await selfTest(backend));
 * Every row should say ok: true; maxError is the largest difference from the
 * CPU result (E-ML-02: compared with a tolerance, never exactly).
 */
import { Rng } from '../random';
import { allClose, randn, type Tensor } from '../tensor';
import { CpuBackend, type ComputeBackend } from './backend';
import type { GpuBinaryOp, GpuReduceOp, GpuUnaryOp } from './wgsl';
import { GpuLimitError, type GpuLimits } from './wgsl';
import { navigatorGpu, requestGpuDevice, WebGpuBackend, type GpuLike } from './webgpu';

/** Options for `createBackend`. */
export interface BackendOptions {
  /** 'cpu' skips the GPU entirely. Default 'webgpu'. */
  prefer?: 'webgpu' | 'cpu';
  /** The WebGPU entry point; defaults to navigator.gpu. Tests pass a fake. */
  gpu?: GpuLike | null;
  /** Called with an explanation whenever the backend switches to the CPU. */
  onFallback?: (message: string) => void;
}

/** What `createBackend` chose. */
export interface BackendChoice {
  backend: ResilientBackend;
  /** Why this backend was chosen (e.g. why WebGPU was not used). */
  message: string;
}

/** Picks WebGPU when it works, otherwise the CPU, and explains the choice. */
export async function createBackend(options: BackendOptions = {}): Promise<BackendChoice> {
  const backend = new ResilientBackend(options);
  const message = await backend.init();
  return { backend, message };
}

/**
 * A backend that prefers the GPU but never fails because of it:
 * - float64 inputs and jobs too big for the device run on the CPU;
 * - if the GPU device is lost, it tries once to get a new one, and otherwise
 *   switches to the CPU for good, telling `onFallback`.
 */
export class ResilientBackend implements ComputeBackend {
  private gpu: WebGpuBackend | null = null;
  private readonly cpu = new CpuBackend();
  private readonly options: BackendOptions;
  private recovering: Promise<void> | null = null;
  /** Number of times the GPU device was lost. */
  deviceLosses = 0;

  constructor(options: BackendOptions = {}) {
    this.options = options;
  }

  /** 'webgpu' while a GPU device is in use, else 'cpu'. */
  get name(): 'webgpu' | 'cpu' {
    return this.gpu && !this.gpu.lostReason ? 'webgpu' : 'cpu';
  }

  /** The GPU's limits, or null on the CPU. */
  get limits(): GpuLimits | null {
    return this.gpu?.limits ?? null;
  }

  /** Connects to the GPU if allowed; returns a message describing the result. */
  async init(): Promise<string> {
    if (this.options.prefer === 'cpu') return 'Using the CPU (requested).';
    const gpu = this.options.gpu === undefined ? navigatorGpu() : this.options.gpu;
    const got = await requestGpuDevice(gpu);
    if (!got.device) {
      const message = `${got.reason} Training runs on the CPU with a smaller model.`;
      this.options.onFallback?.(message);
      return message;
    }
    this.gpu = new WebGpuBackend(got.device, got.limits, (reason) => this.handleLoss(reason));
    return 'Using WebGPU.';
  }

  private handleLoss(reason: string): void {
    this.deviceLosses++;
    this.recovering = (async () => {
      const gpu = this.options.gpu === undefined ? navigatorGpu() : this.options.gpu;
      const got = this.deviceLosses <= 1 ? await requestGpuDevice(gpu) : null;
      if (got?.device) {
        this.gpu = new WebGpuBackend(got.device, got.limits, (r) => this.handleLoss(r));
      } else {
        this.gpu = null;
        this.options.onFallback?.(
          `The GPU stopped responding (${reason}). Switched to the CPU; resume from your last checkpoint with a smaller model.`,
        );
      }
      this.recovering = null;
    })();
  }

  /** Runs `job` on the GPU when possible, else (or on a GPU limit/loss error) on the CPU. */
  private async route(job: (b: ComputeBackend) => Promise<Tensor>): Promise<Tensor> {
    if (this.recovering) await this.recovering;
    const gpu = this.gpu;
    if (gpu && !gpu.lostReason) {
      try {
        return await job(gpu);
      } catch (err) {
        if (!(err instanceof GpuLimitError)) throw err;
      }
    }
    return job(this.cpu);
  }

  matmul(a: Tensor, b: Tensor): Promise<Tensor> {
    return this.route((be) => be.matmul(a, b));
  }
  binary(op: GpuBinaryOp, a: Tensor, b: Tensor): Promise<Tensor> {
    return this.route((be) => be.binary(op, a, b));
  }
  unary(op: GpuUnaryOp, x: Tensor): Promise<Tensor> {
    return this.route((be) => be.unary(op, x));
  }
  reduce(op: GpuReduceOp, x: Tensor, axis: number): Promise<Tensor> {
    return this.route((be) => be.reduce(op, x, axis));
  }
  softmax(x: Tensor): Promise<Tensor> {
    return this.route((be) => be.softmax(x));
  }
  layerNorm(x: Tensor, eps?: number): Promise<Tensor> {
    return this.route((be) => be.layerNorm(x, eps));
  }
  dispose(): void {
    this.gpu?.dispose();
    this.gpu = null;
  }
}

/** One row of `selfTest` output. */
export interface SelfTestRow {
  kernel: string;
  ok: boolean;
  maxError: number;
}

/**
 * Runs every kernel on `backend` and on the CPU with the same seeded inputs,
 * comparing within a float32 tolerance (E-ML-02). Use it in the browser to
 * validate the WebGPU backend on a real device.
 */
export async function selfTest(backend: ComputeBackend, seed = 1): Promise<SelfTestRow[]> {
  const rng = new Rng(seed);
  const cpu = new CpuBackend();
  const a = randn([3, 37, 29], { rng });
  const b = randn([29, 41], { rng });
  const c = randn([37, 29], { rng });
  const row = randn([29], { rng });
  const positive = randn([5, 7], { rng }).abs().add(0.1);
  const cases: [string, (be: ComputeBackend) => Promise<Tensor>][] = [
    ['matmul batched', (be) => be.matmul(a, b)],
    [
      'matmul 128x128',
      (be) =>
        be.matmul(
          randn([128, 128], { rng: new Rng(seed + 1) }),
          randn([128, 128], { rng: new Rng(seed + 2) }),
        ),
    ],
    ['add broadcast', (be) => be.binary('add', a, row)],
    ['mul', (be) => be.binary('mul', c, c)],
    ['div', (be) => be.binary('div', c, positive.sum().add(1))],
    ['maximum', (be) => be.binary('maximum', a, c)],
    ['exp', (be) => be.unary('exp', c)],
    ['log', (be) => be.unary('log', positive)],
    ['tanh', (be) => be.unary('tanh', c.mul(10))],
    ['gelu', (be) => be.unary('gelu', c)],
    ['relu', (be) => be.unary('relu', c)],
    ['sum axis 1', (be) => be.reduce('sum', a, 1)],
    ['max axis -1', (be) => be.reduce('max', a, -1)],
    ['softmax', (be) => be.softmax(a.mul(5))],
    ['layerNorm', (be) => be.layerNorm(a)],
  ];
  const rows: SelfTestRow[] = [];
  for (const [kernel, run] of cases) {
    const want = await run(cpu);
    const got = await run(backend);
    let maxError = 0;
    for (let i = 0; i < Math.min(want.size, got.size); i++) {
      maxError = Math.max(maxError, Math.abs(want.data[i]! - got.data[i]!));
    }
    rows.push({ kernel, ok: allClose(got, want, 1e-3, 1e-4), maxError });
  }
  return rows;
}
