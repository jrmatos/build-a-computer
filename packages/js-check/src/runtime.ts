/**
 * Runs inside the sandbox worker (never on the page or in the simulation
 * worker). The bundle built by transform.ts locks the global scope down on
 * its first line, then calls boot() with the module functions. boot() waits
 * for the 'start' request, seeds Math.random, installs report() /
 * checkpoint() / restoreCheckpoint() and console capture, evaluates main.js
 * with the allowed modules and calls the entry function.
 */
import * as tensorLib from '@build-a-computer/tensor';
import * as tokenizer from './tokenizer';
import * as plot from './plot';
import { fromCheckpoint, isTensorLike, toCheckpoint, toSafe, type SavedTensor } from './serialize';
import type { DatasetMeta, FromSandbox, GpuMode, MlSample, RawError, StartRequest, ToSandbox } from './protocol';

interface Host {
  post(m: FromSandbox): void;
  listen(f: (m: ToSandbox) => void): void;
}

type ModuleFn = (sbx: Sbx, ex: Record<string, unknown>, dynImport: (spec: string) => Promise<unknown>, meta: { meta: { url: string } }) => Promise<void>;
type Factory = (sbx: Sbx) => Record<string, ModuleFn>;

interface Sbx {
  imp(spec: string, from: string, line: number): Promise<Record<string, unknown>>;
  pick(ns: Record<string, unknown>, spec: string, names: string, file: string, line: number): Record<string, unknown>;
  exp(ex: Record<string, unknown>, getters: Record<string, () => unknown>): void;
  reexp(ex: Record<string, unknown>, ns: Record<string, unknown>, names: string | null, spec: string, file: string, line: number): void;
}

/** Thrown by report() when a value is NaN or infinite (E-ML-03). */
class NaNError extends Error {
  override name = 'NaNError';
}

/** An error with a known player-file position (import problems). */
class PlacedError extends Error {
  constructor(name: string, message: string, readonly file: string, readonly line: number) {
    super(message);
    this.name = name;
  }
}

const FLUSH_MS = 33; // at most ~30 batches a second
const LOG_LIMIT = 64 * 1024;

/** mulberry32: small, fast, good enough for Math.random replacement. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The parts of the tensor package the runtime uses for GPU-resident tensors. */
interface GpuTensor {
  gpu: unknown;
  readonly readable: boolean;
  read(): Promise<unknown>;
}
interface TensorGpuApi {
  Tensor: new (...a: never[]) => GpuTensor;
  initGpu(o: { gpu?: unknown; allowFallbackAdapter?: boolean }): Promise<{ device: 'webgpu' | 'cpu'; message: string }>;
  setGpuRuntime(rt: unknown, message?: string): void;
  gpuRuntime(): { onFirstUse: (() => void) | null } | null;
  GpuRuntime: new (device: unknown, limits: unknown) => unknown;
  flushFiniteChecks(): Promise<void>;
  backend: { readLimits(l: unknown): unknown };
}

const GPU_INIT_MS = 3000;

// The test emulator ('emulated' GPU mode) is only loaded in Node, before the
// Node runner locks module loading; browsers never fetch it.
const nodeEmulator = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node
  ? await import('@build-a-computer/tensor/emulator').catch(() => null)
  : null;

/**
 * Connects the tensor modules to a GPU (E-ML-01: when that fails or takes
 * too long, everything stays on the CPU and the message says why). Calls
 * `onUse` the first time a GPU kernel runs.
 */
