import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import type { MlSample } from '@build-a-computer/worker';
import { sourceFor, sourceToSave } from '../level/saves';
import { referenceText, sectionsByModule } from './apiReference';
import { detectBackend } from './capability';
import { validCheckpoint } from './checkpoints';
import { devJsLevelById, devJsLevelFromUrl, DEV_JS_LEVEL_ID } from './devLevel';
import { errorDiagnostics } from './JsEditor';
import {
  ago,
  callLabel,
  checkpointOf,
  downsample,
  firstNonFinite,
  formatNumber,
  formatValue,
  isTensor,
  logTicks,
  mergeSamples,
  niceTicks,
  progressOf,
  runTargets,
  seriesKeys,
  splitSeries,
  trainTarget,
} from './model';

const level = devJsLevelById(DEV_JS_LEVEL_ID)!;

describe('dev js level', () => {
  it('parses, opens from ?devjs=1 and starts from its starter', () => {
    expect(level.mode).toBe('js');
    expect(level.js?.training).toBe(true);
    expect(devJsLevelFromUrl(new URL('http://x/?devjs=1'))).toBe(DEV_JS_LEVEL_ID);
    expect(devJsLevelById('other')).toBeUndefined();
    expect(sourceFor(level)).toBe(level.js!.starter);
    expect(sourceFor(level, { source: 'export const x = 1;' })).toBe('export const x = 1;');
    expect(sourceToSave(level, 'abc')).toBe('abc');
  });
});

describe('call targets', () => {
  it('Run offers each distinct test call, first by default; Train picks the metric test', () => {
    const targets = runTargets(level);
    expect(targets.map((c) => c.entry)).toEqual(['predict', 'train']);
    expect(callLabel(targets[0]!)).toBe('predict([1, 0])');
    expect(trainTarget(level)).toEqual({ entry: 'train', args: [400, 1] });
    expect(trainTarget(null)).toEqual({ entry: 'train', args: [] });
  });
});

describe('value formatting', () => {
  it('prints tensors with their shape', () => {
    const t = { shape: [2, 3], data: [1, 2, 3, 4, 5, 6.5] };
    expect(isTensor(t)).toBe(true);
    expect(isTensor({ shape: [2, 2], data: [1] })).toBe(false);
    const s = formatValue(t);
    expect(s.startsWith('Tensor shape [2, 3]\n')).toBe(true);
    expect(s).toContain('[  1,   2,   3]');
    expect(s).toContain('6.5]]');
  });
  it('elides long axes and prints scalars', () => {
    const s = formatValue({ shape: [20], data: Array.from({ length: 20 }, (_, i) => i) });
    expect(s).toContain('…');
    expect(formatValue({ shape: [], data: [3] })).toBe('Tensor shape []\n3');
  });
  it('rounds numbers and names NaN/Infinity', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(NaN)).toBe('NaN');
    expect(formatNumber(null)).toBe('NaN');
    expect(formatNumber(-Infinity)).toBe('-Infinity');
    expect(formatNumber(1e-7)).toBe('1e-7');
    expect(formatNumber(1.25e-5)).toBe('1.25e-5');
    expect(formatValue({ loss: 0.25, acc: 1, w: [0.5, 2] })).toBe('{\n  loss: 0.25,\n  acc: 1,\n  w: [0.5, 2]\n}');
    expect(formatValue('hi')).toBe('"hi"');
  });
});

