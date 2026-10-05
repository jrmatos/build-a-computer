import { describe, expect, it } from 'vitest';
import { Level, type TestSpec } from '@build-a-computer/schema';
import { NAN_MESSAGE, compareValues, checkMetric, closeEnough, datasetsFrom, runJsTest, startJs, type JsTestSpec } from './index';
import type { MlSample } from './protocol';

const level = (js: Record<string, unknown> = {}, tests: TestSpec[] = []): Level =>
  Level.parse({ id: 'js-t', version: 1, track: 'sandbox', phase: 0, order: 0, title: 'T', goal: 'g', palette: [], starter: { parts: [], wires: [] }, tests, mode: 'js', js });

const call = (source: string, entry = 'main', args: unknown[] = [], js: Record<string, unknown> = {}, extra: { seed?: number; timeoutMs?: number; checkpoint?: unknown } = {}) =>
  startJs({ source, level: level(js), entry, args, ...extra }).done;

const jsTest = (t: Partial<JsTestSpec> & { entry: string }): JsTestSpec => ({ kind: 'js', args: [], tolerance: 1e-6, seed: 1, timeoutMs: 10_000, ...t }) as JsTestSpec;

describe('ASM-05: sandbox isolation', () => {
  it('ASM-05: fetch, XMLHttpRequest, WebSocket, importScripts, process and require are unavailable', async () => {
    const r = await call(`export function main() {
      return [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts, typeof process, typeof require,
        typeof globalThis.fetch, typeof globalThis.process, typeof self === 'undefined' ? 'undefined' : typeof self.fetch];
    }`);
    expect(r.ok).toBe(true);
    expect(r.result).toEqual(Array(9).fill('undefined'));
  });

  it('ASM-05: dynamic import of Node or network modules fails, even through the Function constructor', async () => {
    const r = await call(`export async function main() {
      const out = [];
      for (const f of [() => import('node:fs'), () => Function('return import("node:fs")')(), () => Function('return import("https://example.com/x.js")')()]) {
        try { await f(); out.push('loaded'); } catch (e) { out.push('blocked'); }
      }
      return out;
    }`);
    expect(r.result).toEqual(['blocked', 'blocked', 'blocked']);
  });

  it('ASM-05: an infinite loop is killed at the time limit', async () => {
    const t0 = Date.now();
    const r = await call('export function main() { for (;;) {} }', 'main', [], {}, { timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('timeout');
    const c = await runJsTest('export function main() { while (true) {} }', jsTest({ entry: 'main', timeoutMs: 200 }), level());
    expect(c.pass).toBe(false);
    expect(c.message).toMatch(/time limit/);
  });

  it('ASM-05: stop() terminates a running sandbox', async () => {
    const run = startJs({ source: 'export function main() { for (;;) {} }', level: level(), entry: 'main', timeoutMs: 60_000 });
    setTimeout(() => run.stop(), 200);
    const r = await run.done;
    expect(r.error?.kind).toBe('stopped');
  });

  it('code that escapes its module wrapper is rejected before running', async () => {
    const r = await call('export function main() { return 1; }\n}; fetch("https://example.com"); {\n');
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ kind: 'syntax', file: 'main.js', line: 2 });
  });
});

