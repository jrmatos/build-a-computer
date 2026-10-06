/**
 * Checks and benchmarks for GPU-resident training, shared by the unit tests
 * (on the emulated device) and the /gpu-check.html dev page (on a real GPU):
 *
 * - `trainingSelfTest()`: every differentiable op, forward and backward, on
 *   the GPU against the CPU (E-ML-02: within float32 tolerances, never exact),
 *   plus whole training steps of the Track 2 tiny GPT.
 * - `benchmarkTraining()`: tokens per second for that GPT on a device.
 *
 * Both need the shared GPU runtime (`initGpu()` or `setGpuRuntime()`).
 */
import { crossEntropy, GPT, LayerNorm, Linear, MultiHeadAttention, type GPTConfig } from '../nn';
import { AdamW, SGD } from '../optim';
import { Rng } from '../random';
import { concat, randint, randn, Tensor, triuMask, type Device } from '../tensor';
import { gpuRuntime } from './gpu-runtime';

/** The Track 2 tiny GPT (phase 6, train-tiny-gpt): one block, d_model 32, 4 heads, context 32. */
export const TINY_GPT: GPTConfig = { vocabSize: 68, blockSize: 32, dModel: 32, nHead: 4, nLayer: 1 };
/** Its batch size (windows per step). */
export const TINY_GPT_BATCH = 8;

/** One row of `trainingSelfTest`. */
export interface GpuCheckRow {
  name: string;
  ok: boolean;
  /** Largest |GPU - CPU| over the outputs and gradients compared. */
  maxError: number;
  detail?: string;
}

/** Largest absolute difference, and whether every pair is within atol + rtol * |want|. */
function compare(got: ArrayLike<number>, want: ArrayLike<number>, rtol: number, atol: number): { ok: boolean; maxError: number } {
  let ok = got.length === want.length;
  let maxError = 0;
  for (let i = 0; i < Math.min(got.length, want.length); i++) {
    const g = got[i]!;
    const w = want[i]!;
    if (g === w) continue;
    const err = Math.abs(g - w);
    if (!(err <= atol + rtol * Math.abs(w))) ok = false; // NaN fails too
    maxError = Math.max(maxError, Number.isNaN(err) ? Infinity : err);
  }
  return { ok, maxError };
}

/** Fixed weights 1, 1.5, ..., 4 (repeating) so a gradient sent to the wrong element shows. */
function weights(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 1 + (i % 7) * 0.5;
  return w;
}

/**
 * Runs `f` on CPU copies and GPU copies of `inputs`, backpropagates a fixed
 * weighted sum of the output, and compares outputs and input gradients.
 */
async function checkOp(
  name: string,
  inputs: Tensor[],
  f: (...x: Tensor[]) => Tensor,
  tol = { rtol: 2e-3, atol: 2e-4 },
): Promise<GpuCheckRow> {
  try {
    const cpuIn = inputs.map((t) => new Tensor(t.data.slice(), t.shape, true));
    const gpuIn = inputs.map((t) => {
      const g = new Tensor(t.data.slice(), t.shape).to('webgpu');
      g.requiresGrad = true;
      return g;
    });
    const outC = f(...cpuIn);
    outC.mul(new Tensor(weights(outC.size), outC.shape)).sum().backward();
    const outG = f(...gpuIn);
    if (outG.device !== 'webgpu') throw new Error('the result is not on the GPU');
    outG.mul(new Tensor(weights(outG.size), outG.shape).to('webgpu')).sum().backward();
    let { ok, maxError } = compare(await outG.read(), outC.data, tol.rtol, tol.atol);
    const details: string[] = ok ? [] : ['output'];
    for (let i = 0; i < inputs.length; i++) {
      const gc = cpuIn[i]!.grad;
      const gg = gpuIn[i]!.grad;
      if (!gc && !gg) continue;
      if (!gc || !gg) {
        ok = false;
        details.push(`grad ${i} missing`);
        continue;
      }
      if (gg.device !== 'webgpu') details.push(`grad ${i} left the GPU`);
      const r = compare(await gg.read(), gc.data, tol.rtol, tol.atol);
      if (!r.ok) details.push(`grad ${i}`);
      ok &&= r.ok;
      maxError = Math.max(maxError, r.maxError);
    }
    return { name, ok, maxError, ...(details.length ? { detail: `mismatch: ${details.join(', ')}` } : {}) };
  } catch (err) {
    return { name, ok: false, maxError: Infinity, detail: (err as Error).message };
  }
}

