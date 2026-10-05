import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JS_MODULES, Level } from '@build-a-computer/schema';
import { datasetsFrom, runJsTest } from '@build-a-computer/js-check';
import { TRACK2_P1_3_SOLUTIONS } from '../../../solutions/track2/phase1-3';
import { referenceSource } from '../../../solutions';
import { DATASETS, datasetById, digits } from '../../../datasets';
import { LEVELS } from '../../full';
import type { JsTest } from './common';
import { TRACK2_P1_3_LEVELS } from './index';

const PLAN_IDS = [
  // Phase 1: Numbers
  'vectors-dot',
  'matmul',
  'broadcasting',
  'softmax',
  // Phase 2: Learning
  'a-neuron',
  'loss-functions',
  'gradient-descent-1d',
  'chain-rule',
  'autograd',
  // Phase 3: Networks
  'mlp-xor',
  'training-loop',
  'overfitting',
  'digit-recognizer',
];

const ids = TRACK2_P1_3_LEVELS.map((l) => l.id);

/** First failing test of `source` on `level`, or null when every test passes. */
async function firstFailure(level: Level, source: string): Promise<string | null> {
  for (const [k, t] of level.tests.entries()) {
    const r = await runJsTest(source, t as JsTest, level, { datasets: datasetsFrom(DATASETS) });
    if (!r.pass) return `test ${k} (${(t as JsTest).name}): want ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)} ${r.message ?? ''}`;
  }
  return null;
}

/** Why js-check cannot run tests yet (its stub), or null when it can. */
async function pendingReason(): Promise<string | null> {
  const level = TRACK2_P1_3_LEVELS[0]!;
  const r = await runJsTest('export const add = () => [];', level.tests[0] as JsTest, level);
  return /not implemented/i.test(r.message ?? '') ? 'js-check runJsTest not implemented yet' : null;
}