describe('modules', () => {
  it('imports the unlocked library modules', async () => {
    const r = await call(
      `import * as T from 'tensor';
import * as nn from 'nn';
import { CharTokenizer } from 'tokenizer';
import { sparkline, ema } from 'plot';
export function main() {
  const tok = new CharTokenizer('hello');
  const s = ema(0.5); s(0);
  return { t: typeof T, nn: typeof nn, ids: tok.encode('hello'), back: tok.decode(tok.encode('hole')), spark: sparkline([0, 1]), ema: s(2) };
}`,
      'main',
      [],
      { modules: ['tensor', 'nn', 'tokenizer', 'plot'] },
    );
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual({ t: 'object', nn: 'object', ids: [1, 0, 2, 2, 3], back: 'hole', spark: '▁█', ema: 1 });
  });

  it('imports level library files by ./name and supports top-level await', async () => {
    const r = await call(
      "import { double, K } from './helpers.js';\nconst base = await Promise.resolve(10);\nexport const main = (x) => double(x) + K + base;\n",
      'main',
      [4],
      { library: [{ name: 'helpers.js', text: "import { mean } from 'plot';\nexport function double(x) { return 2 * x; }\nexport const K = mean([1, 3]);\n" }], modules: ['plot'] },
    );
    expect(r.result).toBe(20);
  });

  it('rejects a module the level does not unlock, with the import line', async () => {
    const r = await call("const a = 1;\nimport { Linear } from 'nn';\nexport function main() {}\n", 'main', [], { modules: ['tensor'] });
    expect(r.error).toMatchObject({ kind: 'import', file: 'main.js', line: 2 });
    expect(r.error?.message).toMatch(/not unlocked/);
    const r2 = await call("import fs from 'fs';\nexport function main() {}\n");
    expect(r2.error).toMatchObject({ kind: 'import', line: 1 });
    expect(r2.error?.message).toMatch(/no network or files/);
  });

  it('reports a missing export name at the import line', async () => {
    const r = await call("\nimport { nope } from 'plot';\nexport function main() {}\n", 'main', [], { modules: ['plot'] });
    expect(r.error).toMatchObject({ file: 'main.js', line: 2 });
    expect(r.error?.message).toMatch(/no export named 'nope'/);
  });

  it('loads datasets through the data module from the provider', async () => {
    const datasets = datasetsFrom({
      xor: { meta: { id: 'xor', license: 'CC0-1.0' }, load: async () => ({ x: new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), y: [0, 1, 1, 0] }) },
    });
    const r = await startJs(
      {
        source: "import { load, info, datasets } from 'data';\nexport async function main() { const d = await load('xor'); return { n: d.x.length, y: d.y, lic: info('xor').license, ids: datasets }; }\n",
        level: level({ modules: ['data'], datasets: ['xor'] }),
        entry: 'main',
      },
      { datasets },
    ).done;
    expect(r.result).toEqual({ n: 8, y: [0, 1, 1, 0], lic: 'CC0-1.0', ids: ['xor'] });
  });

  it('reports a missing entry function', async () => {
    const r = await call('export function other() {}');
    expect(r.error?.message).toMatch(/does not export a function named 'main'/);
  });
});

describe('seeded Math.random', () => {
  const src = 'export function main() { return [Math.random(), Math.random(), Math.random()]; }';
  it('the same seed gives the same numbers; another seed gives others', async () => {
    const a = await call(src, 'main', [], {}, { seed: 7 });
    const b = await call(src, 'main', [], {}, { seed: 7 });
    const c = await call(src, 'main', [], {}, { seed: 8 });
    expect(a.result).toEqual(b.result);
    expect(a.result).not.toEqual(c.result);
    for (const v of a.result as number[]) expect(v >= 0 && v < 1).toBe(true);
  });
});

describe('error line mapping', () => {
  it('runtime errors point at the main.js line', async () => {
    const r = await call('export function main() {\n  const a = 1;\n  return a.b.c;\n}\n');
    expect(r.error).toMatchObject({ kind: 'runtime', file: 'main.js', line: 3 });
    expect(r.error?.message).toMatch(/TypeError/);
  });

  it('errors inside a library file point at that file', async () => {
    const r = await call("import { boom } from './lib.js';\nexport function main() { return boom(); }\n", 'main', [], {
      library: [{ name: 'lib.js', text: '// helper\n\nexport function boom() {\n  throw new RangeError("bad");\n}\n' }],
    });
    expect(r.error).toMatchObject({ file: 'lib.js', line: 4 });
  });

  it('syntax errors point at the main.js line', async () => {
    const r = await call('export function main() {\n  return 1 +;\n}\n');
    expect(r.error).toMatchObject({ kind: 'syntax', file: 'main.js', line: 2 });
    const c = await runJsTest('export function main() {\n\n  let let = 2;\n}\n', jsTest({ entry: 'main' }), level());
    expect(c.message).toMatch(/main\.js line 3/);
  });
});

