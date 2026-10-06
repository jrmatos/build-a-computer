/**
 * An emulated WebGPU device for tests: it runs a JavaScript twin of each
 * kernel in gpu-kernels.ts (same parameter words, same index arithmetic), so
 * the GPU tensor path, autograd and optimizers can be checked against the
 * CPU in Node. It also validates what a real device would reject: binding
 * counts, destroyed buffers in a submit, unaligned writes.
 *
 * It does not run WGSL; the real-GPU check (scripts/gpu-check.mjs and the
 * /gpu-check.html dev page) covers the shaders themselves.
 */
import { kernelName, KERNEL_BINARY } from './gpu-kernels';
import type { GpuAdapterLike, GpuBufferLike, GpuDeviceLike, GpuLike } from './webgpu';
import { DEFAULT_GPU_LIMITS, type GpuLimits } from './wgsl';

interface View {
  f: Float32Array;
  u: Uint32Array;
}

type Twin = (b: View[], P: Uint32Array, grid: [number, number, number]) => void;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const fl = (bits: number): number => {
  u32[0] = bits;
  return f32[0]!;
};
const fr = Math.fround;

function binaryOp(op: string, a: number, b: number, fill: number): number {
  switch (op) {
    case 'add':
      return a + b;
    case 'sub':
      return a - b;
    case 'mul':
      return a * b;
    case 'div':
      return a / b;
    case 'maximum':
      return a >= b ? a : b;
    case 'minimum':
      return a <= b ? a : b;
    case 'eq':
      return a === b ? 1 : 0;
    case 'gt':
      return a > b ? 1 : 0;
    case 'ge':
      return a >= b ? 1 : 0;
    case 'lt':
      return a < b ? 1 : 0;
    case 'le':
      return a <= b ? 1 : 0;
    case 'maskfill':
      return b !== 0 ? fill : a;
  }
  throw new Error(`emulator: unknown binary op ${op}`);
}

function scalarOp(op: string, x: number, c: number): number {
  if (op === 'rsub') return c - x;
  if (op === 'rdiv') return c / x;
  return binaryOp(op, x, c, 0);
}

function powi(x: number, e: number): number {
  if (e === 0) return 1;
  if (e === 1) return x;
  if (e === 2) return x * x;
  const r = Math.abs(x) ** e;
  if (x >= 0) return r;
  if (e % 1 !== 0) return NaN;
  return (e / 2) % 1 !== 0 ? -r : r;
}

const GELU_C = 0.7978845608;
const clampT = (v: number): number => Math.min(15, Math.max(-15, v));

function unaryOp(op: string, x: number, p0: number, p1: number): number {
  switch (op) {
    case 'neg':
      return -x;
    case 'exp':
      return Math.exp(x);
    case 'log':
      return Math.log(x);
    case 'sqrt':
      return Math.sqrt(x);
    case 'abs':
      return Math.abs(x);
    case 'tanh':
      return Math.tanh(clampT(x));
    case 'sigmoid':
      return 1 / (1 + Math.exp(-x));
    case 'relu':
      return Math.max(x, 0);
    case 'gelu':
      return 0.5 * x * (1 + Math.tanh(clampT(GELU_C * (x + 0.044715 * x * x * x))));
    case 'square':
      return x * x;
    case 'sin':
      return Math.sin(x);
    case 'cos':
      return Math.cos(x);
    case 'copy':
      return x;
    case 'clamp':
      return Math.min(p1, Math.max(p0, x));
    case 'pow':
      return powi(x, p0);
  }
  throw new Error(`emulator: unknown unary op ${op}`);
}

