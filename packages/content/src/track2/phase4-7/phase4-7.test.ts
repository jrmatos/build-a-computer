import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { judgeJs, runJsTest, startJs, type DatasetProvider, type DeviceInfo, type GpuMode } from '@build-a-computer/js-check';
import { Level } from '@build-a-computer/schema';
import { DATASETS, datasetById } from '../../../datasets';
import { TRACK2_P4_7_SOLUTIONS } from '../../../solutions/track2/phase4-7';
import { TRACK2_P1_3_LEVELS } from '../phase1-3';
import { MACBETH_VOCAB_SIZE, PHASE3_LAST_ID, type JsTest } from './common';
import { TRACK2_P4_7_LEVELS } from './index';
import { PREF_TEST, PREF_TRAIN } from './phase7';
import { buildVocab, fitPowerLaw, pairLoss, sampleNext, softmax, trainBpe, trainRewardModel, uGrid, dot } from './models';

const levels = TRACK2_P4_7_LEVELS;
const ids = levels.map((l) => l.id);
const jsTests = (l: Level): JsTest[] => l.tests.filter((t): t is JsTest => t.kind === 'js');
const datasets: DatasetProvider = (id) => datasetById(id);
const text = (file: string): string => readFileSync(new URL(`../../../datasets/text/${file}`, import.meta.url), 'utf8');

/** Runs one test of `l` on `source` through the real sandbox. */
const run = (source: string, t: JsTest, l: Level) => runJsTest(source, t, l, { datasets });

/** Runs `entry(...args)` of `source` in the sandbox of level `l` with a GPU mode; returns the outcome and device reports. */
async function runOn(gpu: GpuMode, source: string, l: Level, entry: string, args: unknown[], timeoutMs = 300_000) {
  const devices: DeviceInfo[] = [];
  const out = await startJs({ source, level: l, entry, args, gpu, seed: 1, timeoutMs }, { datasets, onDevice: (d) => devices.push(d) }).done;
  return { out, devices, usedGpu: devices.some((d) => d.used) };
}
const level = (id: string): Level => levels.find((l) => l.id === id)!;

/** Levels whose training runs on the tensor modules (on the GPU when there is one). */
const GPU_LEVELS = ['train-tiny-gpt', 'loss-perplexity', 'fine-tuning', 'lora', 'scaling-experiment'];