describe('Track 2, phases 1-3', () => {
  it('are the 13 planned draft js levels, in play order', () => {
    expect(ids).toEqual(PLAN_IDS);
    const phases = TRACK2_P1_3_LEVELS.map((l) => `${l.phase}.${l.order}`);
    expect(phases).toEqual(['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '2.3', '2.4', '2.5', '3.1', '3.2', '3.3', '3.4']);
    for (const l of TRACK2_P1_3_LEVELS) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.track, l.id).toBe('neuron-to-llm');
      expect(l.mode, l.id).toBe('js');
      expect(l.draft, l.id).toBe(true);
      expect(l.js, l.id).toBeDefined();
      expect(l.js!.starter.length, l.id).toBeGreaterThan(0);
      expect(l.tutorial, l.id).toMatch(/```js\n/);
      expect(l.hints.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.hints.length, l.id).toBeLessThanOrEqual(5);
      expect(l.hints.at(-1), l.id).toMatch(/```js\n/);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
      expect(l.tests.length, l.id).toBeGreaterThanOrEqual(1);
      for (const t of l.tests) expect(t.kind === 'js' && t.name, l.id).toBeTruthy();
    }
  });

  it('are registered in LEVELS', () => {
    for (const id of ids) expect(LEVELS.some((l) => l.id === id), id).toBe(true);
  });

  it('form a chain; the first level requires nothing (Track 2 runs alongside Track 1)', () => {
    expect(TRACK2_P1_3_LEVELS[0]!.requires).toEqual([]);
    for (let i = 1; i < TRACK2_P1_3_LEVELS.length; i++) expect(TRACK2_P1_3_LEVELS[i]!.requires).toEqual([ids[i - 1]]);
  });

  it('unlock modules only after the player built them: none in Phase 1, autograd after the autograd level', () => {
    let prev: string[] = [];
    for (const l of TRACK2_P1_3_LEVELS) {
      const mods = l.js!.modules;
      for (const m of mods) expect(JS_MODULES, l.id).toContain(m);
      for (const m of prev) expect(mods, `${l.id} keeps ${m}`).toContain(m);
      prev = mods;
      if (l.phase === 1) expect(mods, l.id).toEqual([]);
      if (l.phase === 2) expect(mods, l.id).not.toContain('autograd');
    }
    expect(TRACK2_P1_3_LEVELS.find((l) => l.id === 'mlp-xor')!.js!.modules).toContain('autograd');
    expect(TRACK2_P1_3_LEVELS.find((l) => l.id === 'training-loop')!.js!.modules).toEqual(expect.arrayContaining(['nn', 'optim']));
  });

  it('starters and references only import unlocked modules', () => {
    for (const l of TRACK2_P1_3_LEVELS) {
      for (const [what, src] of [
        ['starter', l.js!.starter],
        ['reference', TRACK2_P1_3_SOLUTIONS[l.id]!],
      ] as const) {
        const imported = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
        for (const m of imported) expect(l.js!.modules, `${l.id} ${what} imports '${m}'`).toContain(m);
      }
    }
  });

  it('training levels show the training panel and use seeded metric tests', () => {
    for (const l of TRACK2_P1_3_LEVELS.filter((x) => x.phase === 3)) {
      expect(l.js!.training, l.id).toBe(true);
      expect(l.tests.some((t) => t.kind === 'js' && t.metric), l.id).toBe(true);
    }
  });

  it('every level has a reference main.js, also through referenceSource()', () => {
    for (const l of TRACK2_P1_3_LEVELS) {
      expect(TRACK2_P1_3_SOLUTIONS[l.id], l.id).toBeTruthy();
      expect(referenceSource(l), l.id).toBe(TRACK2_P1_3_SOLUTIONS[l.id]);
    }
  });

  it('E-ML-07: every dataset a level uses is registered with a permissive license and listed in LICENSES.md', () => {
    const licenses = readFileSync(new URL('../../../datasets/LICENSES.md', import.meta.url), 'utf8');
    const used = TRACK2_P1_3_LEVELS.flatMap((l) => l.js!.datasets);
    expect(used).toContain('digits-8x8');
    for (const id of used) {
      const d = datasetById(id);
      expect(d, id).toBeDefined();
      expect(['CC0-1.0', 'CC-BY-4.0', 'MIT', 'Apache-2.0', 'PDDL-1.0']).toContain(d!.meta.license);
      expect(licenses, id).toContain('`' + id + '`');
      expect(licenses, id).toContain(d!.meta.license);
    }
    for (const l of TRACK2_P1_3_LEVELS) expect(l.js!.modules.includes('data'), l.id).toBe(l.js!.datasets.length > 0);
  });

  it('datasets stay under 20 MB per level and their size record is honest', () => {
    for (const [id, d] of Object.entries(DATASETS)) {
      const bytes = JSON.stringify(d.load()).length;
      expect(bytes, id).toBeLessThanOrEqual(20 * 1024 * 1024);
      expect(Math.abs(bytes - d.meta.sizeBytes) / bytes, `${id}: ${bytes} bytes`).toBeLessThan(0.25);
    }
  });

  it('digits-8x8 is deterministic, balanced and in range', () => {
    const a = digits();
    expect(JSON.stringify(digits())).toBe(JSON.stringify(a));
    expect(a.train.x.length).toBe(1500);
    expect(a.test.x.length).toBe(300);
    for (const split of [a.train, a.test]) {
      const counts = new Array(10).fill(0);
      for (const y of split.y) counts[y]++;
      expect(new Set(counts).size).toBe(1);
      for (const x of split.x) {
        expect(x.length).toBe(64);
        for (const v of x) expect(v >= 0 && v <= 1).toBe(true);
      }
    }
    expect(JSON.stringify(digits({ seed: 1 }))).not.toBe(JSON.stringify(a));
  });

  describe('checks run the player code (js-check)', async () => {
    const pending = await pendingReason();
    it.skipIf(pending !== null)(`every reference passes every test${pending ? ` (skipped: ${pending})` : ''}`, async () => {
      for (const l of TRACK2_P1_3_LEVELS) expect(await firstFailure(l, TRACK2_P1_3_SOLUTIONS[l.id]!), l.id).toBeNull();
    }, 600_000);
    it.skipIf(pending !== null)(`E-RES-06: every starter fails at least one test${pending ? ` (skipped: ${pending})` : ''}`, async () => {
      for (const l of TRACK2_P1_3_LEVELS) expect(await firstFailure(l, l.js!.starter), l.id).not.toBeNull();
    }, 600_000);
  });
});