describe('training samples', () => {
  const samples: MlSample[] = [
    { step: 1, values: { loss: 2, acc: 0.5, total: 4 } },
    { step: 2, values: { loss: 1, val_loss: 1.5, acc: 0.75, total: 4 } },
  ];
  it('keeps series in first-seen order and splits loss from metrics', () => {
    const keys = seriesKeys(samples);
    expect(keys).toEqual(['loss', 'acc', 'val_loss']);
    expect(splitSeries(keys)).toEqual({ loss: ['loss', 'val_loss'], metrics: ['acc'] });
    expect(progressOf(samples)).toEqual({ step: 2, total: 4 });
    expect(progressOf([])).toEqual({ step: 0, total: null });
  });
  it('E-ML-03: a NaN or infinite loss is detected (NaN arrives as null after JSON)', () => {
    expect(firstNonFinite(samples)).toBeNull();
    expect(firstNonFinite([...samples, { step: 3, values: { loss: Infinity } }])).toEqual({ step: 3, key: 'loss', value: Infinity });
    const nan = firstNonFinite([{ step: 5, values: { loss: null as unknown as number } }]);
    expect(nan?.step).toBe(5);
    expect(Number.isNaN(nan?.value)).toBe(true);
    // A non-loss metric going NaN is not a divergence.
    expect(firstNonFinite([{ step: 1, values: { acc: NaN } }])).toBeNull();
  });
  it('downsamples evenly and keeps the last point', () => {
    const many = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(many, 100);
    expect(d).toHaveLength(100);
    expect(d[0]).toBe(0);
    expect(d[99]).toBe(999);
  });
  it('E-ML-06: a resumed run continues the checkpoint curve', () => {
    const prefix = [{ step: 1, values: { loss: 3 } }, { step: 50, values: { loss: 1 } }];
    const live = [{ step: 50, values: { loss: 1 } }, { step: 51, values: { loss: 0.9 } }];
    expect(mergeSamples(prefix, live).map((s) => s.step)).toEqual([1, 50, 51]);
  });
  it('E-ML-06: reads checkpoints from run state and validates stored records', () => {
    expect(checkpointOf({ samples: [], checkpoint: { step: 50, state: { w: [1] } } })).toEqual({ step: 50, state: { w: [1] } });
    expect(checkpointOf({ samples: [{ step: 9, values: {} }], checkpoint: { w: [1] } })).toEqual({ step: 9, state: { w: [1] } });
    expect(checkpointOf({ samples: [] })).toBeNull();
    const rec = { levelId: 'a', levelVersion: 1, step: 3, state: 1, samples: [{ step: 1, values: { loss: 1 } }, 'junk'], savedAt: 5 };
    expect(validCheckpoint(rec, 'a')?.samples).toHaveLength(1);
    expect(validCheckpoint(rec, 'b')).toBeNull();
    expect(validCheckpoint({ __proto__: null }, 'a')).toBeNull();
    expect(ago(0, 30_000).key).toBe('ml.train.justNow');
    expect(ago(0, 5 * 60_000)).toEqual({ key: 'ml.train.minutesAgo', n: 5 });
  });
});

describe('axes', () => {
  it('makes round linear ticks and decade log ticks', () => {
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.5, 1]);
    expect(niceTicks(0, 1, 8)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
    expect(logTicks(0.03, 2)).toEqual([0.01, 0.1, 1, 10]);
    expect(logTicks(0, 1)).toEqual([]);
  });
});

describe('API reference', () => {
  it('takes module sections from the markdown doc and falls back otherwise', () => {
    const md = '# JS levels\n\nIntro\n\n## `tensor`\n\nmatmul(a, b)\n\n### Shapes\nrow-major\n\n## `nn`\n\nLinear\n\n## Sandbox\n\nnot a module';
    const s = sectionsByModule(md, ['tensor', 'nn']);
    expect(s.tensor).toContain('matmul(a, b)');
    expect(s.tensor).toContain('row-major');
    expect(s.nn).toContain('Linear');
    expect(s.nn).not.toContain('not a module');
    const text = referenceText({ js: { ...level.js!, modules: ['tensor', 'optim'] } }, md);
    expect(text).toContain('matmul(a, b)');
    expect(text).toContain("from 'optim'");
    expect(text).not.toContain('Linear');
  });
});

describe('capability check', () => {
  it('E-ML-01: no WebGPU adapter means the CPU backend', async () => {
    expect(await detectBackend(undefined)).toBe('cpu');
    expect(await detectBackend({ gpu: { requestAdapter: () => Promise.resolve(null) } })).toBe('cpu');
    expect(await detectBackend({ gpu: { requestAdapter: () => Promise.reject(new Error('lost')) } })).toBe('cpu');
    expect(await detectBackend({ gpu: { requestAdapter: () => Promise.resolve({}) } })).toBe('webgpu');
  });
});

describe('error lines', () => {
  it('marks the error line in main.js', () => {
    const doc = Text.of(['a', '  bad();', 'c']);
    const [d] = errorDiagnostics({ message: 'boom', line: 2 }, doc);
    expect(d).toMatchObject({ from: 4, to: 10, severity: 'error', message: 'boom' });
    expect(errorDiagnostics({ message: 'x', line: 9 }, doc)).toEqual([]);
    expect(errorDiagnostics(undefined, doc)).toEqual([]);
  });
});