/** Every op the GPU path supports, forward and backward, compared with the CPU. */
export async function trainingSelfTest(seed = 1): Promise<GpuCheckRow[]> {
  if (!gpuRuntime()) throw new Error('trainingSelfTest needs a GPU runtime (initGpu()).');
  const rng = new Rng(seed);
  const r = (shape: number[], scale = 1): Tensor => {
    const t = randn(shape, { rng });
    return scale === 1 ? t : new Tensor(t.data.map((v) => v * scale), shape);
  };
  const pos = (shape: number[]): Tensor => new Tensor(r(shape).data.map((v) => Math.abs(v) + 0.5), shape);
  const ids = (n: number, high: number): number[] => Array.from(randint(0, high, [n], { rng }).data);
  const rows: GpuCheckRow[] = [];
  const add = async (row: Promise<GpuCheckRow>): Promise<void> => void rows.push(await row);

  const a = r([3, 5, 7]);
  const b = r([7]);
  await add(checkOp('add (broadcast)', [a, b], (x, y) => x.add(y)));
  await add(checkOp('sub (broadcast, middle axis)', [a, r([3, 1, 7])], (x, y) => x.sub(y)));
  await add(checkOp('mul', [a, r([3, 5, 7])], (x, y) => x.mul(y)));
  await add(checkOp('div', [a, pos([5, 1])], (x, y) => x.div(y)));
  await add(checkOp('maximum / minimum', [a, r([3, 5, 7])], (x, y) => x.maximum(y).add(x.minimum(y).mul(0.5))));
  await add(checkOp('scalar ops', [a], (x) => x.mul(3).add(1).sub(0.5).div(2).maximum(-0.25)));
  await add(checkOp('neg, abs, square', [a], (x) => x.neg().abs().add(x.square())));
  await add(checkOp('exp, log, sqrt', [pos([4, 9])], (x) => x.exp().add(x.log()).add(x.sqrt())));
  await add(checkOp('tanh, sigmoid', [r([4, 9], 3)], (x) => x.tanh().add(x.sigmoid())));
  await add(checkOp('relu, gelu', [r([4, 9], 2)], (x) => x.relu().add(x.gelu())));
  await add(checkOp('sin, cos, clamp', [r([4, 9], 2)], (x) => x.sin().add(x.cos()).add(x.clamp(-0.5, 0.7))));
  await add(checkOp('pow 3, pow 0.5', [pos([4, 9])], (x) => x.pow(3).add(x.pow(0.5))));
  await add(checkOp('sum, mean (axes)', [a], (x) => x.sum(1).sum(-1).add(x.mean(-1, false).sum(-1))));
  await add(checkOp('sum all', [a], (x) => x.sum()));
  await add(checkOp('max / min axis', [a], (x) => x.max(-1).add(x.min(0).sum(0, true).sum(-1, true).reshape([1]))));
  await add(checkOp('softmax', [r([6, 11], 3)], (x) => x.softmax(-1)));
  await add(checkOp('logSoftmax', [r([6, 11], 3)], (x) => x.logSoftmax(-1)));
  await add(checkOp('softmax (axis 0)', [r([6, 11], 3)], (x) => x.softmax(0)));
  await add(checkOp('matmul 2-D', [r([13, 17]), r([17, 9])], (x, y) => x.matmul(y), { rtol: 3e-3, atol: 5e-4 }));
  await add(checkOp('matmul batched @ weight', [r([3, 13, 17]), r([17, 9])], (x, y) => x.matmul(y), { rtol: 3e-3, atol: 5e-4 }));
  await add(checkOp('matmul batched @ batched', [r([2, 3, 5, 6]), r([2, 3, 6, 4])], (x, y) => x.matmul(y), { rtol: 3e-3, atol: 5e-4 }));
  await add(checkOp('matmul broadcast batch', [r([2, 1, 5, 6]), r([1, 3, 6, 4])], (x, y) => x.matmul(y), { rtol: 3e-3, atol: 5e-4 }));
  await add(checkOp('matmul 40x70 @ 70x33', [r([40, 70]), r([70, 33])], (x, y) => x.matmul(y), { rtol: 3e-3, atol: 1e-3 }));
  await add(checkOp('matmul vector', [r([6]), r([6, 4])], (x, y) => x.matmul(y)));
  await add(checkOp('transpose / permute', [r([2, 3, 4, 5])], (x) => x.permute(0, 2, 1, 3).transpose().reshape([2, 4, 15])));
  await add(checkOp('expand', [r([3, 1, 5])], (x) => x.expandTo([2, 3, 4, 5])));
  await add(checkOp('slice', [r([4, 9, 3])], (x) => x.slice(1, 2, 7)));
  await add(checkOp('concat', [r([2, 3, 4]), r([2, 5, 4])], (x, y) => concat([x, y], 1)));
  const tokenIds = ids(24, 10);
  await add(checkOp('indexSelect (embedding, repeated ids)', [r([10, 6])], (w) => w.indexSelect(0, tokenIds)));
  const targets = new Tensor(Float32Array.from(ids(8, 5)), [8, 1]);
  await add(checkOp('gather', [r([8, 5])], (x) => x.gather(1, targets)));
  await add(checkOp('maskedFill + softmax (causal)', [r([2, 6, 6])], (x) => x.maskedFill(triuMask(6), -Infinity).softmax(-1)));
  const classes = ids(12, 9);
  await add(checkOp('crossEntropy (fused)', [r([12, 9], 2)], (x) => crossEntropy(x, classes)));
  {
    const ln = new LayerNorm(16);
    ln.gamma = new Tensor(r([16]).data, [16], true);
    ln.beta = new Tensor(r([16]).data, [16], true);
    await add(checkOp('LayerNorm (fused)', [r([5, 16], 2), ln.gamma.detach(), ln.beta.detach()], (x, g, bt) => {
      ln.gamma = g!;
      ln.beta = bt!;
      return ln.forward(x!);
    }));
  }
  {
    const lin = new Linear(8, 6, { rng: new Rng(seed + 3) });
    await add(checkOp('Linear', [r([4, 3, 8]), lin.weight.detach(), lin.bias!.detach()], (x, w, bias) => x!.matmul(w!).add(bias!)));
  }
  {
    // Attention on CPU and GPU copies of one layer.
    const make = (): MultiHeadAttention => new MultiHeadAttention(16, 4, { rng: new Rng(seed + 5) });
    const cpuLayer = make();
    const gpuLayer = make().to('webgpu');
    await add(checkOp('MultiHeadAttention (input grad)', [r([2, 7, 16])], (x) => (x!.device === 'webgpu' ? gpuLayer : cpuLayer).forward(x!), { rtol: 3e-3, atol: 5e-4 }));
  }
  rows.push(...(await trainingStepCheck(seed)));
  return rows;
}