function unaryGrad(op: string, x: number, y: number, g: number, p0: number, p1: number): number {
  switch (op) {
    case 'neg':
      return -g;
    case 'exp':
      return g * y;
    case 'log':
      return g / x;
    case 'sqrt':
      return (g * 0.5) / y;
    case 'abs':
      return g * Math.sign(x);
    case 'tanh':
      return g * (1 - y * y);
    case 'sigmoid':
      return g * y * (1 - y);
    case 'relu':
      return x > 0 ? g : 0;
    case 'gelu': {
      const t = Math.tanh(clampT(GELU_C * (x + 0.044715 * x * x * x)));
      return g * (0.5 * (1 + t) + 0.5 * x * (1 - t * t) * GELU_C * (1 + 3 * 0.044715 * x * x));
    }
    case 'square':
      return g * 2 * x;
    case 'sin':
      return g * Math.cos(x);
    case 'cos':
      return -g * Math.sin(x);
    case 'copy':
      return g;
    case 'clamp':
      return x >= p0 && x <= p1 ? g : 0;
    case 'pow':
      return g * p0 * powi(x, p0 - 1);
  }
  throw new Error(`emulator: unknown unary op ${op}`);
}

/** Visits each (o, j) of [outer, len, inner] with the middle-axis base index. */
function forRows(P: Uint32Array, f: (i: number, base: number) => void): void {
  const [outer, , inner] = [P[0]!, P[1]!, P[2]!];
  for (let i = 0; i < outer * inner; i++) {
    const o = Math.floor(i / inner);
    const j = i % inner;
    f(i, o * P[1]! * inner + j);
  }
}

function argBest(x: Float32Array, base: number, len: number, inner: number, max: boolean): number {
  let best = x[base]!;
  let at = 0;
  for (let r = 1; r < len; r++) {
    const v = x[base + r * inner]!;
    if (max ? v > best : v < best) {
      best = v;
      at = r;
    }
  }
  return at;
}

