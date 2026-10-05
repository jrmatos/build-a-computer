/**
 * Pure model behind the case debugger: which case a strip column is, how an
 * output compares bit by bit, the plain-English "why", moving between cases
 * and failures, and moving through a case's timeline. No DOM, no worker.
 */
import type { CaseResult, DebugCheck, DebugFrame, DebugTrace } from '@build-a-computer/sim-logic';
import { t } from '../../i18n';
import { formatNum, type Port, type StripPlan, type TestKind } from '../testStripModel';

type Values = Record<string, number>;

/** One case to debug: where it sits in the strip and what the worker needs to reproduce it. */
export interface CaseTarget {
  /** Strip column. */
  column: number;
  /** Index into level.tests. */
  test: number;
  /** Case index within the test (sequence: the step). */
  index: number;
  kind: TestKind;
  /** Inputs (needed for exhaustive and random cases). */
  inputs?: Values;
}

/** Board kinds the debugger can replay. */
export const DEBUGGABLE: ReadonlySet<TestKind> = new Set<TestKind>(['truth-table', 'exhaustive', 'random', 'sequence', 'program']);

/** The case behind strip column `column`, or null when it cannot be debugged on a board. */
export function caseTarget(plan: StripPlan, column: number, result?: CaseResult): CaseTarget | null {
  if (column < 0 || column >= plan.count) return null;
  const c = plan.column(column);
  if (!DEBUGGABLE.has(c.kind)) return null;
  const fromResult = result?.inputs && Object.keys(result.inputs).length ? result.inputs : undefined;
  const inputs = c.kind === 'exhaustive' || c.kind === 'random' ? (c.inputs ?? fromResult) : c.inputs;
  return { column, test: c.test, index: c.index, kind: c.kind, ...(inputs ? { inputs } : {}) };
}

/** Binary digits of `v`, most significant first. */
export const bits = (v: number, width: number): string => (v >>> 0).toString(2).padStart(Math.max(1, width), '0').slice(-Math.max(1, width));

/** Bit-level comparison: both values in binary and the positions (0 = least significant) that differ. */
export function bitDiff(want: number, got: number, width: number): { want: string; got: string; differ: number[] } {
  const x = (want ^ got) >>> 0;
  const differ: number[] = [];
  for (let b = 0; b < Math.min(32, width); b++) if ((x >>> b) & 1) differ.push(b);
  return { want: bits(want, width), got: bits(got, width), differ };
}

export type Verdict = 'ok' | 'wrong' | 'unknown' | 'unchecked';

export interface OutputVerdict {
  label: string;
  width: number;
  want?: number;
  /** null: unknown (X) or missing. */
  got: number | null | undefined;
  status: Verdict;
  diff?: ReturnType<typeof bitDiff>;
}

/** Per-output ✓/✗ for one checkpoint, in port order (outputs the check does not test are 'unchecked'). */
export function outputVerdicts(check: DebugCheck | undefined, ports: readonly Port[]): OutputVerdict[] {
  return ports.map((p) => {
    const want = check?.expect[p.label];
    const got = check?.actual[p.label];
    if (want === undefined) return { label: p.label, width: p.width, got, status: 'unchecked' as const };
    if (got === null || got === undefined) return { label: p.label, width: p.width, want, got, status: 'unknown' as const };
    if (got >>> 0 === want >>> 0) return { label: p.label, width: p.width, want, got, status: 'ok' as const };
    return { label: p.label, width: p.width, want, got, status: 'wrong' as const, ...(p.width > 1 ? { diff: bitDiff(want, got, p.width) } : {}) };
  });
}

/** A value as the player reads it: 0/1 for one bit, decimal (and hex past 9) for buses. */
export function showValue(v: number | null | undefined, width: number): string {
  if (v === undefined) return '–';
  if (v === null) return 'X';
  if (width <= 1 || v < 10) return String(v >>> 0);
  return `${v >>> 0} (0x${formatNum(v, width, 'hex')})`;
}

/** "A=1, B=0 and C=1" */
export function listValues(values: Values, widths: ReadonlyMap<string, number>): string {
  const items = Object.entries(values).map(([k, v]) => `${k}=${showValue(v, widths.get(k) ?? 1)}`);
  return joinList(items);
}

