import { describe, expect, it } from 'vitest';
import { compareValues } from './compare';
import { diffValues, listMismatches, metricDetail, numericShape, unflatIndex, type JsDiffNode } from './diff';
import { judgeJs } from './index';
import type { JsTestSpec } from './index';

const T = (shape: number[], data: number[]) => ({ shape, data });

describe('diffValues', () => {
  it('agrees with compareValues on ok', () => {
    const cases: [unknown, unknown][] = [
      [1, 1],
      [1.0000001, 1],
      [1.1, 1],
      [T([2], [1, 2]), [1, 2]],
      [T([2], [1, 3]), [1, 2]],
      [T([2, 2], [1, 2, 3, 4]), [[1, 2], [3, 4]]],
      [T([4], [1, 2, 3, 4]), [[1, 2], [3, 4]]],
      [T([1], [5]), 5],
      [T([], [5]), 5],
      [T([2], [5, 6]), 5],
      [[1, 2], T([2], [1, 2])],
      [T([2], [1, 2]), T([2], [1, 2])],
      [T([2], [1, 2]), T([1, 2], [1, 2])],
      [{ a: 1, b: [1, 2], extra: 3 }, { a: 1, b: [1, 2] }],
      [{ a: 1 }, { a: 1, b: 2 }],
      [[1, 2, 3], [1, 2]],
      ['x', 'x'],
      ['x', 'y'],
      [null, null],
      [undefined, null],
      [NaN, 1],
      [[{ w: T([2], [1, 2]) }], [{ w: [1, 2] }]],
      [[T([2], [1, 2]), T([2], [3, 4])], [[1, 2], [3, 4]]],
      [5, [5]],
      [true, true],
    ];
    for (const [a, e] of cases) expect(diffValues(a, e, 1e-6).ok, JSON.stringify([a, e])).toBe(compareValues(a, e, 1e-6).ok);
  });

  it('marks every mismatching tensor index and lists them with multi-indices', () => {
    const d = diffValues(T([2, 3], [1, 2, 3, 4, 5, 9]), [[1, 2, 3], [4, 0, 6]], 1e-6);
    expect(d.kind).toBe('tensor');
    const t = d as Extract<JsDiffNode, { kind: 'tensor' }>;
    expect(t.ok).toBe(false);
    expect(t.bad).toEqual([4, 5]);
    expect(t.badCount).toBe(2);
    expect(listMismatches(d).map((m) => m.message)).toEqual([
      'result[1][1]: expected 0 ± 1e-6, got 5',
      'result[1][2]: expected 6 ± 1e-6, got 9',
    ]);
  });

  it('names paths inside objects with the tolerance', () => {
    const d = diffValues({ weights: [0.1, 0.2, 0.47] }, { weights: [0.1, 0.2, 0.5] }, 1e-6);
    expect(listMismatches(d)).toEqual([{ path: 'result.weights[2]', message: 'result.weights[2]: expected 0.5 ± 1e-6, got 0.47' }]);
  });

  it('explains shape mismatches, missing keys and wrong types', () => {
    expect(listMismatches(diffValues(T([3], [1, 2, 3]), [[1, 2, 3]], 1e-6))[0]!.message).toBe('result: expected shape [1, 3], got [3]');
    expect(listMismatches(diffValues({}, { loss: 1 }, 1e-6))[0]!.message).toBe("result.loss: missing key 'loss'");
    expect(listMismatches(diffValues('a', 1, 1e-6))[0]!.message).toBe('result: expected 1, got "a"');
    expect(listMismatches(diffValues([1], [1, 2], 1e-6))[0]!.message).toBe('result: expected 2 items, got 1');
  });

  it('caps the list', () => {
    const d = diffValues(new Array(100).fill(1), new Array(100).fill(0), 1e-6);
    expect(listMismatches(d, 5)).toHaveLength(5);
  });
});

describe('helpers', () => {
  it('numericShape and unflatIndex', () => {
    expect(numericShape([[1, 2], [3, 4]])).toEqual({ shape: [2, 2], data: [1, 2, 3, 4] });
    expect(numericShape([[1], [2, 3]])).toBeUndefined();
    expect(numericShape([1, 'a'])).toBeUndefined();
    expect(unflatIndex(5, [2, 3])).toEqual([1, 2]);
    expect(unflatIndex(0, [])).toEqual([]);
  });
  it('metricDetail', () => {
    expect(metricDetail({ acc: 0.9 }, { name: 'acc', min: 0.95 })).toEqual({ name: 'acc', value: 0.9, min: 0.95, ok: false });
    expect(metricDetail({ loss: T([1], [0.05]) }, { name: 'loss', max: 0.1 })).toEqual({ name: 'loss', value: 0.05, max: 0.1, ok: true });
    expect(metricDetail({}, { name: 'x' }).value).toBeNull();
  });
});

describe('judgeJs', () => {
  const test = (t: Partial<JsTestSpec>): JsTestSpec => ({ kind: 'js', entry: 'f', args: [], tolerance: 1e-6, seed: 1, timeoutMs: 1000, ...t }) as JsTestSpec;
  it('adds a capped mismatch list to case results and the tree on request', () => {
    const out = { ok: true, result: { w: [1, 2, 4] }, ms: 3 };
    const r = judgeJs(out, test({ expect: { w: [1, 2, 3] } }));
    expect(r.pass).toBe(false);
    expect(r.detail?.mismatches[0]?.message).toBe('result.w[2]: expected 3 ± 1e-6, got 4');
    expect(r.detail?.diff).toBeUndefined();
    expect(judgeJs(out, test({ expect: { w: [1, 2, 3] } }), { count: 0 }, true).detail?.diff?.kind).toBe('object');
  });
  it('reports metric values', () => {
    const r = judgeJs({ ok: true, result: { acc: 0.5 }, ms: 3 }, test({ metric: { name: 'acc', min: 0.9 } }));
    expect(r.pass).toBe(false);
    expect(r.detail?.metric).toEqual({ name: 'acc', value: 0.5, min: 0.9, ok: false });
    expect(r.message).toBe('f(): acc is 0.5; it must be >= 0.9.');
  });
  it('keeps errors without detail', () => {
    const r = judgeJs({ ok: false, error: { kind: 'runtime', message: 'TypeError: x', file: 'main.js', line: 3 }, ms: 1 }, test({ expect: 1 }));
    expect(r.message).toBe('f(): main.js line 3: TypeError: x');
    expect(r.detail).toBeUndefined();
  });
});