async function setupGpu(mode: GpuMode, onUse: () => void): Promise<{ device: 'webgpu' | 'cpu'; message: string }> {
  const lib = tensorLib as unknown as TensorGpuApi;
  if (typeof lib.initGpu !== 'function') return { device: 'cpu', message: 'No GPU support in this build.' };
  let result: { device: 'webgpu' | 'cpu'; message: string };
  if (mode === 'off') {
    lib.setGpuRuntime(null);
    return { device: 'cpu', message: 'This level trains on the CPU.' };
  }
  if (mode === 'emulated') {
    if (!nodeEmulator) return { device: 'cpu', message: 'The GPU emulator is only available in Node tests.' };
    const emu = nodeEmulator.emulatedDevice();
    lib.setGpuRuntime(new lib.GpuRuntime(emu.device, lib.backend.readLimits(emu.device.limits)), 'Using an emulated GPU (tests).');
    result = { device: 'webgpu', message: 'Using an emulated GPU (tests).' };
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ device: 'cpu'; message: string }>((resolve) => {
      timer = setTimeout(() => resolve({ device: 'cpu', message: 'The GPU did not answer in time; training runs on the CPU.' }), GPU_INIT_MS);
    });
    result = await Promise.race([lib.initGpu({}), timeout]).finally(() => clearTimeout(timer));
    if (result.device === 'cpu') lib.setGpuRuntime(null);
  }
  const rt = lib.gpuRuntime();
  if (rt) rt.onFirstUse = onUse;
  return result;
}

/** GPU tensors (not yet read back) anywhere inside a value. */
function gpuTensorsIn(value: unknown): GpuTensor[] {
  const Tensor = (tensorLib as unknown as TensorGpuApi).Tensor;
  const found: GpuTensor[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): void => {
    if (!v || typeof v !== 'object' || depth > 32 || seen.has(v) || ArrayBuffer.isView(v)) return;
    seen.add(v);
    if (Tensor && v instanceof Tensor) {
      if (v.gpu && !v.readable) found.push(v);
      return;
    }
    if (v instanceof Map) for (const x of v.values()) walk(x, depth + 1);
    else if (v instanceof Set) for (const x of v) walk(x, depth + 1);
    else for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(value, 0);
  return found;
}

/** Copies every GPU tensor inside `value` back to the CPU (results, checkpoints, report values). */
async function readBack(value: unknown): Promise<void> {
  await Promise.all(gpuTensorsIn(value).map((t) => t.read()));
}

/** Library namespaces for the 'tensor', 'autograd', 'nn' and 'optim' modules. */
function tensorModule(name: string): Record<string, unknown> {
  const lib = tensorLib as unknown as Record<string, unknown>;
  const table = (lib.JS_MODULE_MAP ?? lib.jsModules) as Record<string, Record<string, unknown>> | undefined;
  if (table && table[name]) return table[name];
  const ns = lib[name];
  if (ns && typeof ns === 'object' && !Array.isArray(ns)) return ns as Record<string, unknown>;
  return lib;
}

function formatArg(v: unknown, depth = 0): string {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined || typeof v === 'bigint') return String(v);
  if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
  if (typeof v === 'symbol') return v.toString();
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (isTensorLike(v) && typeof (v as { toString?: unknown }).toString === 'function' && (v as object).toString !== Object.prototype.toString)
    return String(v);
  if (depth > 2) return Array.isArray(v) ? '[…]' : '{…}';
  if (ArrayBuffer.isView(v)) {
    const a = Array.from(v as unknown as ArrayLike<number>);
    return `${v.constructor.name}(${a.length}) [${a.slice(0, 20).join(', ')}${a.length > 20 ? ', …' : ''}]`;
  }
  if (Array.isArray(v)) return `[${v.slice(0, 50).map((x) => formatArg(x, depth + 1)).join(', ')}${v.length > 50 ? ', …' : ''}]`;
  const keys = Object.keys(v as object);
  return `{ ${keys.slice(0, 30).map((k) => `${k}: ${formatArg((v as Record<string, unknown>)[k], depth + 1)}`).join(', ')}${keys.length > 30 ? ', …' : ''} }`;
}

function rawError(e: unknown): RawError {
  if (e instanceof PlacedError) return { name: e.name, message: e.message, file: e.file, line: e.line };
  if (e instanceof Error) return { name: e.name, message: e.message, stack: String(e.stack ?? '') };
  return { name: 'Error', message: `Uncaught ${formatArg(e)}` };
}

/** Entry point called by the bundle's last line. */
export function boot(host: Host, factory: Factory): void {
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let started = false;
  host.listen((msg) => {
    if (msg.type === 'start' && !started) {
      started = true;
      void run(host, factory, msg, pending);
    } else if (msg.type === 'dataset') {
      const p = pending.get(msg.req);
      if (!p) return;
      pending.delete(msg.req);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.message));
    }
  });
  host.post({ type: 'ready' });
}

