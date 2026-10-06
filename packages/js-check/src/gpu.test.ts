import { describe, expect, it } from 'vitest';
import { Level } from '@build-a-computer/schema';
import { startJs } from './index';
import type { DeviceInfo, GpuMode, MlSample } from './protocol';

const level = (js: Record<string, unknown> = {}): Level =>
  Level.parse({
    id: 'js-gpu',
    version: 1,
    track: 'sandbox',
    phase: 0,
    order: 0,
    title: 'T',
    goal: 'g',
    palette: [],
    starter: { parts: [], wires: [] },
    tests: [],
    mode: 'js',
    js: { modules: ['tensor', 'nn', 'optim'], training: true, ...js },
  });

async function run(source: string, gpu: GpuMode, args: unknown[] = []) {
  const samples: MlSample[] = [];
  const devices: DeviceInfo[] = [];
  const checkpoints: { state: unknown; step: number }[] = [];
  const out = await startJs(
    { source, level: level(), entry: 'main', args, gpu, timeoutMs: 60_000 },
    {
      onSamples: (s) => samples.push(...s),
      onDevice: (d) => devices.push(d),
      onCheckpoint: (state, step) => checkpoints.push({ state, step }),
    },
  ).done;
  return { out, samples, devices, checkpoints };
}

// A Track 2 style training loop on the nn GPT: the model moves to the GPU
// with to('auto'); report() and checkpoint() take GPU tensors directly.
const TRAIN = `
import { GPT, crossEntropy } from 'nn';
import { AdamW, assertFinite } from 'optim';
import { randint } from 'tensor';

export async function main(steps, lr = 0.01) {
  const model = new GPT({ vocabSize: 12, blockSize: 8, dModel: 16, nHead: 2, nLayer: 1 }).to('auto');
  const opt = new AdamW(model.parameters(), { lr });
  let loss;
  for (let step = 0; step < steps; step++) {
    const x = randint(0, 12, [4, 8]);
    const y = Array.from(x.data, (v) => (v + 1) % 12); // learn "next id"
    loss = crossEntropy(model.forward(x), y);
    assertFinite(loss, { step, lr });
    opt.zeroGrad();
    loss.backward();
    opt.step();
    report({ loss });
    if (step === steps - 1) checkpoint({ step, params: model.parameters() });
  }
  return { device: model.device, loss, last: await loss.itemAsync() };
}
`;

describe('GPU-resident training in the sandbox (emulated GPU)', () => {
  it('E-ML-01: trains on the GPU, reports and checkpoints GPU tensors, returns a GPU tensor', async () => {
    const { out, samples, devices, checkpoints } = await run(TRAIN, 'emulated', [12]);
    expect(out.error, JSON.stringify(out.error)).toBeUndefined();
    const result = out.result as { device: string; loss: { shape: number[]; data: number[] }; last: number };
    expect(result.device).toBe('webgpu');
    expect(result.loss.shape).toEqual([]);
    expect(result.loss.data[0]).toBeCloseTo(result.last, 6);
    expect(samples.map((s) => s.step)).toEqual([...Array(12).keys()]);
    expect(samples.every((s) => Number.isFinite(s.values.loss))).toBe(true);
    expect(samples.at(-1)!.values.loss).toBeLessThan(samples[0]!.values.loss!);
    expect(devices[0]).toMatchObject({ available: 'webgpu', used: false });
    expect(devices.at(-1)).toMatchObject({ available: 'webgpu', used: true });
    expect(checkpoints).toHaveLength(1);
    const saved = checkpoints[0]!.state as { params: { $tensor: 1; data: number[] }[] };
    expect(saved.params.length).toBeGreaterThan(5);
    expect(saved.params.every((p) => p.$tensor === 1 && p.data.every(Number.isFinite))).toBe(true);
  });

  it('the same seed gives the same losses on the CPU and the GPU (E-ML-02 tolerance)', async () => {
    const gpu = await run(TRAIN, 'emulated', [5]);
    const cpu = await run(TRAIN, 'off', [5]);
    expect((cpu.out.result as { device: string }).device).toBe('cpu');
    expect(cpu.devices).toEqual([]);
    const a = gpu.samples.map((s) => s.values.loss!);
    const b = cpu.samples.map((s) => s.values.loss!);
    expect(a).toHaveLength(5);
    a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(1e-3));
  });

  it('E-ML-03: a loss that explodes on the GPU stops training with a NaN error', async () => {
    const { out } = await run(TRAIN, 'emulated', [40, 1e6]);
    expect(out.ok).toBe(false);
    expect(out.error?.kind).toBe('nan');
  });

  it('reading a GPU tensor synchronously explains how to read it', async () => {
    const { out } = await run(
      `import { tensor } from 'tensor';
export function main() { return tensor([1, 2]).to('auto').mul(2).sum().item(); }`,
      'emulated',
    );
    expect(out.ok).toBe(false);
    expect(out.error?.message).toMatch(/lives on the GPU.*await t\.read\(\)/);
  });
});
