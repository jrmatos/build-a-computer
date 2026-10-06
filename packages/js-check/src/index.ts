import type { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { NAN_MESSAGE, checkMetric, compareValues, findNonFinite } from './compare';
import { diffValues, listMismatches, metricDetail, type JsCaseDetail } from './diff';
import { describeError, startJs, type DatasetProvider, type JsError, type JsOutcome, type SandboxRunner } from './runner';
import type { MlSample } from './protocol';

export * from './compare';
export * from './diff';
export * from './runner';
export type { DatasetMeta, DeviceInfo, GpuMode, MlSample } from './protocol';
export { toSafe, isTensorLike } from './serialize';
export { transformModule, buildBundle, mapStack, tokenize, type TransformError } from './transform';

export type JsTestSpec = Extract<TestSpec, { kind: 'js' }>;

export interface RunJsTestOptions {
  /** Sandbox runner; default: Node worker_threads in Node, a Web Worker in browsers. */
  runner?: SandboxRunner | Promise<SandboxRunner>;
  /** Datasets for the 'data' module (the level's js.datasets ids). */
  datasets?: DatasetProvider;
  onLog?(text: string): void;
  onSamples?(samples: MlSample[]): void;
}

/** Short JSON preview of a result for the results table. */
function preview(v: unknown): string {
  const s = JSON.stringify(v, (_k, x: unknown) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x));
  if (s === undefined) return String(v);
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}

const fmtMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${Math.round(ms / 100) / 10} s`);

/**
 * Track 2 checker: runs the player's main.js in the sandbox (no network, time
 * limit, seeded Math.random — ASM-05), calls `test.entry(...test.args)` and
 * checks the result:
 * - `expect`: deep equality, numbers within `tolerance` (E-ML-02), tensors as {shape, data};
 * - `metric`: result[metric.name] within [min, max];
 * - neither: the call must finish without an error.
 * NaN or Infinity where a number was expected fails with the E-ML-03 hint.
 * Always resolves with exactly one CaseResult (kind 'js').
 */
export async function runJsTest(source: string, test: JsTestSpec, level: Level, opts: RunJsTestOptions = {}): Promise<JsCaseResult> {
  const samples: SampleInfo = { count: 0 };
  const run = startJs(
    { source, level, entry: test.entry, args: test.args ?? [], seed: test.seed ?? 1, timeoutMs: test.timeoutMs ?? 10_000 },
    {
      ...(opts.runner ? { runner: opts.runner } : {}),
      ...(opts.datasets ? { datasets: opts.datasets } : {}),
      onLog: (t) => opts.onLog?.(t),
      onSamples: (s) => {
        samples.count += s.length;
        samples.last = s[s.length - 1] ?? samples.last;
        opts.onSamples?.(s);
      },
    },
  );
  return judgeJs(await run.done, test, samples);
}

/** A 'js' case result with the structured expected-vs-actual detail. */
export interface JsCaseResult extends CaseResult {
  /** What was checked, with the actual values (absent when the call failed). */
  detail?: JsCaseDetail;
}

/** report() samples seen during a run, for the summary. */
export interface SampleInfo {
  count: number;
  last?: MlSample;
}

/** Cases' detail lists at most this many mismatches (the debugger gets the full tree). */
const CASE_MISMATCHES = 20;

/**
 * Judge a finished call against a 'js' test, exactly as the checker does
 * (`runJsTest` and the worker's "Debug this test" both use it). The detail's
 * diff tree is kept only when `fullDiff` is set (it can be large).
 */
export function judgeJs(out: JsOutcome, test: JsTestSpec, samples: SampleInfo = { count: 0 }, fullDiff = false): JsCaseResult {
  const name = test.name ?? `${test.entry}(${(test.args ?? []).map((a) => preview(a)).join(', ')})`;
  const last = samples.last;
  const lastValues = last ? Object.entries(last.values).map(([k, v]) => `${k} ${Number(v.toPrecision(4))}`).join(', ') : '';
  const summary = `${out.ok ? 'Returned' : 'Stopped'} after ${fmtMs(out.ms)}${samples.count ? `; ${samples.count} report() samples, last: ${lastValues}` : ''}.`;
  const base: JsCaseResult = { index: 0, pass: false, inputs: {}, expected: {}, actual: {}, kind: 'js', summary };
  if (!out.ok) {
    const e = out.error as JsError;
    return { ...base, message: `${name}: ${describeError(e)}${e.kind === 'nan' ? '.' : ''}`, actual: { error: e.message } };
  }
  const result = out.result;
  const actual = { result: preview(result) };
  if (test.metric) {
    const r = checkMetric(result, test.metric);
    const detail: JsCaseDetail = { mismatches: r.ok ? [] : [{ path: r.path ?? 'result', message: r.message ?? '' }], metric: metricDetail(result, test.metric) };
    return { ...base, pass: r.ok, actual, detail, message: `${name}: ${r.message ?? ''}`.trim() };
  }
  if (test.expect !== undefined) {
    const tolerance = test.tolerance ?? 1e-6;
    const r = compareValues(result, test.expect, tolerance);
    const diff = diffValues(result, test.expect, tolerance);
    const detail: JsCaseDetail = { mismatches: listMismatches(diff, fullDiff ? undefined : CASE_MISMATCHES), ...(fullDiff ? { diff } : {}) };
    if (r.ok) return { ...base, pass: true, actual, detail, message: `${name} returned the expected value.` };
    return { ...base, actual, detail, message: r.nonFinite ? `${name}: ${r.message}. ${NAN_MESSAGE}.` : `${name}: ${r.message}` };
  }
  const bad = findNonFinite(result);
  if (bad) return { ...base, actual, detail: { mismatches: [{ path: bad, message: `${bad} is not a finite number` }], nonFinite: bad }, message: `${name}: ${bad} is not a finite number. ${NAN_MESSAGE}.` };
  return { ...base, pass: true, actual, detail: { mismatches: [] }, message: `${name} ran without errors.` };
}
