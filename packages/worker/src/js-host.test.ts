import { describe, expect, it } from 'vitest';
import { Level, type TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { SimHost } from './host';
import type { JsRunState } from './protocol';

const level = (tests: TestSpec[], js: Record<string, unknown> = {}): Level =>
  Level.parse({ id: 'js', version: 1, track: 'sandbox', phase: 0, order: 0, title: 'T', goal: 'g', palette: [], starter: { parts: [], wires: [] }, tests, mode: 'js', js });

const TRAIN = `export function train(steps) {
  let w = 0;
  for (let i = 0; i < steps; i++) {
    w += 0.1 * (1 - w);
    report({ loss: (1 - w) ** 2 });
    if (i % 10 === 9) checkpoint({ w });
  }
  console.log('done', w.toFixed(2));
  return { loss: (1 - w) ** 2 };
}
export function resume() { return restoreCheckpoint(); }
export function broken() {
  return undefinedThing;
}
export function forever() { for (;;) {} }
`;

describe('SimHost JsApi', () => {
  it('jsCall streams log, samples and checkpoints, then the result', async () => {
    const host = new SimHost();
    const states: JsRunState[] = [];
    host.jsSubscribe((s) => states.push(s));
    const r = await host.jsCall(TRAIN, level([]), 'train', [30]);
    expect(r.ok).toBe(true);
    expect((r.result as { loss: number }).loss).toBeLessThan(0.01);
    const last = states[states.length - 1]!;
    expect(last.running).toBe(false);
    expect(last.samples).toHaveLength(30);
    expect(last.log).toBe('done 0.96\n');
    expect(last.checkpoint?.step).toBe(29);
    expect(last.result).toEqual(r.result);
  });

  it('E-ML-06: resume makes restoreCheckpoint() return the saved state', async () => {
    const host = new SimHost();
    const r = await host.jsCall(TRAIN, level([]), 'resume', [], { resume: { step: 9, state: { w: 0.5 } } });
    expect(r.result).toEqual({ w: 0.5 });
  });

  it('errors carry the main.js line', async () => {
    const host = new SimHost();
    let last: JsRunState | undefined;
    host.jsSubscribe((s) => (last = s));
    const r = await host.jsCall(TRAIN, level([]), 'broken', []);
    expect(r.ok).toBe(false);
    expect(r.error?.line).toBe(13);
    expect(last?.error?.line).toBe(13);
    expect(last?.log).toMatch(/main\.js line 13: ReferenceError/);
  });

  it('jsStop terminates a running call', async () => {
    const host = new SimHost();
    const p = host.jsCall(TRAIN, level([]), 'forever', []);
    setTimeout(() => host.jsStop(), 150);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Stopped/);
  });

  it('runTests runs every js test with the source', async () => {
    const host = new SimHost();
    const seen: CaseResult[] = [];
    const res = await host.runTests(
      level([
        { kind: 'js', entry: 'train', args: [100], metric: { name: 'loss', max: 0.001 } } as TestSpec,
        { kind: 'js', entry: 'train', args: [2], metric: { name: 'loss', max: 0.001 } } as TestSpec,
      ]),
      (c) => {
        seen.push(c);
      },
      undefined,
      undefined,
      TRAIN,
    );
    expect(res).toEqual({ passed: 1, total: 2 });
    expect(seen.map((c) => [c.test, c.kind, c.pass])).toEqual([[0, 'js', true], [1, 'js', false]]);
  });
});

describe('SimHost JsApi: Debug this test', () => {
  const tests = [
    { kind: 'js', entry: 'train', args: [30], metric: { name: 'loss', max: 0.0001 }, seed: 1, tolerance: 1e-6, timeoutMs: 10_000 },
    { kind: 'js', entry: 'vec', args: [3], expect: [0, 1, 3], seed: 7, tolerance: 1e-6, timeoutMs: 10_000 },
  ] as TestSpec[];
  const SRC = `${TRAIN}\nexport function vec(n) { console.log('seed', Math.random().toFixed(3)); return Array.from({ length: n }, (_, i) => i); }\n`;

  it('runs only that test with its args and seed, and judges it with a full diff', async () => {
    const host = new SimHost();
    const states: JsRunState[] = [];
    host.jsSubscribe((s) => states.push(s));
    const r = await host.jsDebugCall(SRC, level(tests), 1);
    expect(r?.ok).toBe(true);
    expect(r?.test).toBe(1);
    expect(r?.verdict?.pass).toBe(false);
    expect(r?.verdict?.detail?.mismatches.map((m) => m.message)).toEqual(['result[2]: expected 3 ± 1e-6, got 2']);
    expect(r?.verdict?.detail?.diff?.kind).toBe('tensor');
    const last = states.at(-1)!;
    expect(last.test?.index).toBe(1);
    expect(last.test?.verdict?.pass).toBe(false);
    // Same seed as the checker: same log.
    const again = await host.jsDebugCall(SRC, level(tests), 1);
    expect(states.at(-1)!.log).toBe(last.log);
    expect(again?.verdict?.message).toBe(r?.verdict?.message);
  });

  it('reports the metric value and keeps the loss curve', async () => {
    const host = new SimHost();
    const states: JsRunState[] = [];
    host.jsSubscribe((s) => states.push(s));
    const r = await host.jsDebugCall(SRC, level(tests), 0);
    expect(r?.verdict?.detail?.metric).toMatchObject({ name: 'loss', max: 0.0001, ok: false });
    expect(states.at(-1)!.samples).toHaveLength(30);
  });

  it('returns null for a test that is not a js test', async () => {
    const host = new SimHost();
    expect(await host.jsDebugCall(SRC, level(tests), 9)).toBeNull();
  });
});