/** Random token windows (inputs and next-token targets) for the GPT. */
function batchOf(rng: Rng, config: GPTConfig, batch: number): { x: Tensor; y: number[] } {
  const x = randint(0, config.vocabSize, [batch, config.blockSize], { rng });
  const y = Array.from(randint(0, config.vocabSize, [batch * config.blockSize], { rng }).data);
  return { x, y };
}

/**
 * Whole training steps of the tiny GPT (forward, backward, AdamW) on the CPU
 * and the GPU from the same seed: losses must agree step by step and the
 * parameters must stay close (Adam amplifies float noise in near-zero
 * gradients, so parameters get a looser bound than losses).
 */
async function trainingStepCheck(seed: number, steps = 3): Promise<GpuCheckRow[]> {
  try {
    const cpu = new GPT(TINY_GPT, { rng: new Rng(seed) });
    const gpu = new GPT(TINY_GPT, { rng: new Rng(seed) }).to('webgpu');
    const optC = new AdamW(cpu.parameters(), { lr: 1e-2 });
    const optG = new AdamW(gpu.parameters(), { lr: 1e-2 });
    const data = new Rng(seed + 100);
    let lossError = 0;
    let lossOk = true;
    for (let s = 0; s < steps; s++) {
      const { x, y } = batchOf(data, TINY_GPT, TINY_GPT_BATCH);
      const lc = crossEntropy(cpu.forward(x), y);
      optC.zeroGrad();
      lc.backward();
      optC.step();
      const lg = crossEntropy(gpu.forward(x), y);
      optG.zeroGrad();
      lg.backward();
      optG.step();
      const r = compare([await lg.itemAsync()], [lc.item()], 1e-3, 1e-4);
      lossOk &&= r.ok;
      lossError = Math.max(lossError, r.maxError);
    }
    let paramError = 0;
    let paramOk = true;
    const gp = gpu.namedParameters();
    for (const [i, [, p]] of cpu.namedParameters().entries()) {
      const r = compare(await gp[i]![1].read(), p.data, 0, 2e-3 * steps);
      paramOk &&= r.ok;
      paramError = Math.max(paramError, r.maxError);
    }
    return [
      { name: `tiny GPT: ${steps} AdamW steps, loss per step`, ok: lossOk, maxError: lossError },
      { name: `tiny GPT: ${steps} AdamW steps, parameters`, ok: paramOk, maxError: paramError },
      await sgdCheck(seed),
    ];
  } catch (err) {
    return [{ name: 'tiny GPT training steps', ok: false, maxError: Infinity, detail: (err as Error).message }];
  }
}