describe('report() and checkpoints', () => {
  it('report() streams samples with steps', async () => {
    const samples: MlSample[] = [];
    const r = await startJs(
      { source: 'export function main() { for (let i = 0; i < 50; i++) report({ loss: 1 / (i + 1), acc: i / 50 }); report({ step: 100, loss: 0 }); return 1; }', level: level(), entry: 'main' },
      { onSamples: (s) => samples.push(...s) },
    ).done;
    expect(r.ok).toBe(true);
    expect(samples).toHaveLength(51);
    expect(samples[0]).toEqual({ step: 0, values: { loss: 1, acc: 0 } });
    expect(samples[49]!.step).toBe(49);
    expect(samples[50]).toEqual({ step: 100, values: { loss: 0 } });
  });

  it('console.log output is captured', async () => {
    let log = '';
    await startJs({ source: 'export function main() { console.log("x =", 3, [1, 2], { a: 1 }); }', level: level(), entry: 'main' }, { onLog: (t) => (log += t) }).done;
    expect(log).toBe('x = 3 [1, 2] { a: 1 }\n');
  });

  it('E-ML-06: checkpoint(state) reaches the host and restoreCheckpoint() returns the saved state', async () => {
    let saved: unknown;
    const src = 'export function main() { const prev = restoreCheckpoint(); checkpoint({ step: (prev?.step ?? 0) + 10, w: new Float32Array([1, 2]) }); return prev?.step ?? 0; }';
    const first = await startJs({ source: src, level: level(), entry: 'main' }, { onCheckpoint: (s) => (saved = s) }).done;
    expect(first.result).toBe(0);
    expect(saved).toEqual({ step: 10, w: new Float32Array([1, 2]) });
    const second = await startJs({ source: src, level: level(), entry: 'main', checkpoint: saved }).done;
    expect(second.result).toBe(10);
  });
});

describe('runJsTest', () => {
  const add = 'export function add(a, b) { return a + b; }\nexport function vec() { return [0.1 + 0.2, [1, 2.0000001]]; }\nexport function tensorish() { return { shape: [2, 2], data: new Float32Array([1, 2, 3, 4.0000001]) }; }';

  it('E-ML-02: compares numbers within tolerance, never exactly', async () => {
    const pass = await runJsTest(add, jsTest({ entry: 'vec', expect: [0.3, [1, 2]], tolerance: 1e-6 }), level());
    expect(pass.pass).toBe(true);
    expect(pass.kind).toBe('js');
    const fail = await runJsTest(add, jsTest({ entry: 'add', args: [1, 2], expect: 3.1, tolerance: 1e-3 }), level());
    expect(fail.pass).toBe(false);
    expect(fail.message).toMatch(/expected 3\.1, got 3/);
  });

  it('E-ML-02: tensors compare by shape and data, also against nested arrays', async () => {
    expect((await runJsTest(add, jsTest({ entry: 'tensorish', expect: { shape: [2, 2], data: [1, 2, 3, 4] }, tolerance: 1e-5 }), level())).pass).toBe(true);
    expect((await runJsTest(add, jsTest({ entry: 'tensorish', expect: [[1, 2], [3, 4]], tolerance: 1e-5 }), level())).pass).toBe(true);
    const bad = await runJsTest(add, jsTest({ entry: 'tensorish', expect: { shape: [4], data: [1, 2, 3, 4] } }), level());
    expect(bad.message).toMatch(/expected shape \[4\], got \[2, 2\]/);
  });

  it('metric tests check result[name] within [min, max]', async () => {
    const src = 'export function train() { return { accuracy: 0.97, loss: 0.05 }; }';
    expect((await runJsTest(src, jsTest({ entry: 'train', metric: { name: 'accuracy', min: 0.95 } }), level())).pass).toBe(true);
    const low = await runJsTest(src, jsTest({ entry: 'train', metric: { name: 'loss', max: 0.01 } }), level());
    expect(low.pass).toBe(false);
    expect(low.message).toMatch(/loss is 0\.05; it must be <= 0\.01/);
    const missing = await runJsTest(src, jsTest({ entry: 'train', metric: { name: 'f1', min: 0 } }), level());
    expect(missing.message).toMatch(/no number 'f1'/);
  });

  it('E-ML-03: a NaN loss in report() stops training with the learning-rate hint', async () => {
    const src = 'export function train(lr) { let loss = 1; for (let i = 0; i < 1000; i++) { loss = loss * lr * 1e300; report({ loss: loss - loss }); } return { loss }; }';
    const c = await runJsTest(src, jsTest({ entry: 'train', args: [10], metric: { name: 'loss', max: 1 } }), level());
    expect(c.pass).toBe(false);
    expect(c.message).toContain(NAN_MESSAGE);
  });

  it('E-ML-03: NaN or Infinity in the result fails with the learning-rate hint', async () => {
    const src = 'export function train() { return { loss: NaN }; }\nexport function inf() { return [1, Infinity]; }\nexport function plain() { return 0/0; }';
    expect((await runJsTest(src, jsTest({ entry: 'train', metric: { name: 'loss', max: 1 } }), level())).message).toContain(NAN_MESSAGE);
    expect((await runJsTest(src, jsTest({ entry: 'inf', expect: [1, 2] }), level())).message).toContain(NAN_MESSAGE);
    expect((await runJsTest(src, jsTest({ entry: 'plain' }), level())).message).toContain(NAN_MESSAGE);
  });

  it('a call without expect or metric passes when it runs without errors', async () => {
    const c = await runJsTest('export function main() { report({ loss: 0.5 }); return 1; }', jsTest({ entry: 'main' }), level());
    expect(c.pass).toBe(true);
    expect(c.summary).toMatch(/1 report\(\) samples, last: loss 0\.5/);
  });
});

