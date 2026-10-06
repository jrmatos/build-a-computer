import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crossEntropy, GPT, Linear, type GPTConfig } from '../nn';
import { AdamW, assertFinite, clipGradNorm, flushFiniteChecks, NonFiniteError } from '../optim';
import { Rng } from '../random';
import { DeviceReadError, randint, randn, tensor, Tensor } from '../tensor';
import { allKernels, kernelName } from './gpu-kernels';
import { emulatedDevice, emulatedGpu } from './gpu-emulator';
import {
  autoDevice,
  FreedTensorError,
  GpuDeviceLostError,
  GpuRuntime,
  gpuRuntime,
  initGpu,
  setGpuRuntime,
} from './gpu-runtime';
import { benchmarkTraining, TINY_GPT, trainingSelfTest } from './gpu-selftest';
import { readLimits, type GpuLike } from './webgpu';
import { GpuLimitError } from './wgsl';

let emu: ReturnType<typeof emulatedDevice>;
let rt: GpuRuntime;
function install(limits = {}): void {
  emu = emulatedDevice(limits);
  rt = new GpuRuntime(emu.device, readLimits(emu.device.limits));
  setGpuRuntime(rt);
}
beforeEach(() => install());
afterEach(() => setGpuRuntime(null));

/** Lets pending promise callbacks (device loss, background reads) run. */
async function ticks(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

const SMALL: GPTConfig = { vocabSize: 11, blockSize: 6, dModel: 8, nHead: 2, nLayer: 1 };

function trainSteps(model: GPT, opt: AdamW, steps: number, rng: Rng): Tensor {
  let loss: Tensor | null = null;
  for (let s = 0; s < steps; s++) {
    const x = randint(0, SMALL.vocabSize, [3, SMALL.blockSize], { rng });
    const y = Array.from(randint(0, SMALL.vocabSize, [3 * SMALL.blockSize], { rng }).data);
    loss = crossEntropy(model.forward(x), y);
    opt.zeroGrad();
    loss.backward();
    opt.step();
  }
  return loss!;
}

describe('WGSL kernels for GPU training', () => {
  // WGSL keywords and reserved words the generated code could plausibly use as names.
  const RESERVED = ['meta', 'from', 'target', 'set', 'get', 'type', 'filter', 'mod', 'match', 'pass', 'of', 'new', 'this', 'self', 'where', 'module', 'common', 'final', 'macro', 'static', 'std', 'use', 'using', 'null', 'NULL', 'buffer', 'texture', 'sampler', 'enable', 'loop', 'switch', 'default', 'case', 'output', 'input', 'resource', 'layout', 'shared', 'precision', 'attribute', 'varying', 'uniform'];

  it('kernels are balanced, named and never use a reserved word as a name', () => {
    const all = allKernels(16);
    expect(new Set(all.map(kernelName)).size).toBe(all.length);
    for (const code of all) {
      for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']] as const)
        expect(code.split(open).length, kernelName(code)).toBe(code.split(close).length);
      expect(code.match(/fn main\(/g)).toHaveLength(1);
      expect(code).not.toMatch(/undefined|NaN|Infinity/);
      const names = [...code.matchAll(/\b(?:let|var|fn|const)\s+([A-Za-z_]\w*)|var<[^>]+>\s+([A-Za-z_]\w*)/g)].map((m) => m[1] ?? m[2]);
      for (const name of names) expect(RESERVED, `${kernelName(code)}: ${name}`).not.toContain(name);
      // WGSL rejects NaN/Inf constants: they must be built at run time.
      expect(code).not.toMatch(/bitcast<f32>\(0x7f[c8]00000u\)/);
    }
  });

  it('every binding of every kernel is read (layout: auto drops unused ones)', () => {
    for (const code of allKernels(8)) {
      const declared = [...code.matchAll(/var<storage, [a-z_]+> (\w+):/g)].map((m) => m[1]!);
      const body = code.slice(code.indexOf('fn main'));
      const helpers = code.slice(0, code.indexOf('fn main'));
      for (const name of declared) {
        const used = new RegExp(`\\b${name}\\[`).test(body) || new RegExp(`\\b${name}\\[`).test(helpers.replace(/var<[^\n]+\n/g, ''));
        expect(used, `${kernelName(code)} binding ${name}`).toBe(true);
      }
    }
  });
});

describe('GPU-resident tensors on the emulated device', () => {
  it('E-ML-02: every op matches the CPU, forward and backward, and training steps agree', async () => {
    const rows = await trainingSelfTest();
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect(rows.length).toBeGreaterThan(30);
  });

  it('a training step runs without reading anything back, in a few submits', async () => {
    const model = new GPT(SMALL, { rng: new Rng(1) }).to('webgpu');
    const opt = new AdamW(model.parameters(), { lr: 1e-2 });
    trainSteps(model, opt, 1, new Rng(2)); // warm-up
    const before = { ...rt.stats };
    const loss = trainSteps(model, opt, 3, new Rng(3));
    expect(rt.stats.reads).toBe(before.reads);
    const dispatches = rt.stats.dispatches - before.dispatches;
    expect(dispatches).toBeGreaterThan(100);
    // Uploads (token ids, masks) flush recorded work; kernels themselves never submit one by one.
    expect(rt.stats.flushes - before.flushes).toBeLessThan(dispatches / 5);
    expect(model.parameters().every((p) => p.device === 'webgpu' && p.grad?.device === 'webgpu')).toBe(true);
    expect(Number.isFinite(await loss.itemAsync())).toBe(true);
  });

  it('GPU memory is recycled every step: buffers stop growing after warm-up', () => {
    const model = new GPT(SMALL, { rng: new Rng(1) }).to('webgpu');
    const opt = new AdamW(model.parameters(), { lr: 1e-2 });
    trainSteps(model, opt, 3, new Rng(2));
    const created = rt.stats.buffersCreated;
    const live = rt.stats.liveArenaStorages;
    trainSteps(model, opt, 10, new Rng(3));
    expect(rt.stats.buffersCreated - created).toBeLessThan(20); // param buffers for uploads only
    expect(rt.stats.liveArenaStorages).toBeLessThanOrEqual(live + 5);
  });

  it('a GPU result unused for a whole step is freed, loudly; keep() holds it', () => {
    const model = new GPT(SMALL, { rng: new Rng(1) }).to('webgpu');
    const opt = new AdamW(model.parameters(), { lr: 1e-2 });
    const x = randint(0, SMALL.vocabSize, [1, 4], { rng: new Rng(5) });
    const scratch = model.forward(x);
    const kept = model.forward(x).keep();
    trainSteps(model, opt, 2, new Rng(2));
    expect(() => scratch.mul(2)).toThrow(FreedTensorError);
    expect(() => kept.mul(2)).not.toThrow();
  });

  it('reading a GPU tensor: sync reads explain themselves, async reads cache the values', async () => {
    const t = tensor([1, 2, 3]).to('webgpu').mul(2);
    expect(t.device).toBe('webgpu');
    expect(() => t.sum().item()).toThrow(DeviceReadError);
    expect(() => t.data).toThrow(/await t\.read\(\)/);
    expect(String(t)).toMatch(/webgpu.*await t\.read\(\)/);
    expect(Array.from(await t.read())).toEqual([2, 4, 6]);
    expect(t.toArray()).toEqual([2, 4, 6]);
    expect(await t.sum().itemAsync()).toBe(12);
    const back = await t.cpu();
    expect(back.device).toBe('cpu');
    expect(back.toArray()).toEqual([2, 4, 6]);
  });

  it('checkpoints: state dicts read back from the GPU and load into GPU models', async () => {
    const model = new GPT(SMALL, { rng: new Rng(1) }).to('webgpu');
    const opt = new AdamW(model.parameters(), { lr: 1e-2 });
    trainSteps(model, opt, 2, new Rng(2));
    expect(() => model.stateDict()).toThrow(/readStateDict/);
    expect(() => opt.stateDict()).toThrow(/readStateDict/);
    const state = await model.readStateDict();
    const optState = await opt.readStateDict();
    expect(optState.stepCount).toBe(2);
    expect(optState.buffers.m!.some((b) => b.some((v) => v !== 0))).toBe(true);

    const restored = new GPT(SMALL, { rng: new Rng(99) }).to('webgpu');
    restored.loadStateDict(state);
    const ropt = new AdamW(restored.parameters(), { lr: 1e-2 });
    trainSteps(restored, ropt, 1, new Rng(7)); // creates GPU optimizer buffers
    ropt.loadStateDict(optState);
    const cpu = new GPT(SMALL, { rng: new Rng(99) });
    cpu.loadStateDict(state);
    const copt = new AdamW(cpu.parameters(), { lr: 1e-2 });
    copt.loadStateDict(optState);
    restored.loadStateDict(state);
    const a = await trainSteps(restored, ropt, 2, new Rng(4)).itemAsync();
    const b = trainSteps(cpu, copt, 2, new Rng(4)).item();
    expect(Math.abs(a - b)).toBeLessThan(1e-4);
  });

  it('clipGradNorm on the GPU matches the CPU and returns the norm as a GPU tensor', async () => {
    const make = (): Linear => new Linear(6, 4, { rng: new Rng(3) });
    const cpu = make();
    const gpu = make().to('webgpu');
    const x = randn([5, 6], { rng: new Rng(4) }).mul(10);
    cpu.forward(x).square().sum().backward();
    gpu.forward(x).square().sum().backward();
    const nc = clipGradNorm(cpu.parameters(), 1) as number;
    const ng = clipGradNorm(gpu.parameters(), 1) as Tensor;
    expect(ng).toBeInstanceOf(Tensor);
    expect(Math.abs((await ng.itemAsync()) - nc) / nc).toBeLessThan(1e-4);
    const g = await gpu.weight.grad!.read();
    cpu.weight.grad!.data.forEach((v, i) => expect(Math.abs(v - g[i]!)).toBeLessThan(1e-5));
  });

  it('E-ML-03: assertFinite on a GPU loss checks in the background and throws on a later call', async () => {
    const bad = tensor([1]).to('webgpu').div(0).sub(tensor([1]).to('webgpu').div(0)); // NaN
    assertFinite(bad, { step: 3, lr: 0.5 }); // does not wait
    await expect(flushFiniteChecks()).rejects.toThrow(NonFiniteError);
    assertFinite(bad, { step: 4, lr: 0.5 });
    await ticks();
    expect(() => assertFinite(tensor([1]).to('webgpu'))).toThrow(/learning rate 0.5/);
    await flushFiniteChecks();
  });

  it('E-ML-05: float64 stays on the CPU', () => {
    const lin = new Linear(3, 2, { dtype: 'float64' }).to('auto');
    expect(lin.device).toBe('cpu');
    expect(() => tensor([1, 2], { dtype: 'float64' }).to('webgpu')).toThrow(/float64/);
    expect(() => tensor([1, 2]).to('webgpu').add(tensor([1, 2], { dtype: 'float64' }))).toThrow(/float64/);
  });

  it('E-ML-04: a model larger than the GPU buffer limit stays on the CPU with to("auto")', () => {
    setGpuRuntime(null);
    install({ maxStorageBufferBindingSize: 256 });
    const big = new GPT({ ...SMALL, vocabSize: 40 }, { rng: new Rng(1) });
    expect(() => new GPT({ ...SMALL, vocabSize: 40 }).to('webgpu')).toThrow(GpuLimitError);
    big.to('auto');
    expect(big.device).toBe('cpu');
    expect(big.parameters().every((p) => p.device === 'cpu')).toBe(true);
    expect(Number.isFinite(crossEntropy(big.forward([1, 2, 3]), [2, 3, 4]).item())).toBe(true);
  });

  it('E-ML-01: after a device loss GPU tensors fail with advice and auto picks the CPU', async () => {
    const t = tensor([1, 2]).to('webgpu');
    emu.lose('driver reset');
    await ticks();
    expect(() => t.mul(2)).toThrow(GpuDeviceLostError);
    expect(() => t.mul(2)).toThrow(/checkpoint/);
    expect(gpuRuntime()).toBeNull();
    expect(autoDevice()).toBe('cpu');
    expect(new Linear(2, 2).to('auto').device).toBe('cpu');
  });
});

describe('initGpu', () => {
  it('E-ML-01: no WebGPU means the CPU, with a reason', async () => {
    setGpuRuntime(null);
    expect(await initGpu({ gpu: null })).toMatchObject({ device: 'cpu', message: expect.stringMatching(/no WebGPU support/) });
    expect(autoDevice()).toBe('cpu');
  });

  it('connects to a GPU, and refuses a software adapter unless allowed', async () => {
    setGpuRuntime(null);
    expect((await initGpu({ gpu: emulatedGpu() })).device).toBe('webgpu');
    expect(autoDevice()).toBe('webgpu');
    setGpuRuntime(null);
    const software: GpuLike = {
      requestAdapter: async () => {
        const adapter = (await emulatedGpu().requestAdapter())!;
        return { limits: adapter.limits, requestDevice: adapter.requestDevice, isFallbackAdapter: true };
      },
    };
    expect(await initGpu({ gpu: software })).toMatchObject({ device: 'cpu', message: expect.stringMatching(/software adapter/) });
    expect((await initGpu({ gpu: software, allowFallbackAdapter: true })).device).toBe('webgpu');
  });
});

describe('benchmark harness', () => {
  it('reports tokens per second on both devices', async () => {
    let clock = 0;
    const now = (): number => (clock += 5);
    for (const device of ['cpu', 'webgpu'] as const) {
      const b = await benchmarkTraining({ device, now, steps: 2, config: { ...TINY_GPT, blockSize: 8 }, batch: 2 });
      expect(b.device).toBe(device);
      expect(b.tokensPerSecond).toBeGreaterThan(0);
      expect(Number.isFinite(b.lastLoss)).toBe(true);
    }
  });
});