export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${t('debug.and')} ${items[items.length - 1]}`;
}

/** What the timeline knows about a checkpoint's surroundings. */
export interface WhyContext {
  kind: TestKind;
  /** Inputs held at the checkpoint. */
  inputs: Values;
  widths: ReadonlyMap<string, number>;
  /** Sequence: what the step did (inputs it set, ticks, power cycle). */
  step?: { set: Values; ticks: number; power: boolean };
  /** Program: cycles run, and whether HALT went high. */
  cycles?: number;
  halted?: boolean;
}

/**
 * Plain-English reasons for a checkpoint: one sentence per wrong output
 * ("Y should be 1 when A=1 and B=0, but your circuit gives 0."), with the
 * wrong bits of wide values and a hint for unknown values.
 */
export function explain(check: DebugCheck | undefined, verdicts: readonly OutputVerdict[], ctx: WhyContext): string[] {
  if (!check) return [];
  const bad = verdicts.filter((v) => v.status === 'wrong' || v.status === 'unknown');
  if (!bad.length) return [check.pass ? t('debug.why.pass') : (check.message ?? t('debug.why.failed'))];
  const out: string[] = [];
  for (const v of bad) {
    const vars = {
      out: v.label,
      want: showValue(v.want, v.width),
      got: v.status === 'unknown' ? t('debug.why.x') : showValue(v.got, v.width),
    };
    let s: string;
    if (ctx.kind === 'sequence') {
      const what: string[] = [];
      if (ctx.step?.power) what.push(t('debug.why.powerCycle'));
      if (ctx.step && Object.keys(ctx.step.set).length) what.push(t('debug.why.setting', { list: listValues(ctx.step.set, ctx.widths) }));
      if (ctx.step?.ticks) what.push(t(ctx.step.ticks === 1 ? 'debug.why.tick' : 'debug.why.ticks', { n: ctx.step.ticks }));
      s = t(what.length ? 'debug.why.seq' : 'debug.why.seqBare', { ...vars, step: check.step + 1, what: joinList(what) });
    } else if (ctx.kind === 'program') {
      s = t(ctx.halted ? 'debug.why.programHalted' : 'debug.why.program', { ...vars, cycles: (ctx.cycles ?? 0).toLocaleString() });
    } else {
      s = Object.keys(ctx.inputs).length ? t('debug.why.comb', { ...vars, conds: listValues(ctx.inputs, ctx.widths) }) : t('debug.why.combBare', vars);
    }
    if (v.diff?.differ.length) {
      const list = joinList([...v.diff.differ].reverse().map(String));
      s += ` ${t(v.diff.differ.length === 1 ? 'debug.why.bit' : 'debug.why.bits', { list })}`;
    }
    out.push(s);
  }
  if (bad.some((v) => v.status === 'unknown')) {
    // A missing output reads as unknown too: the checker's message says which.
    out.push(check.message && /missing/i.test(check.message) ? check.message : t('debug.why.xHint'));
  } else if (check.message && !/^Output /.test(check.message)) out.push(check.message);
  return out;
}

/** Next case from `from` in direction `dir`, or the next failing one when `onlyFailing`. Null when there is none. */
export function neighborCase(
  results: readonly (CaseResult | undefined)[],
  count: number,
  from: number,
  dir: 1 | -1,
  onlyFailing: boolean,
): number | null {
  if (!onlyFailing) {
    const n = from + dir;
    return n >= 0 && n < count ? n : null;
  }
  for (let i = from + dir; i >= 0 && i < count; i += dir) {
    const r = results[i];
    if (r && !r.pass) return i;
  }
  return null;
}

/** Position of `column` among the failing cases (1-based rank; 0 when it passes) and how many fail. */
export function failureRank(results: readonly (CaseResult | undefined)[], column: number): { rank: number; total: number } {
  let total = 0;
  let rank = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r || r.pass) continue;
    total++;
    if (i === column) rank = total;
  }
  return { rank, total };
}

/**
 * Index of the checkpoint shown for `frame`: the next one at or after it (what
 * the circuit is heading for), else the last one.
 */
export function checkFor(trace: Pick<DebugTrace, 'checks'>, frame: number): number {
  const k = trace.checks.findIndex((c) => c.frame >= frame);
  return k >= 0 ? k : Math.max(0, trace.checks.length - 1);
}

/** Frame one full clock cycle (2 ticks) away, stopping at a power cycle. */
export function cycleTarget(frames: readonly DebugFrame[], from: number, dir: 1 | -1): number {
  const cur = frames[from];
  if (!cur) return Math.max(0, Math.min(from, frames.length - 1));
  if (dir > 0) {
    for (let j = from + 1; j < frames.length; j++) {
      const f = frames[j]!;
      if (f.cause === 'cycle' || f.tick >= cur.tick + 2) return j;
    }
    return frames.length - 1;
  }
  for (let j = from - 1; j >= 0; j--) {
    const f = frames[j]!;
    if (f.cause === 'cycle' || f.cause === 'power' || f.tick <= cur.tick - 2) return j;
  }
  return 0;
}

/** Input values held at `frame`, from the recorded series. */
export function valuesAt(trace: Pick<DebugTrace, 'series'>, labels: readonly string[], frame: number): Values {
  const out: Values = {};
  for (const l of labels) {
    const v = trace.series[l]?.[frame];
    if (typeof v === 'number') out[l] = v;
  }
  return out;
}

/** Label for a frame: "Tick 4 · step 2" and what happened there. */
export function describeFrame(frame: DebugFrame | undefined, kind: TestKind): string {
  if (!frame) return '';
  const cause = t(`debug.frame.${frame.cause}`);
  if (kind === 'sequence') return t('debug.frame.seq', { tick: frame.tick, step: frame.step + 1, cause });
  if (kind === 'program') return t('debug.frame.program', { tick: frame.tick, cycle: Math.floor(frame.tick / 2), cause });
  return cause;
}
