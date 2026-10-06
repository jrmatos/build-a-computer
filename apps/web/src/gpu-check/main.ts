/**
 * Dev page (/gpu-check.html under `pnpm dev`): checks the tensor package on
 * this browser's real GPU and prints the results. Not part of the production
 * build. packages/tensor/scripts/gpu-check.mjs drives it headlessly and reads
 * `window.__gpuCheck`.
 *
 * 1. Compiles every training kernel (catches WGSL errors precisely).
 * 2. Forward self-test of the WebGpuBackend kernels against the CPU.
 * 3. Forward + backward of every GPU tensor op, and tiny-GPT training steps,
 *    against the CPU (E-ML-02 tolerances).
 * 4. Tokens/s of the Track 2 tiny GPT on the CPU and the GPU.
 * 5. CNT-14: time to train that GPT on Macbeth to validation loss < 2.8.
 *
 * Query: ?software allows a software adapter (SwiftShader); ?lowpower asks
 * for the integrated GPU on a two-GPU laptop; ?quick skips 5.
 */
import { startJs, type DeviceInfo, type MlSample } from '@build-a-computer/js-check';
import { Level } from '@build-a-computer/schema';
import macbeth from '../../../../packages/content/datasets/text/macbeth.txt?raw';
import { crossEntropy, GPT } from '../../../../packages/tensor/src/nn';
import { AdamW } from '../../../../packages/tensor/src/optim';
import { Rng } from '../../../../packages/tensor/src/random';
import { noGrad, Tensor, type Device } from '../../../../packages/tensor/src/tensor';
import {
  benchmarkTraining,
  createBackend,
  gpuKernels,
  gpuRuntime,
  initGpu,
  selfTest,
  TINY_GPT,
  TINY_GPT_BATCH,
  trainingSelfTest,
  type GpuCheckRow,
  type TrainingBenchmark,
} from '../../../../packages/tensor/src/backend/index';

interface Row {
  name: string;
  ok: boolean;
  maxError?: number;
  detail?: string;
}

interface Report {
  adapter: Record<string, unknown> | null;
  device: string;
  message: string;
  compile: Row[];
  selfTest: Row[];
  training: Row[];
  benchmark: TrainingBenchmark[];
  timeToTarget: { device: Device; steps: number; seconds: number; valLoss: number; reached: boolean }[];
  sandbox: Row[];
  error?: string;
}

// A training loop as player code, run in the real sandbox worker: the GPU
// must be reachable from a dedicated worker, report() takes GPU tensors.
const SANDBOX_TRAIN = `
import { GPT, crossEntropy } from 'nn';
import { AdamW } from 'optim';
import { randint } from 'tensor';
export async function main(steps) {
  const model = new GPT({ vocabSize: 12, blockSize: 8, dModel: 16, nHead: 2, nLayer: 1 }).to('auto');
  const opt = new AdamW(model.parameters(), { lr: 0.01 });
  let loss;
  for (let step = 0; step < steps; step++) {
    const x = randint(0, 12, [4, 8]);
    loss = crossEntropy(model.forward(x), Array.from(x.data, (v) => (v + 1) % 12));
    opt.zeroGrad();
    loss.backward();
    opt.step();
    report({ loss });
  }
  return { device: model.device, loss: await loss.itemAsync() };
}`;