async function sgdCheck(seed: number): Promise<GpuCheckRow> {
  const make = (): Linear => new Linear(5, 3, { rng: new Rng(seed + 9) });
  const cpu = make();
  const gpu = make().to('webgpu');
  const oc = new SGD(cpu.parameters(), { lr: 0.1, momentum: 0.9, weightDecay: 0.01 });
  const og = new SGD(gpu.parameters(), { lr: 0.1, momentum: 0.9, weightDecay: 0.01 });
  const x = randn([4, 5], { rng: new Rng(seed + 10) });
  for (let s = 0; s < 3; s++) {
    oc.zeroGrad();
    cpu.forward(x).square().mean().backward();
    oc.step();
    og.zeroGrad();
    gpu.forward(x).square().mean().backward();
    og.step();
  }
  const r = compare(await gpu.weight.read(), cpu.weight.data, 1e-3, 1e-5);
  return { name: 'SGD with momentum, 3 steps', ...r };
}

/** Result of `benchmarkTraining`. */
export interface TrainingBenchmark {
  device: Device;
  steps: number;
  msPerStep: number;
  tokensPerSecond: number;
  firstLoss: number;
  lastLoss: number;
}

/**
 * Times `steps` training steps (forward, backward, AdamW) of a GPT on random
 * tokens, after one warm-up step. `now` is a millisecond clock (the package
 * itself has no clock access).
 */
export async function benchmarkTraining(options: {
  device: Device;
  now: () => number;
  steps?: number;
  config?: GPTConfig;
  batch?: number;
  seed?: number;
}): Promise<TrainingBenchmark> {
  const config = options.config ?? TINY_GPT;
  const batch = options.batch ?? TINY_GPT_BATCH;
  const steps = options.steps ?? 20;
  const model = new GPT(config, { rng: new Rng(options.seed ?? 1) }).to(options.device);
  const opt = new AdamW(model.parameters(), { lr: 3e-3 });
  const data = new Rng((options.seed ?? 1) + 1);
  const step = (): Tensor => {
    const { x, y } = batchOf(data, config, batch);
    const loss = crossEntropy(model.forward(x), y);
    opt.zeroGrad();
    loss.backward();
    opt.step();
    return loss;
  };
  const firstLoss = await step().itemAsync(); // warm-up: compiles the kernels
  const start = options.now();
  let loss: Tensor | null = null;
  for (let s = 0; s < steps; s++) loss = step();
  const lastLoss = loss ? await loss.itemAsync() : firstLoss; // waits for the GPU to finish
  const ms = options.now() - start;
  return {
    device: model.device,
    steps,
    msPerStep: ms / steps,
    tokensPerSecond: (steps * batch * config.blockSize * 1000) / ms,
    firstLoss,
    lastLoss,
  };
}