async function run(
  host: Host,
  factory: Factory,
  req: StartRequest,
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>,
): Promise<void> {
  const g = globalThis as unknown as Record<string, unknown>;
  const clock = Date.now;
  // --- Output batching (<= 30 Hz) ---
  let logBuf = '';
  let samples: MlSample[] = [];
  let lastFlush = clock();
  const flush = (): void => {
    lastFlush = clock();
    if (logBuf) {
      host.post({ type: 'log', text: logBuf });
      logBuf = '';
    }
    if (samples.length) {
      host.post({ type: 'samples', samples });
      samples = [];
    }
  };
  const maybeFlush = (): void => {
    if (clock() - lastFlush >= FLUSH_MS) flush();
  };
  const ticker = setInterval(maybeFlush, 50);
  const log = (prefix: string, args: unknown[]): void => {
    logBuf += prefix + args.map((a) => formatArg(a)).join(' ') + '\n';
    if (logBuf.length > LOG_LIMIT * 2) logBuf = '…\n' + logBuf.slice(-LOG_LIMIT);
    maybeFlush();
  };

  // --- Determinism: seeded Math.random and crypto.getRandomValues ---
  const rand = seededRandom(req.seed);
  Math.random = rand;
  const cryptoObj = g.crypto as { getRandomValues?: unknown } | undefined;
  if (cryptoObj) {
    try {
      Object.defineProperty(cryptoObj, 'getRandomValues', {
        value: <T extends ArrayBufferView>(arr: T): T => {
          const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
          for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
          return arr;
        },
        configurable: true,
      });
    } catch {
      /* read-only crypto: leave it */
    }
  }
  const manualSeed = (tensorLib as unknown as { manualSeed?: (s: number) => void }).manualSeed;
  if (typeof manualSeed === 'function') manualSeed(req.seed);

  // --- Player-facing globals ---
  const consoleObj = {
    log: (...a: unknown[]) => log('', a),
    info: (...a: unknown[]) => log('', a),
    debug: (...a: unknown[]) => log('', a),
    warn: (...a: unknown[]) => log('warning: ', a),
    error: (...a: unknown[]) => log('error: ', a),
    table: (rows: unknown) => log('', [Array.isArray(rows) ? plot.table(rows as Record<string, unknown>[]) : rows]),
  };
  Object.defineProperty(g, 'console', { value: consoleObj, configurable: true, writable: true });
  let step = req.checkpoint !== undefined && req.checkpoint !== null && typeof req.checkpointStep === 'number' ? req.checkpointStep + 1 : 0;
  // Values on the GPU are read back in the background, in order; report()
  // never waits. A NaN found that way is thrown by the next report() call
  // (or when the code finishes): a step or two late, never lost.
  let reportChain: Promise<void> = Promise.resolve();
  let lateError: Error | null = null;
  const throwLateNaN = (): void => {
    if (!lateError) return;
    const e = lateError;
    lateError = null;
    throw e;
  };
  const record = (values: Record<string, unknown>, s0: number): number => {
    const out: Record<string, number> = {};
    let s = s0;
    for (const [k, raw] of Object.entries(values)) {
      let v = raw;
      if (isTensorLike(v) && v.data.length === 1) v = v.data[0];
      if (typeof v !== 'number') continue;
      if (k === 'step') {
        s = v;
        continue;
      }
      if (!Number.isFinite(v)) {
        samples.push({ step: s, values: { ...out, [k]: v } });
        throw new NaNError(`${k} became ${v} — try a lower learning rate`);
      }
      out[k] = v;
    }
    samples.push({ step: s, values: out });
    maybeFlush();
    return s;
  };
  g.report = (values: Record<string, unknown>): void => {
    if (!values || typeof values !== 'object') throw new TypeError('report() takes an object, e.g. report({ loss, acc }).');
    throwLateNaN();
    const pendingGpu = gpuTensorsIn(values);
    if (pendingGpu.length === 0) {
      step = record(values, step) + 1;
      return;
    }
    const own = values.step;
    const s = typeof own === 'number' ? own : step;
    step = s + 1;
    const copy = { ...values };
    // Start the copies now: GPU memory of this step's results is recycled a step later.
    const reads = Promise.all(pendingGpu.map((t) => t.read()));
    reads.catch(() => {}); // handled in the chain below
    reportChain = reportChain.then(async () => {
      try {
        await reads;
        record(copy, s);
      } catch (e) {
        lateError ??= e instanceof Error ? e : new Error(String(e));
      }
    });
  };
  g.checkpoint = (state: unknown): void => {
    const own = (state as { step?: unknown } | null)?.step;
    const at = typeof own === 'number' ? own : Math.max(0, step - 1);
    if (gpuTensorsIn(state).length === 0) {
      host.post({ type: 'checkpoint', step: at, state: toCheckpoint(state) });
      return;
    }
    // Parameters on the GPU: copy them back first (this is the only other readback).
    const reads = readBack(state);
    reads.catch(() => {}); // handled in the chain below
    reportChain = reportChain.then(async () => {
      try {
        await reads;
        host.post({ type: 'checkpoint', step: at, state: toCheckpoint(state) });
      } catch (e) {
        lateError ??= e instanceof Error ? e : new Error(String(e));
      }
    });
  };
  const Tensor = (tensorLib as unknown as { Tensor?: new (d: Float32Array | Float64Array, s: number[], r?: boolean) => unknown }).Tensor;
  g.restoreCheckpoint = (): unknown =>
    req.checkpoint === undefined || req.checkpoint === null
      ? null
      : fromCheckpoint(req.checkpoint, (t: SavedTensor) => (Tensor ? new Tensor(t.data.slice(), t.shape, t.requiresGrad) : { shape: t.shape, data: t.data.slice() }));

  // --- Modules ---
  let reqId = 0;
  const datasets = new Map(req.datasets.map((d) => [d.id, d.meta] as const));
  const dataModule = {
    /** Ids of the datasets this level provides. */
    datasets: req.datasets.map((d) => d.id),
    info(id: string): DatasetMeta {
      const meta = datasets.get(id);
      if (!meta) throw new Error(`Dataset '${id}' is not available in this level (available: ${[...datasets.keys()].join(', ') || 'none'}).`);
      return meta;
    },
    load(id: string): Promise<unknown> {
      if (!datasets.get(id)) return Promise.reject(new Error(`Dataset '${id}' is not available in this level (available: ${[...datasets.keys()].join(', ') || 'none'}).`));
      const n = ++reqId;
      return new Promise((resolve, reject) => {
        pending.set(n, { resolve, reject });
        host.post({ type: 'dataset', req: n, id });
      });
    },
  };
  const builtins: Record<string, () => Record<string, unknown>> = {
    tensor: () => tensorModule('tensor'),
    autograd: () => tensorModule('autograd'),
    nn: () => tensorModule('nn'),
    optim: () => tensorModule('optim'),
    data: () => dataModule,
    tokenizer: () => tokenizer as unknown as Record<string, unknown>,
    plot: () => plot as unknown as Record<string, unknown>,
  };
  const nsCache = new Map<string, Record<string, unknown>>();
  const builtin = (name: string): Record<string, unknown> => {
    let ns = nsCache.get(name);
    if (!ns) {
      const src = builtins[name]!();
      ns = Object.freeze({ ...src, default: src.default ?? src });
      nsCache.set(name, ns);
    }
    return ns;
  };
  let fns: Record<string, ModuleFn> = {};
  const evaluated = new Map<string, { ex: Record<string, unknown>; done: Promise<void> }>();
  const libNames = new Set(req.library);
  const allowedList = (): string => [...req.modules.map((m) => `'${m}'`), ...req.library.map((l) => `'./${l}'`)].join(', ') || 'nothing';

  function evaluate(file: string): { ex: Record<string, unknown>; done: Promise<void> } {
    const hit = evaluated.get(file);
    if (hit) return hit;
    const ex: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(ex, Symbol.toStringTag, { value: 'Module' });
    const rec = { ex, done: Promise.resolve() };
    evaluated.set(file, rec);
    const fn = fns[file];
    if (!fn) throw new Error(`Missing module ${file}`);
    rec.done = fn(api, ex, (spec: string) => api.imp(spec, file, 0), { meta: { url: file } });
    return rec;
  }

  function resolveFile(spec: string): string | undefined {
    if (!spec.startsWith('./')) return undefined;
    const name = spec.slice(2);
    if (libNames.has(name)) return name;
    if (libNames.has(`${name}.js`)) return `${name}.js`;
    return undefined;
  }

  const api: Sbx = {
    async imp(spec, from, line) {
      if (Object.prototype.hasOwnProperty.call(builtins, spec) && req.modules.includes(spec)) return builtin(spec);
      const file = resolveFile(spec);
      if (file) {
        const rec = evaluate(file);
        await rec.done;
        return rec.ex;
      }
      const where = line ? ` (${from} line ${line})` : '';
      const msg = Object.prototype.hasOwnProperty.call(builtins, spec)
        ? `The '${spec}' module is not unlocked in this level${where}. You can import ${allowedList()}.`
        : `Cannot import '${spec}'${where}: this sandbox has no network or files. You can import ${allowedList()}.`;
      throw line ? new PlacedError('ImportError', msg, from, line) : new Error(msg);
    },
    pick(ns, spec, names, file, line) {
      for (const n of JSON.parse(names) as string[]) {
        if (!(n in ns)) throw new PlacedError('SyntaxError', `The module '${spec}' has no export named '${n}'.`, file, line);
      }
      return ns;
    },
    exp(ex, getters) {
      for (const [k, get] of Object.entries(getters)) Object.defineProperty(ex, k, { get, enumerable: true, configurable: true });
    },
    reexp(ex, ns, names, spec, file, line) {
      const list: [string, string][] = names ? (JSON.parse(names) as [string, string][]) : Object.keys(ns).filter((k) => k !== 'default').map((k) => [k, k]);
      for (const [exported, imported] of list) {
        if (imported !== '*' && !(imported in ns)) throw new PlacedError('SyntaxError', `The module '${spec}' has no export named '${imported}'.`, file, line);
        Object.defineProperty(ex, exported, { get: () => (imported === '*' ? ns : ns[imported]), enumerable: true, configurable: true });
      }
    },
  };

  try {
    // --- GPU for the tensor modules (training levels), before any player code ---
    const lib = tensorLib as unknown as TensorGpuApi;
    let deviceInfo = { available: 'cpu' as 'webgpu' | 'cpu', used: false, message: '' };
    const gpuMode = req.gpu ?? 'off';
    if (gpuMode !== 'off' || typeof lib.setGpuRuntime === 'function') {
      const chosen = await setupGpu(gpuMode, () => {
        deviceInfo = { ...deviceInfo, used: true };
        host.post({ type: 'device', info: deviceInfo });
      });
      deviceInfo = { available: chosen.device, used: false, message: chosen.message };
      if (gpuMode !== 'off') host.post({ type: 'device', info: deviceInfo });
    }
    fns = factory(api);
    const main = evaluate('main.js');
    await main.done;
    const fn = main.ex[req.entry];
    if (typeof fn !== 'function') {
      throw new PlacedError(
        'ReferenceError',
        `main.js does not export a function named '${req.entry}'. Add: export function ${req.entry}(...) { … }`,
        'main.js',
        0,
      );
    }
    const result = await (fn as (...a: unknown[]) => unknown)(...req.args);
    await reportChain;
    throwLateNaN();
    if (typeof lib.flushFiniteChecks === 'function') await lib.flushFiniteChecks();
    await readBack(result);
    const safe = toSafe(result);
    clearInterval(ticker);
    flush();
    host.post({ type: 'done', ok: true, result: safe });
  } catch (e) {
    clearInterval(ticker);
    flush();
    host.post({ type: 'done', ok: false, error: rawError(e) });
  }
}
