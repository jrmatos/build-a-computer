/**
 * Running community levels against boards off the main thread (COM-02, COM-03).
 * A dedicated simulation worker, separate from the live one, so checking a
 * pack never disturbs the player's board. The rules are written against the
 * small `CheckHost` surface so tests drive SimHost directly.
 */
import type { Board, ChipMap, Level, TruthRow } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';

/** What the checks need from a simulation host (SimHost, or its Comlink remote). */
export interface CheckHost {
  load(board: Board, chips?: ChipMap, opts?: { power?: 'zero' | 'random' }): unknown;
  runTests(level: Level, onCase: (r: CaseResult) => void, board?: Board, budgetMs?: number, source?: string): Promise<{ passed: number; total: number }> | { passed: number; total: number };
}

export interface RunResult {
  passed: number;
  total: number;
  cases: CaseResult[];
}

export type Wrap = (cb: (r: CaseResult) => void) => (r: CaseResult) => void;

const BUDGET_MS = 10_000;

/** Run every test of `level` on `board` (board levels) or `source` (code levels). */
export async function runOn(host: CheckHost, level: Level, solution: { board?: Board; source?: string }, chips: ChipMap, wrap: Wrap = (cb) => cb): Promise<RunResult> {
  const cases: CaseResult[] = [];
  const onCase = wrap((c) => void cases.push(c));
  if (level.mode === 'code') {
    const r = await host.runTests(level, onCase, undefined, BUDGET_MS, solution.source ?? '');
    return { ...r, cases };
  }
  const board = solution.board ?? level.starter;
  await host.load(board, chips, { power: level.power });
  const r = await host.runTests(level, onCase, board, BUDGET_MS);
  return { ...r, cases };
}

export interface LevelCheck {
  /** The reference solution passes every test. */
  referencePasses: boolean;
  /** The empty starter (or starter source) fails at least one test. */
  emptyFails: boolean;
  reference: RunResult;
  empty: RunResult;
  ok: boolean;
  /** First problem in plain words, when not ok. */
  problem?: string;
}

const allPass = (r: RunResult) => r.total > 0 && r.passed === r.total;

/** The COM-02 publishing rule: the reference must pass and an empty solution must fail. */
export async function checkLevel(host: CheckHost, level: Level, solution: { board?: Board; source?: string }, chips: ChipMap, wrap?: Wrap): Promise<LevelCheck> {
  const reference = await runOn(host, level, solution, chips, wrap);
  const emptySolution = level.mode === 'code' ? { source: level.code?.starter ?? '' } : { board: level.starter };
  const empty = await runOn(host, level, emptySolution, chips, wrap);
  const referencePasses = allPass(reference);
  const emptyFails = !allPass(empty);
  let problem: string | undefined;
  if (!referencePasses) {
    const bad = reference.cases.find((c) => !c.pass);
    problem = reference.total === 0 ? 'The level has no test cases.' : `The reference solution fails ${reference.total - reference.passed} of ${reference.total} cases${bad?.message ? `: ${bad.message}` : '.'}`;
  } else if (!emptyFails) problem = 'An empty solution passes every test: the tests check nothing.';
  return { referencePasses, emptyFails, reference, empty, ok: referencePasses && emptyFails, ...(problem ? { problem } : {}) };
}

/**
 * Expected outputs for `inputs` rows, read from the reference board: each row
 * runs as a truth-table case expecting 0, and the actual values become the
 * expectation. Returns null for a row whose output is unknown (X) or missing.
 */
export async function probeRows(host: CheckHost, board: Board, chips: ChipMap, inputs: Record<string, number>[], outputs: string[], wrap?: Wrap): Promise<(TruthRow | null)[]> {
  const zero = Object.fromEntries(outputs.map((o) => [o, 0]));
  const probe = {
    id: 'probe',
    version: 1,
    track: 'nand-to-os',
    phase: 0,
    order: 0,
    title: 'probe',
    goal: 'probe',
    tutorial: '',
    hints: [],
    afterword: '',
    palette: [],
    starter: board,
    tests: [{ kind: 'truth-table', rows: inputs.map((i) => ({ inputs: i, expect: zero })) }],
    requires: [],
    resources: [],
    power: 'zero',
    mode: 'board',
    optional: false,
    draft: false,
  } satisfies Level;
  const r = await runOn(host, probe, { board }, chips, wrap);
  return inputs.map((inp, i) => {
    const c = r.cases.find((x) => x.index === i);
    const got = c?.actualNum;
    if (!got) return null;
    const expect: Record<string, number> = {};
    for (const o of outputs) {
      const v = got[o];
      if (v === null || v === undefined) return null;
      expect[o] = v;
    }
    return { inputs: inp, expect };
  });
}

// ---------------------------------------------------------------- worker

let host: Promise<{ host: CheckHost; wrap: Wrap }> | null = null;

/** The check worker (created on first use, kept for the session). */
export function checkWorker(): Promise<{ host: CheckHost; wrap: Wrap }> {
  host ??= import('comlink').then((Comlink) => {
    const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    const remote = Comlink.wrap<CheckHost>(worker) as unknown as CheckHost;
    return { host: remote, wrap: ((cb) => Comlink.proxy(cb)) as Wrap };
  });
  return host;
}