async function sandboxRun(): Promise<Row[]> {
  const level = Level.parse({
    id: 'gpu-check', version: 1, track: 'sandbox', phase: 0, order: 0, title: 'GPU check', goal: '-', palette: [],
    starter: { parts: [], wires: [] }, tests: [], mode: 'js', js: { modules: ['tensor', 'nn', 'optim'], training: true },
  });
  const devices: DeviceInfo[] = [];
  const samples: MlSample[] = [];
  const t0 = performance.now();
  const out = await startJs(
    { source: SANDBOX_TRAIN, level, entry: 'main', args: [50], timeoutMs: 120_000 },
    { onDevice: (d) => devices.push(d), onSamples: (s) => samples.push(...s) },
  ).done;
  const result = out.result as { device?: string; loss?: number } | undefined;
  const last = devices.at(-1);
  return [
    { name: 'sandbox ran', ok: out.ok, detail: out.error?.message ?? `${Math.round(performance.now() - t0)} ms` },
    { name: 'model on the GPU in the worker', ok: result?.device === 'webgpu', detail: String(result?.device) },
    { name: 'badge: device used', ok: last?.used === true && last.available === 'webgpu', detail: JSON.stringify(last) },
    { name: 'report() samples from GPU tensors', ok: samples.length === 50 && samples.every((x) => Number.isFinite(x.values.loss)), detail: `${samples.length} samples, last ${samples.at(-1)?.values.loss}` },
  ];
}

const out = document.getElementById('out')!;
const params = new URLSearchParams(location.search);
const powerPreference = params.has('lowpower') ? 'low-power' : 'high-performance';

function table(rows: object[]): string {
  if (rows.length === 0) return '<p>(none)</p>';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string =>
    typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toPrecision(4)) : v === undefined ? '' : String(v);
  return `<table><tr>${keys.map((k) => `<th>${k}</th>`).join('')}</tr>${rows
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return `<tr class="${rec.ok === false ? 'bad' : ''}">${keys.map((k) => `<td>${cell(rec[k])}</td>`).join('')}</tr>`;
    })
    .join('')}</table>`;
}

function section(title: string, body: string): void {
  out.insertAdjacentHTML('beforeend', `<h2>${title}</h2>${body}`);
}

interface RealDevice {
  pushErrorScope(f: string): void;
  popErrorScope(): Promise<{ message: string } | null>;
  createShaderModule(d: { code: string }): { getCompilationInfo?(): Promise<{ messages: { type: string; message: string; lineNum: number }[] }> };
  createComputePipeline(d: unknown): unknown;
}

/** Compiles every kernel variant and reports the ones the driver rejects. */
async function compileAll(): Promise<Row[]> {
  const device = gpuRuntime()!.device as unknown as RealDevice;
  const rows: Row[] = [];
  for (const code of gpuKernels.allKernels()) {
    const name = gpuKernels.kernelName(code);
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo?.();
    device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const error = await device.popErrorScope();
    const errors = info?.messages.filter((m) => m.type === 'error').map((m) => `line ${m.lineNum}: ${m.message}`) ?? [];
    if (error) errors.push(error.message);
    rows.push({ name, ok: errors.length === 0, ...(errors.length ? { detail: errors.join(' | ') } : {}) });
  }
  return rows;
}

/** Trains the nn GPT on Macbeth (90/10 split) until the validation loss is below `target`. */
async function timeToTarget(device: Device, target: number, maxSeconds: number): Promise<Report['timeToTarget'][number]> {
  const vocab = [...new Set(macbeth)].sort();
  const index = new Map(vocab.map((c, i) => [c, i]));
  const ids = Array.from(macbeth, (c) => index.get(c)!);
  const n = Math.floor(ids.length * 0.9);
  const train = ids.slice(0, n);
  const val = ids.slice(n);
  const T = TINY_GPT.blockSize;
  const B = TINY_GPT_BATCH;
  const config = { ...TINY_GPT, vocabSize: vocab.length };
  const model = new GPT(config, { rng: new Rng(1) }).to(device);
  const opt = new AdamW(model.parameters(), { lr: 1e-2, weightDecay: 0 });
  const rng = new Rng(2);
  const batch = (source: number[], count: number, r: Rng): { x: Tensor; y: number[] } => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let b = 0; b < count; b++) {
      const s = r.int(source.length - T - 1);
      xs.push(...source.slice(s, s + T));
      ys.push(...source.slice(s + 1, s + T + 1));
    }
    return { x: new Tensor(Float32Array.from(xs), [count, T]), y: ys };
  };
  const valLoss = async (): Promise<number> => {
    const r = new Rng(7);
    let total = 0;
    for (let k = 0; k < 8; k++) {
      const { x, y } = batch(val, B, r);
      total += await noGrad(() => crossEntropy(model.forward(x), y)).itemAsync();
    }
    return total / 8;
  };
  const start = performance.now();
  let steps = 0;
  let loss = await valLoss();
  while (loss >= target && (performance.now() - start) / 1000 < maxSeconds) {
    for (let k = 0; k < 50; k++) {
      const { x, y } = batch(train, B, rng);
      const l = crossEntropy(model.forward(x), y);
      opt.zeroGrad();
      l.backward();
      opt.step();
      steps++;
    }
    loss = await valLoss();
  }
  return { device: model.device, steps, seconds: (performance.now() - start) / 1000, valLoss: loss, reached: loss < target };
}