describe('Track 2, phases 4 to 7', () => {
  it('are 18 valid draft js levels in play order', () => {
    expect(levels.length).toBe(18);
    expect(new Set(ids).size).toBe(18);
    const counts = [4, 5, 6, 7].map((p) => levels.filter((l) => l.phase === p).length);
    expect(counts).toEqual([4, 6, 4, 4]);
    for (const p of [4, 5, 6, 7]) expect(levels.filter((l) => l.phase === p).map((l) => l.order)).toEqual(levels.filter((l) => l.phase === p).map((_, i) => i + 1));
    for (const l of levels) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.track, l.id).toBe('neuron-to-llm');
      expect(l.draft, l.id).toBe(true);
      expect(l.mode, l.id).toBe('js');
      expect(l.js?.starter.length, l.id).toBeGreaterThan(0);
      expect(l.goal.length, l.id).toBeGreaterThan(0);
      expect(l.tutorial, l.id).toContain('```js');
      expect(l.hints.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.hints.length, l.id).toBeLessThanOrEqual(5);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
      expect(jsTests(l).length, l.id).toBeGreaterThanOrEqual(2);
      expect(TRACK2_P4_7_SOLUTIONS[l.id], l.id).toBeDefined();
    }
  });

  it(`start after the last Phase 3 level ('${PHASE3_LAST_ID}') and form a chain`, () => {
    expect(TRACK2_P1_3_LEVELS.at(-1)?.id).toBe(PHASE3_LAST_ID);
    expect(levels[0]!.requires).toEqual([PHASE3_LAST_ID]);
    for (let i = 1; i < levels.length; i++) expect(levels[i]!.requires).toEqual([ids[i - 1]]);
  });

  it('training tests are seeded, bounded by metrics, and give the sandbox enough time', () => {
    for (const l of levels.filter((x) => x.js?.training)) {
      const metrics = jsTests(l).filter((t) => t.metric);
      expect(metrics.length, l.id).toBeGreaterThan(0);
      for (const t of metrics) {
        expect(t.metric!.min !== undefined || t.metric!.max !== undefined, `${l.id}: ${t.name}`).toBe(true);
        expect(t.timeoutMs, `${l.id}: ${t.name}`).toBeGreaterThanOrEqual(30_000);
      }
    }
  });

  it('E-ML-07: every dataset a level loads is registered with a license record', () => {
    const licenses = readFileSync(new URL('../../../datasets/LICENSES.md', import.meta.url), 'utf8');
    for (const l of levels)
      for (const id of l.js?.datasets ?? []) {
        expect(DATASETS[id], `${l.id}: ${id}`).toBeDefined();
        expect(DATASETS[id]!.meta.license).toMatch(/public domain/i);
        expect(licenses, id).toContain(`\`${id}\``);
        expect(licenses, id).toContain(DATASETS[id]!.meta.source);
      }
  });

  it('E-ML-07: the text datasets are small, ASCII, and free of the Project Gutenberg header and footer', async () => {
    for (const [id, file] of [
      ['text-macbeth', 'macbeth.txt'],
      ['text-sonnets', 'sonnets.txt'],
    ] as const) {
      const t = text(file);
      expect(statSync(new URL(`../../../datasets/text/${file}`, import.meta.url)).size).toBeLessThanOrEqual(1_000_000);
      expect(DATASETS[id]!.meta.sizeBytes).toBe(t.length);
      expect(t).not.toMatch(/project gutenberg|\*\*\* (START|END)/i);
      expect(/^[\n\x20-\x7e]*$/.test(t), id).toBe(true);
      expect(await DATASETS[id]!.load()).toBe(t);
    }
    const vocab = buildVocab(text('macbeth.txt'));
    expect(vocab.length).toBe(MACBETH_VOCAB_SIZE);
    for (const c of new Set(text('sonnets.txt'))) expect(vocab).toContain(c);
  });

  it('models: BPE follows the worked example of the tutorial', () => {
    const [a, b] = ['a', 'b'].map((x) => x.charCodeAt(0));
    expect(trainBpe('aaabdaaabac', 3)).toEqual([
      [a, a],
      [256, a],
      [257, b],
    ]);
    expect(trainBpe('abcd', 5)).toEqual([]);
  });

  it('models: sampling properties (temperature 0 is greedy, top-k stays in the top k)', () => {
    const logits = [2, 1.5, 0.3, -1, 1.5, 0.9, -0.2, 3];
    for (const u of uGrid(50)) expect(sampleNext(logits, { temperature: 0 }, u)).toBe(7);
    const p = softmax(logits);
    const top3 = p.map((_, i) => i).sort((x, y) => p[y]! - p[x]! || x - y).slice(0, 3);
    const picked = new Set(uGrid(200).map((u) => sampleNext(logits, { temperature: 1, topK: 3 }, u)));
    expect([...picked].every((i) => top3.includes(i))).toBe(true);
    expect(picked.size).toBe(3);
    expect(new Set(uGrid(200).map((u) => sampleNext(logits, { topK: 1 }, u)))).toEqual(new Set([7]));
  });

  it('models: the preference data is learnable but noisy, and the power-law fit is exact on a power law', () => {
    const w = trainRewardModel(PREF_TRAIN, 300, 0.5);
    const acc = PREF_TEST.filter((q) => dot(w, q.chosen) > dot(w, q.rejected)).length / PREF_TEST.length;
    expect(acc).toBeGreaterThanOrEqual(0.88);
    expect(acc).toBeLessThan(1);
    expect(PREF_TEST.reduce((s, q) => s + pairLoss(w, q.chosen, q.rejected), 0) / PREF_TEST.length).toBeLessThan(0.4);
    const f = fitPowerLaw([10, 100, 1000], [10, 100, 1000].map((n) => 2 * n ** -0.5));
    expect(f.b).toBeCloseTo(-0.5, 12);
    expect(Math.exp(f.a)).toBeCloseTo(2, 10);
  });

  it('training levels unlock the tensor modules gpt.js and the reference solutions import', () => {
    for (const id of GPU_LEVELS) {
      const l = level(id);
      expect(l.js?.training, id).toBe(true);
      for (const m of ['tensor', 'autograd', 'nn', 'optim'] as const) expect(l.js?.modules, `${id}: ${m}`).toContain(m);
    }
  });

  it('gpt.js: batches are [B, T] tensors, evalLoss uses fixed windows, cloneModel copies exactly, nextLogits has one logit per token', async () => {
    const src = `
import { charVocab, cloneModel, createGPT, decodeChars, encodeChars, evalLoss, nextLogits, numParams, randomBatch, rng } from './gpt.js';
export async function main() {
  const vocab = charVocab('to be or not to be');
  const ids = encodeChars(vocab, 'to be or not to be, that is the question'.replace(/[^tobe rn]/g, ''));
  const model = createGPT({ vocabSize: vocab.length, blockSize: 8, dModel: 16, nHead: 2, nLayer: 1, seed: 3 });
  const { x, y } = randomBatch(ids, 3, 8, rng(1));
  const a = await evalLoss(model, ids, 8, 2, 2);
  const copy = await cloneModel(model);
  return {
    shape: x.shape, ys: y.length,
    same: a === (await evalLoss(model, ids, 8, 2, 2)), cloned: a - (await evalLoss(copy, ids, 8, 2, 2)),
    logits: (await nextLogits(model, ids.slice(0, 20))).length, params: numParams(model), round: decodeChars(vocab, ids.slice(0, 5)),
  };
}`;
    const { out } = await runOn('off', src, level('train-tiny-gpt'), 'main', []);
    expect(out.error, JSON.stringify(out.error)).toBeUndefined();
    expect(out.result).toMatchObject({ shape: [3, 8], ys: 24, same: true, cloned: 0, logits: 7, round: 'to be' });
    expect((out.result as { params: number }).params).toBeGreaterThan(1000);
  });
});

