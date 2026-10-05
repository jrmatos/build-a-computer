import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runJsTest, type DatasetProvider } from '@build-a-computer/js-check';
import { Level } from '@build-a-computer/schema';
import { DATASETS, datasetById } from '../../../datasets';
import { TRACK2_P4_7_SOLUTIONS } from '../../../solutions/track2/phase4-7';
import { TRACK2_P1_3_LEVELS } from '../phase1-3';
import { GPT_JS } from './gpt-lib';
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

/** Imports gpt.js as a real ES module (for the gradient check). */
type Gpt = Record<string, (...a: never[]) => unknown>;
const gpt = (): Promise<Gpt> => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(GPT_JS).toString('base64')}`) as Promise<Gpt>;

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

  it('E-ML-05: gpt.js gradients match float64 finite differences', async () => {
    const G = (await gpt()) as unknown as {
      createGPT(c: object): { params: Record<string, { data: Float64Array; grad: Float64Array | null }> };
      gptForward(m: unknown, x: number[], B: number, T: number, y: number[]): { loss: { item(): number } };
      backward(l: unknown): void;
      clearTape(): void;
      zeroGrad(m: unknown): void;
      rng(s: number): () => number;
    };
    const m = G.createGPT({ vocabSize: 7, blockSize: 5, dModel: 8, nHead: 2, nLayer: 2, seed: 3 });
    const r = G.rng(9);
    for (const p of Object.values(m.params)) for (let i = 0; i < p.data.length; i++) p.data[i]! += (r() - 0.5) * 0.5;
    const x = [1, 2, 3, 4, 0, 6, 5, 4, 3, 2];
    const y = [2, 3, 4, 0, 1, 5, 4, 3, 2, 1];
    const loss = (): number => {
      const l = G.gptForward(m, x, 2, 5, y).loss.item();
      G.clearTape();
      return l;
    };
    G.zeroGrad(m);
    G.backward(G.gptForward(m, x, 2, 5, y).loss);
    let worst = 0;
    for (const [name, p] of Object.entries(m.params)) {
      const stride = Math.max(1, Math.floor(p.data.length / 7));
      for (let i = 0; i < p.data.length; i += stride) {
        const o = p.data[i]!;
        p.data[i] = o + 1e-6;
        const up = loss();
        p.data[i] = o - 1e-6;
        const down = loss();
        p.data[i] = o;
        const num = (up - down) / 2e-6;
        const an = p.grad?.[i] ?? 0;
        const err = Math.abs(num - an) / Math.max(1e-6, Math.abs(num) + Math.abs(an));
        expect(err, `${name}[${i}]`).toBeLessThan(1e-4);
        worst = Math.max(worst, err);
      }
    }
    expect(worst).toBeLessThan(1e-4);
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