describe('compare helpers', () => {
  it('E-ML-02: closeEnough is relative for large numbers and absolute near zero', () => {
    expect(closeEnough(1e9 + 1, 1e9, 1e-6)).toBe(true);
    expect(closeEnough(1e-7, 0, 1e-6)).toBe(true);
    expect(closeEnough(1e-5, 0, 1e-6)).toBe(false);
    expect(closeEnough(NaN, NaN, 0)).toBe(true);
    expect(closeEnough(NaN, 1, 1)).toBe(false);
  });
  it('compareValues reports the path of the first difference', () => {
    expect(compareValues({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }, 1e-6)).toMatchObject({ ok: false, path: 'result.a[1].b' });
    expect(compareValues({ a: 1, extra: 2 }, { a: 1 }, 0).ok).toBe(true);
    expect(compareValues('x', 'x', 0).ok).toBe(true);
  });
  it('checkMetric checks both bounds', () => {
    expect(checkMetric({ acc: 0.5 }, { name: 'acc', min: 0.4, max: 0.6 }).ok).toBe(true);
    expect(checkMetric({ acc: 0.7 }, { name: 'acc', min: 0.4, max: 0.6 }).ok).toBe(false);
  });
});

describe('tensor library', () => {
  it('tensors from the tensor module come back as {shape, data} and compare with tolerance', async () => {
    const src = "import { tensor } from 'tensor';\nexport function main() { return tensor([[1, 2], [3, 4]]).mul(0.5); }\n";
    const lvl = level({ modules: ['tensor'] });
    const r = await startJs({ source: src, level: lvl, entry: 'main' }).done;
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual({ shape: [2, 2], data: [0.5, 1, 1.5, 2] });
    const c = await runJsTest(src, jsTest({ entry: 'main', expect: [[0.5, 1], [1.5, 2]] }), lvl);
    expect(c.pass).toBe(true);
  });

  it('E-ML-06: tensors in a checkpoint are restored as tensors', async () => {
    let saved: unknown;
    const src = "import { tensor } from 'tensor';\nexport function save() { checkpoint({ w: tensor([1, 2]) }); }\nexport function load() { const s = restoreCheckpoint(); return s.w.mul(2); }\n";
    const lvl = level({ modules: ['tensor'] });
    await startJs({ source: src, level: lvl, entry: 'save' }, { onCheckpoint: (s) => (saved = s) }).done;
    const r = await startJs({ source: src, level: lvl, entry: 'load', checkpoint: saved, checkpointStep: 5 }).done;
    expect(r.result).toEqual({ shape: [2], data: [2, 4] });
  });
});

describe('resume', () => {
  it('E-ML-06: report() steps continue after the checkpoint step, and checkpoint() reports its step', async () => {
    const samples: MlSample[] = [];
    const steps: number[] = [];
    await startJs(
      { source: 'export function main() { report({ loss: 1 }); report({ loss: 0.5 }); checkpoint({ w: 1 }); }', level: level(), entry: 'main', checkpoint: { w: 0 }, checkpointStep: 5 },
      { onSamples: (s) => samples.push(...s), onCheckpoint: (_s, step) => steps.push(step) },
    ).done;
    expect(samples.map((s) => s.step)).toEqual([6, 7]);
    expect(steps).toEqual([7]);
  });
});