async function adapterInfo(): Promise<Record<string, unknown> | null> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<{ info?: Record<string, unknown>; isFallbackAdapter?: boolean; limits: Record<string, number> } | null> } }).gpu;
  if (!gpu) return null;
  const a = await gpu.requestAdapter({ powerPreference });
  if (!a) return null;
  const info = a.info ?? {};
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    description: info.description,
    software: a.isFallbackAdapter ?? info.isFallbackAdapter ?? false,
    maxBufferSize: a.limits.maxBufferSize,
  };
}

async function main(report: Report): Promise<void> {
  report.adapter = await adapterInfo();
  const init = await initGpu({ allowFallbackAdapter: params.has('software'), powerPreference });
  report.device = init.device;
  report.message = init.message;
  section('Device', `<p><b>${init.device}</b> — ${init.message}</p><p>Adapter: ${JSON.stringify(report.adapter)}</p>`);
  if (init.device !== 'webgpu') return;

  report.compile = await compileAll();
  section('Kernel compilation', table(report.compile.filter((r) => !r.ok)) + `<p>${report.compile.filter((r) => r.ok).length} of ${report.compile.length} kernels compile.</p>`);

  const { backend } = await createBackend({ prefer: 'webgpu' });
  report.selfTest = (await selfTest(backend)).map((r) => ({ name: r.kernel, ok: r.ok, maxError: r.maxError }));
  section('Forward kernels (WebGpuBackend)', table(report.selfTest));

  report.training = (await trainingSelfTest()).map((r: GpuCheckRow) => ({ ...r }));
  section('GPU-resident training: forward + backward vs CPU', table(report.training));

  report.sandbox = await sandboxRun();
  section('Sandbox worker (player code, GPU auto)', table(report.sandbox));

  const now = (): number => performance.now();
  for (const device of ['cpu', 'webgpu'] as Device[]) report.benchmark.push(await benchmarkTraining({ device, now, steps: device === 'cpu' ? 10 : 50 }));
  const big = { ...TINY_GPT, dModel: 128, nHead: 4, nLayer: 4, blockSize: 64 };
  for (const device of ['cpu', 'webgpu'] as Device[])
    report.benchmark.push({ ...(await benchmarkTraining({ device, now, steps: device === 'cpu' ? 2 : 20, config: big, batch: 16 })), config: 'd128 L4 T64 B16' } as TrainingBenchmark);
  section('Training speed (tiny GPT d32 L1 T32 B8, then d128 L4 T64 B16)', table(report.benchmark));

  if (!params.has('quick')) {
    for (const device of ['webgpu', 'cpu'] as Device[]) report.timeToTarget.push(await timeToTarget(device, 2.8, 600));
    section('CNT-14: Macbeth, validation loss < 2.8', table(report.timeToTarget));
  }
}

const report: Report = { adapter: null, device: 'cpu', message: '', compile: [], selfTest: [], training: [], benchmark: [], timeToTarget: [], sandbox: [] };
main(report)
  .catch((e: unknown) => {
    report.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    out.insertAdjacentHTML('beforeend', `<pre class="bad">${report.error}</pre>`);
  })
  .finally(() => {
    (window as unknown as { __gpuCheck?: Report }).__gpuCheck = report;
    out.insertAdjacentHTML('beforeend', '<p id="done">Done.</p>');
  });