const TWINS: Record<string, Twin> = {
  fill: ([y], P) => y!.f.fill(fl(P[1]!), 0, P[0]!),
  strided: ([x, y], P) => {
    const rank = P[1]!;
    for (let i = 0; i < P[0]!; i++) {
      let rest = i;
      let src = P[2]!;
      for (let d = 0; d < rank; d++) {
        const ax = rank - 1 - d;
        const size = P[3 + ax]!;
        src += (rest % size) * P[3 + rank + ax]!;
        rest = Math.floor(rest / size);
      }
      y!.f[i] = x!.f[src]!;
    }
  },
  sliceGrad: ([g, dx], P) => {
    const [n, d, inner, s, len] = [P[0]!, P[1]!, P[2]!, P[3]!, P[4]!];
    for (let i = 0; i < n; i++) {
      const c = i % inner;
      const r = Math.floor(i / inner);
      const j = r % d;
      const o = Math.floor(r / d);
      dx!.f[i] = j >= s && j < s + len ? g!.f[(o * len + j - s) * inner + c]! : 0;
    }
  },
  insert: ([x, y], P) => {
    const [n, len, inner, total, offset] = [P[0]!, P[1]!, P[2]!, P[3]!, P[4]!];
    for (let i = 0; i < n; i++) {
      const c = i % inner;
      const r = Math.floor(i / inner);
      const j = r % len;
      const o = Math.floor(r / len);
      y!.f[(o * total + offset + j) * inner + c] = x!.f[i]!;
    }
  },
  indexRows: ([x, idx, y], P) => {
    const [n, nIdx, inner, d] = [P[0]!, P[1]!, P[2]!, P[3]!];
    for (let i = 0; i < n; i++) {
      const c = i % inner;
      const r = Math.floor(i / inner);
      const j = r % nIdx;
      const o = Math.floor(r / nIdx);
      y!.f[i] = x!.f[(o * d + idx!.u[j]!) * inner + c]!;
    }
  },
  take: ([x, src, y], P) => {
    for (let i = 0; i < P[0]!; i++) y!.f[i] = x!.f[src!.u[i]!]!;
  },
  scatterAdd: ([g, l, dx], P) => {
    const [unique, inner, offs, pos] = [P[0]!, P[1]!, P[2]!, P[3]!];
    for (let i = 0; i < unique * inner; i++) {
      const u = Math.floor(i / inner);
      const c = i % inner;
      let s = 0;
      for (let k = l!.u[offs + u]!; k < l!.u[offs + u + 1]!; k++) s = fr(s + g!.f[l!.u[pos + k]! * inner + c]!);
      dx!.f[l!.u[u]! * inner + c] = s;
    }
  },
  matmul: ([a, b, c], P, grid) => {
    const [M, K, N, aS, bS, tA, tB] = [P[0]!, P[1]!, P[2]!, P[3]!, P[4]!, P[5]!, P[6]!];
    for (let z = 0; z < grid[2]; z++) {
      for (let row = 0; row < M; row++) {
        for (let col = 0; col < N; col++) {
          let acc = 0;
          for (let k = 0; k < K; k++) {
            const av = a!.f[z * aS + (tA ? k * M + row : row * K + k)]!;
            const bv = b!.f[z * bS + (tB ? col * K + k : k * N + col)]!;
            acc = fr(acc + fr(av * bv));
          }
          c!.f[z * M * N + row * N + col] = acc;
        }
      }
    }
  },
  argmax: ([x, y], P) => forRows(P, (i, base) => (y!.f[i] = argBest(x!.f, base, P[1]!, P[2]!, true))),
  argmin: ([x, y], P) => forRows(P, (i, base) => (y!.f[i] = argBest(x!.f, base, P[1]!, P[2]!, false))),
  softmax: ([x, y], P) => softmaxRows(x!.f, y!.f, P[0]!, P[1]!, false),
  logSoftmax: ([x, y], P) => softmaxRows(x!.f, y!.f, P[0]!, P[1]!, true),
  softmaxGrad: ([y, g, dx], P) => {
    const [rows, cols] = [P[0]!, P[1]!];
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      let s = 0;
      for (let c = 0; c < cols; c++) s += g!.f[base + c]! * y!.f[base + c]!;
      for (let c = 0; c < cols; c++) dx!.f[base + c] = y!.f[base + c]! * (g!.f[base + c]! - s);
    }
  },
  logSoftmaxGrad: ([y, g, dx], P) => {
    const [rows, cols] = [P[0]!, P[1]!];
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      let s = 0;
      for (let c = 0; c < cols; c++) s += g!.f[base + c]!;
      for (let c = 0; c < cols; c++) dx!.f[base + c] = g!.f[base + c]! - Math.exp(y!.f[base + c]!) * s;
    }
  },
  layerNorm: ([x, gamma, beta, y, stats], P) => {
    const [rows, cols, eps] = [P[0]!, P[1]!, fl(P[2]!)];
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      let mean = 0;
      for (let c = 0; c < cols; c++) mean += x!.f[base + c]!;
      mean /= cols;
      let variance = 0;
      for (let c = 0; c < cols; c++) variance += (x!.f[base + c]! - mean) ** 2;
      const rstd = 1 / Math.sqrt(variance / cols + eps);
      for (let c = 0; c < cols; c++)
        y!.f[base + c] = (x!.f[base + c]! - mean) * rstd * gamma!.f[c]! + beta!.f[c]!;
      stats!.f[2 * r] = mean;
      stats!.f[2 * r + 1] = rstd;
    }
  },
  layerNormGrad: ([x, gamma, stats, g, dx], P) => {
    const [rows, cols] = [P[0]!, P[1]!];
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      const mean = stats!.f[2 * r]!;
      const rstd = stats!.f[2 * r + 1]!;
      let sumD = 0;
      let sumDX = 0;
      for (let c = 0; c < cols; c++) {
        const d = g!.f[base + c]! * gamma!.f[c]!;
        sumD += d;
        sumDX += d * (x!.f[base + c]! - mean) * rstd;
      }
      for (let c = 0; c < cols; c++) {
        const xhat = (x!.f[base + c]! - mean) * rstd;
        dx!.f[base + c] = rstd * (g!.f[base + c]! * gamma!.f[c]! - sumD / cols - (xhat * sumDX) / cols);
      }
    }
  },
  layerNormParamGrad: ([x, stats, g, dg, db], P) => {
    const [rows, cols] = [P[0]!, P[1]!];
    for (let c = 0; c < cols; c++) {
      let sg = 0;
      let sb = 0;
      for (let r = 0; r < rows; r++) {
        const gv = g!.f[r * cols + c]!;
        sg += gv * (x!.f[r * cols + c]! - stats!.f[2 * r]!) * stats!.f[2 * r + 1]!;
        sb += gv;
      }
      dg!.f[c] = sg;
      db!.f[c] = sb;
    }
  },
  crossEntropy: ([x, t, loss, lse], P) => {
    const [rows, cols] = [P[0]!, P[1]!];
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      let m = x!.f[base]!;
      for (let c = 1; c < cols; c++) m = Math.max(m, x!.f[base + c]!);
      let s = 0;
      for (let c = 0; c < cols; c++) s += Math.exp(x!.f[base + c]! - m);
      const l = m + Math.log(s);
      lse!.f[r] = l;
      loss!.f[r] = l - x!.f[base + t!.u[r]!]!;
    }
  },
  crossEntropyGrad: ([x, t, lse, g, dx], P) => {
    const [rows, cols] = [P[0]!, P[1]!];
    for (let i = 0; i < rows * cols; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      dx!.f[i] = (Math.exp(x!.f[i]! - lse!.f[r]!) - (c === t!.u[r] ? 1 : 0)) * g!.f[r]!;
    }
  },
  adam: ([g, w, m, v], P) => {
    const [lr, b1, b2, eps, wd, c1, c2] = [1, 2, 3, 4, 5, 6, 7].map((k) => fl(P[k]!)) as number[];
    for (let i = 0; i < P[0]!; i++) {
      let wi = w!.f[i]!;
      let gi = g!.f[i]!;
      if (P[8]) wi = wi - lr! * wd! * wi;
      else gi = gi + wd! * wi;
      const mi = b1! * m!.f[i]! + (1 - b1!) * gi;
      const vi = b2! * v!.f[i]! + (1 - b2!) * gi * gi;
      m!.f[i] = mi;
      v!.f[i] = vi;
      w!.f[i] = wi - (lr! * (mi / c1!)) / (Math.sqrt(vi / c2!) + eps!);
    }
  },
  sgd: ([g, w, vel], P) => {
    const [lr, momentum, wd] = [fl(P[1]!), fl(P[2]!), fl(P[3]!)];
    for (let i = 0; i < P[0]!; i++) {
      const gi = g!.f[i]! + wd * w!.f[i]!;
      const vi = momentum * vel!.f[i]! + gi;
      vel!.f[i] = vi;
      w!.f[i] = w!.f[i]! - lr * vi;
    }
  },
  nonFinite: ([x, y], P) => {
    for (let i = 0; i < P[0]!; i++) if (!Number.isFinite(x!.f[i]!)) y!.f[0] = 1;
  },
};