describe.concurrent('Track 2, phases 4 to 7: starters and reference solutions in the sandbox', () => {
  for (const l of levels) {
    it(`${l.id}: the starter fails at least one test`, async () => {
      for (const t of jsTests(l)) {
        const r = await run(l.js!.starter, t, l);
        if (!r.pass) return;
      }
      expect.fail(`${l.id}: the starter passes every test`);
    }, 120_000);

    it(`${l.id}: the reference solution passes every test`, async () => {
      const results = await Promise.all(jsTests(l).map((t) => run(TRACK2_P4_7_SOLUTIONS[l.id]!, t, l)));
      const failures = results.filter((r) => !r.pass).map((r) => `${r.message} (${r.summary ?? ''})`);
      expect(failures, l.id).toEqual([]);
    }, 600_000);
  }
});

/**
 * E-ML-01/02: the training levels' code also runs on the GPU path. The
 * emulated GPU (packages/tensor, WGSL kernels interpreted in JavaScript) is
 * slower than the CPU here; every test of these levels still runs on it,
 * and short runs check that both devices give the same numbers.
 */
describe.concurrent('Track 2, phases 4 to 7: training on the emulated GPU', () => {
  for (const id of GPU_LEVELS) {
    it(`${id}: the reference solution passes every test on the GPU`, async () => {
      const l = level(id);
      const runs = await Promise.all(jsTests(l).map((t) => runOn('emulated', TRACK2_P4_7_SOLUTIONS[id]!, l, t.entry, t.args ?? [], 900_000)));
      jsTests(l).forEach((t, i) => {
        const { out, usedGpu } = runs[i]!;
        if (t.metric) expect(usedGpu, `${t.name}: trains on the GPU`).toBe(true);
        const r = judgeJs(out, t);
        expect(r.pass, `${t.name}: ${r.message}`).toBe(true);
      });
      if (id === 'train-tiny-gpt') expect((runs[0]!.out.result as { device?: string }).device).toBe('webgpu');
    }, 900_000);
  }

  const SHORT: Record<string, { entry: string; args: unknown[]; keys: string[] }> = {
    'train-tiny-gpt': { entry: 'train', args: [20], keys: ['trainLoss', 'valLoss'] },
    'loss-perplexity': { entry: 'trainWithCurve', args: [15], keys: ['start', 'end', 'valLoss'] },
    'fine-tuning': { entry: 'finetune', args: [10, 5], keys: ['before', 'after', 'macbethAfter'] },
    lora: { entry: 'finetuneLora', args: [4, 40], keys: ['before', 'after'] },
    'scaling-experiment': { entry: 'scalingRun', args: [[1, 4], 40], keys: [] },
  };
  for (const id of GPU_LEVELS) {
    it(`${id}: GPU and CPU runs agree (same seed, E-ML-02 tolerance)`, async () => {
      const { entry, args, keys } = SHORT[id]!;
      const l = level(id);
      const [gpu, cpu] = await Promise.all([
        runOn('emulated', TRACK2_P4_7_SOLUTIONS[id]!, l, entry, args),
        runOn('off', TRACK2_P4_7_SOLUTIONS[id]!, l, entry, args),
      ]);
      expect(gpu.out.error, JSON.stringify(gpu.out.error)).toBeUndefined();
      expect(cpu.out.error, JSON.stringify(cpu.out.error)).toBeUndefined();
      expect(gpu.usedGpu, id).toBe(true);
      expect(cpu.usedGpu, id).toBe(false);
      const g = gpu.out.result as Record<string, number | number[]>;
      const c = cpu.out.result as Record<string, number | number[]>;
      for (const k of keys) expect(Math.abs((g[k] as number) - (c[k] as number)), `${id}: ${k}`).toBeLessThan(0.02);
      if (id === 'scaling-experiment') (g.losses as number[]).forEach((v, i) => expect(Math.abs(v - (c.losses as number[])[i]!)).toBeLessThan(0.02));
    }, 600_000);
  }
});
