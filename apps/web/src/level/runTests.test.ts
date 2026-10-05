import { describe, expect, it } from 'vitest';
import type { CaseResult } from '@build-a-computer/sim-logic';
import type { TestRun } from '../editor/store';
import { mergeCaseResult } from './runTests';

const c = (test: number, index: number, pass: boolean, extra: Partial<CaseResult> = {}): CaseResult => ({
  index,
  pass,
  inputs: {},
  expected: {},
  actual: {},
  test,
  ...extra,
});

describe('mergeCaseResult ("Run this case")', () => {
  it('replaces the same case of the run and recounts, leaving the rest alone', () => {
    const run: TestRun = { running: false, cases: [c(0, 0, true), c(0, 1, false), c(1, 0, true)], passed: 2, total: 3 };
    const next = mergeCaseResult(run, c(0, 1, true, { actual: { Y: '1' } }), 3);
    expect(next).toEqual({ running: false, cases: [c(0, 0, true), c(0, 1, true, { actual: { Y: '1' } }), c(1, 0, true)], passed: 3, total: 3 });
    expect(run.cases[1]!.pass).toBe(false);
  });

  it('starts a run from nothing with only that case', () => {
    expect(mergeCaseResult(null, c(2, 5, false), 40)).toEqual({ running: false, cases: [c(2, 5, false)], passed: 0, total: 40 });
  });

  it('inserts a case the run never reached in test/case order', () => {
    const run: TestRun = { running: false, cases: [c(0, 0, true), c(1, 3, true)], passed: 2, total: 10 };
    const next = mergeCaseResult(run, c(1, 1, false), 10);
    expect(next.cases.map((x) => [x.test, x.index])).toEqual([[0, 0], [1, 1], [1, 3]]);
    expect(mergeCaseResult(next, c(2, 0, true), 10).cases.at(-1)).toEqual(c(2, 0, true));
    expect(next.passed).toBe(2);
  });

  it('sequence cases match by step', () => {
    const seq = (step: number, pass: boolean) => c(0, step, pass, { kind: 'sequence', step });
    const run: TestRun = { running: false, cases: [seq(0, true), seq(1, false)], passed: 1, total: 2 };
    const next = mergeCaseResult(run, seq(1, true), 2);
    expect(next.cases).toEqual([seq(0, true), seq(1, true)]);
    expect(next.passed).toBe(2);
  });

  it('keeps the larger total and stops "running"', () => {
    const run: TestRun = { running: true, cases: [], passed: 0, total: 12 };
    expect(mergeCaseResult(run, c(0, 0, true), 8)).toMatchObject({ running: false, total: 12, passed: 1 });
  });
});

describe('case Run registry', () => {
  it('registers per kind and unregisters only its own handler', async () => {
    const { registerCaseRun, getCaseRun } = await import('./panels/caseRun');
    const a = () => undefined;
    const b = () => undefined;
    const offA = registerCaseRun(['truth-table', 'sequence'], a);
    const offB = registerCaseRun(['sequence'], b);
    expect(getCaseRun('truth-table')).toBe(a);
    expect(getCaseRun('sequence')).toBe(b);
    offA();
    expect(getCaseRun('truth-table')).toBeUndefined();
    expect(getCaseRun('sequence')).toBe(b);
    offB();
    expect(getCaseRun('sequence')).toBeUndefined();
    expect(getCaseRun(undefined)).toBeUndefined();
  });
});