function softmaxRows(x: Float32Array, y: Float32Array, rows: number, cols: number, log: boolean): void {
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let m = x[base]!;
    for (let c = 1; c < cols; c++) m = Math.max(m, x[base + c]!);
    let s = 0;
    for (let c = 0; c < cols; c++) s += Math.exp(x[base + c]! - m);
    for (let c = 0; c < cols; c++)
      y[base + c] = log ? x[base + c]! - m - Math.log(s) : Math.exp(x[base + c]! - m) / s;
  }
}

/** Twin for a kernel name, including the op-parameterized families. */
function twinFor(name: string): Twin {
  const direct = TWINS[name];
  if (direct) return direct;
  const [family, op] = name.split('_') as [string, string];
  switch (family) {
    case 'binary':
      if (!(op in KERNEL_BINARY)) break;
      return ([a, b, y], P) => {
        const rank = P[1]!;
        const fill = fl(P[2 + 3 * rank]!);
        for (let i = 0; i < P[0]!; i++) {
          let ia = i;
          let ib = i;
          if (rank > 0) {
            let rest = i;
            ia = 0;
            ib = 0;
            for (let d = 0; d < rank; d++) {
              const ax = rank - 1 - d;
              const size = P[2 + ax]!;
              const coord = rest % size;
              rest = Math.floor(rest / size);
              ia += coord * P[2 + rank + ax]!;
              ib += coord * P[2 + 2 * rank + ax]!;
            }
          }
          y!.f[i] = binaryOp(op, a!.f[ia]!, b!.f[ib]!, fill);
        }
      };
    case 'scalar':
      return ([x, y], P) => {
        const c = fl(P[1]!);
        for (let i = 0; i < P[0]!; i++) y!.f[i] = scalarOp(op, x!.f[i]!, c);
      };
    case 'unary':
      return ([x, y], P) => {
        const [p0, p1] = [fl(P[1]!), fl(P[2]!)];
        for (let i = 0; i < P[0]!; i++) y!.f[i] = unaryOp(op, x!.f[i]!, p0, p1);
      };
    case 'unaryGrad':
      return ([x, y, g, dx], P) => {
        const [p0, p1] = [fl(P[1]!), fl(P[2]!)];
        for (let i = 0; i < P[0]!; i++) dx!.f[i] = unaryGrad(op, x!.f[i]!, y!.f[i]!, g!.f[i]!, p0, p1);
      };
    case 'reduce':
      return ([x, y], P) =>
        forRows(P, (i, base) => {
          let acc = op === 'sum' ? 0 : x!.f[base]!;
          for (let r = op === 'sum' ? 0 : 1; r < P[1]!; r++) {
            const v = x!.f[base + r * P[2]!]!;
            acc = op === 'sum' ? fr(acc + v) : op === 'max' ? Math.max(acc, v) : Math.min(acc, v);
          }
          y!.f[i] = acc;
        });
    case 'reduceGrad':
      return ([x, g, dx], P) =>
        forRows(P, (i, base) => {
          const at = argBest(x!.f, base, P[1]!, P[2]!, op === 'max');
          for (let r = 0; r < P[1]!; r++) dx!.f[base + r * P[2]!] = r === at ? g!.f[i]! : 0;
        });
  }
  throw new Error(`emulator: no twin for kernel ${name}`);
}

// -- The device ---------------------------------------------------------------

class EmuBuffer implements GpuBufferLike {
  readonly bytes: ArrayBuffer;
  destroyed = false;
  constructor(
    readonly size: number,
    readonly usage: number,
  ) {
    this.bytes = new ArrayBuffer(size);
  }
  async mapAsync(): Promise<void> {
    if (this.destroyed) throw new Error('emulator: mapAsync on a destroyed buffer');
  }
  getMappedRange(): ArrayBuffer {
    return this.bytes.slice(0);
  }
  unmap(): void {}
  destroy(): void {
    this.destroyed = true;
  }
}

interface EmuPipeline {
  code: string;
  name: string;
  bindings: number;
  getBindGroupLayout(i: number): unknown;
}

type Entry = { binding: number; resource: { buffer: GpuBufferLike; offset?: number; size?: number } };
type Op =
  | { kind: 'dispatch'; pipeline: EmuPipeline; entries: Entry[]; grid: [number, number, number] }
  | { kind: 'copy'; src: EmuBuffer; dst: EmuBuffer; size: number };

/** Counters the tests look at. */
export interface EmulatorLog {
  dispatches: string[];
  submits: number;
  buffers: number;
  writes: number;
}

/** An emulated device; `lose()` simulates a device loss (E-ML-01). */
export function emulatedDevice(limits: Partial<GpuLimits> = {}): {
  device: GpuDeviceLike;
  log: EmulatorLog;
  lose: (message: string) => void;
} {
  const log: EmulatorLog = { dispatches: [], submits: 0, buffers: 0, writes: 0 };
  let loseDevice: (info: { reason?: string; message?: string }) => void = () => {};
  const view = (e: Entry): View => {
    const b = e.resource.buffer as EmuBuffer;
    const offset = e.resource.offset ?? 0;
    const size = e.resource.size ?? b.size - offset;
    return { f: new Float32Array(b.bytes, offset, size / 4), u: new Uint32Array(b.bytes, offset, size / 4) };
  };
  const execute = (op: Op): void => {
    if (op.kind === 'copy') {
      if (op.src.destroyed || op.dst.destroyed) throw new Error('emulator: copy uses a destroyed buffer');
      new Uint8Array(op.dst.bytes).set(new Uint8Array(op.src.bytes, 0, op.size));
      return;
    }
    if (op.entries.length !== op.pipeline.bindings)
      throw new Error(`emulator: ${op.pipeline.name} declares ${op.pipeline.bindings} bindings, got ${op.entries.length}`);
    for (const e of op.entries)
      if ((e.resource.buffer as EmuBuffer).destroyed) throw new Error(`emulator: ${op.pipeline.name} uses a destroyed buffer`);
    const views = op.entries.sort((p, q) => p.binding - q.binding).map(view);
    const P = views.pop()!.u;
    log.dispatches.push(op.pipeline.name);
    twinFor(op.pipeline.name)(views, P, op.grid);
  };
  const device: GpuDeviceLike = {
    limits: { ...DEFAULT_GPU_LIMITS, ...limits },
    lost: new Promise((resolve) => (loseDevice = resolve)),
    queue: {
      writeBuffer: (buffer, offset, data) => {
        if (data.byteLength % 4 !== 0) throw new Error('emulator: writeBuffer size must be a multiple of 4');
        const b = buffer as EmuBuffer;
        if (b.destroyed) throw new Error('emulator: writeBuffer to a destroyed buffer');
        new Uint8Array(b.bytes, offset, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        log.writes++;
      },
      submit: (commands) => {
        log.submits++;
        for (const ops of commands as Op[][]) for (const op of ops) execute(op);
      },
    },
    createBuffer: ({ size, usage }) => {
      if (size % 4 !== 0) throw new Error('emulator: buffer size must be a multiple of 4');
      log.buffers++;
      return new EmuBuffer(size, usage);
    },
    createShaderModule: ({ code }) => ({ code }),
    createComputePipeline: ({ compute }) => {
      const code = (compute.module as { code: string }).code;
      const bindings = new Set([...code.matchAll(/@binding\((\d+)\)/g)].map((m) => m[1])).size;
      return { code, name: kernelName(code), bindings, getBindGroupLayout: () => ({}) } as EmuPipeline;
    },
    createBindGroup: ({ entries }) => ({ entries }),
    createCommandEncoder: () => {
      const ops: Op[] = [];
      return {
        beginComputePass: () => {
          let pipeline: EmuPipeline | null = null;
          let entries: Entry[] = [];
          return {
            setPipeline: (p) => (pipeline = p as EmuPipeline),
            setBindGroup: (_i, group) => (entries = [...(group as { entries: Entry[] }).entries]),
            dispatchWorkgroups: (x, y = 1, z = 1) => ops.push({ kind: 'dispatch', pipeline: pipeline!, entries, grid: [x, y, z] }),
            end: () => {},
          };
        },
        copyBufferToBuffer: (src, _so, dst, _do, size) =>
          ops.push({ kind: 'copy', src: src as EmuBuffer, dst: dst as EmuBuffer, size }),
        finish: () => ops,
      };
    },
    destroy: () => {},
  };
  return { device, log, lose: (message) => loseDevice({ reason: 'unknown', message }) };
}

/** A navigator.gpu stand-in that hands out emulated devices. */
export function emulatedGpu(limits: Partial<GpuLimits> = {}): GpuLike & { devices: ReturnType<typeof emulatedDevice>[] } {
  const gpu = {
    devices: [] as ReturnType<typeof emulatedDevice>[],
    async requestAdapter(): Promise<GpuAdapterLike> {
      return {
        limits: { ...DEFAULT_GPU_LIMITS, ...limits },
        requestDevice: async () => {
          const d = emulatedDevice(limits);
          gpu.devices.push(d);
          return d.device;
        },
      };
    },
  };
  return gpu;
}
