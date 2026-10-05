/**
 * Pure model behind the test strip (TestStrip.tsx): which columns a level's
 * tests produce, the input vectors each column uses, how streamed results land
 * on columns, and how a value is drawn (leaf, number pill, unknown, empty).
 * No DOM, no worker: everything here is unit tested.
 */
import { Prng } from '@build-a-computer/det';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { REFERENCES, REFERENCE_SIGNATURES } from '@build-a-computer/sim-logic';
import type { Level, TestSpec } from '@build-a-computer/schema';

export type TestKind = TestSpec['kind'];
type Values = Record<string, number>;

/** A labelled input or output and its width in bits. */
export interface Port {
  label: string;
  width: number;
}

/** One column of the strip: one test case (a truth row, a vector, a sequence checkpoint, a program run). */
export interface PlanColumn {
  /** Index of the test in level.tests. */
  test: number;
  kind: TestKind;
  /** Case index within its test (what the checker reports as `index`). */
  index: number;
  /** Inputs the checker sets; undefined when not derivable before the run (random). */
  inputs?: Values;
  /** Expected outputs; undefined when not derivable before the run. */
  expect?: Values;
  /** sequence: step index in test.steps this column checks, and ticks run since the previous column. */
  step?: number;
  ticks?: number;
  /** sequence: a power cycle happens before this check. */
  power?: boolean;
  /** program: cycle budget. */
  maxCycles?: number;
}

export interface TestSegment {
  kind: TestKind;
  start: number;
  count: number;
}

export interface StripPlan {
  /** Total columns over every test. */
  count: number;
  segments: TestSegment[];
  inputs: Port[];
  outputs: Port[];
  /** Column i, built lazily (exhaustive 16-bit tests have 65,536 columns). */
  column: (i: number) => PlanColumn;
}

/** Largest exhaustive input space the strip enumerates (the schema caps inputs at 16 bits). */
const MAX_EXHAUSTIVE_BITS = 16;

/** Port widths declared by the level's starter board (labelled switches and lamps), falling back to references. */
export function portWidths(level: Pick<Level, 'starter' | 'tests'>): Map<string, number> {
  const widths = new Map<string, number>();
  for (const test of level.tests) {
    if (test.kind === 'riscv') {
      // Registers are 32 bits wide.
      for (const r of [...Object.keys(test.setup?.regs ?? {}), ...Object.keys(test.expect.regs ?? {})]) widths.set(r, 32);
      continue;
    }
    if (test.kind !== 'exhaustive' && test.kind !== 'random') continue;
    type Sig = { inputs: { name: string; width: number }[]; outputs: { name: string; width: number }[] };
    const sig = (REFERENCE_SIGNATURES as Record<string, Sig | undefined>)[test.reference];
    if (!sig) continue;
    for (const p of [...sig.inputs, ...sig.outputs]) widths.set(p.name, p.width);
  }
  for (const part of level.starter.parts) {
    if (!part.label) continue;
    if (part.type === 'switch' || part.type === 'lamp' || part.type === 'button') widths.set(part.label, part.props?.width ?? 1);
  }
  return widths;
}

/** Input vector `i` of an exhaustive test: the first input is the most significant, the last counts fastest. */
export function exhaustiveVector(ports: Port[], i: number): Values {
  const out: Values = {};
  let div = 1;
  for (let k = ports.length - 1; k >= 0; k--) {
    const p = ports[k]!;
    const size = 2 ** p.width;
    out[p.label] = Math.floor(i / div) % size;
    div *= size;
  }
  return out;
}

export function exhaustiveCount(ports: Port[]): number {
  const bits = ports.reduce((n, p) => n + p.width, 0);
  return bits > MAX_EXHAUSTIVE_BITS ? 0 : 2 ** bits;
}

/** Sequence columns: one per step (the checker reports every step), with the inputs held at that step. */
export function sequenceColumns(test: Extract<TestSpec, { kind: 'sequence' }>, testIndex: number): PlanColumn[] {
  const state: Values = {};
  return test.steps.map((s, step) => {
    Object.assign(state, s.set ?? {});
    return {
      test: testIndex,
      kind: 'sequence' as const,
      index: step,
      inputs: { ...state },
      ...(s.expect ? { expect: s.expect } : {}),
      step,
      ticks: s.ticks ?? 0,
      ...(s.power === 'cycle' ? { power: true } : {}),
    };
  });
}

/** Random vectors exactly as the checker draws them: one seeded nextU32 per input, masked to its width. */
export function randomVectors(ports: Port[], count: number, seed: number): Values[] {
  const prng = new Prng(seed);
  const out: Values[] = [];
  for (let i = 0; i < count; i++) {
    const v: Values = {};
    for (const p of ports) v[p.label] = (prng.nextU32() & (p.width >= 32 ? 0xffffffff : 2 ** p.width - 1)) >>> 0;
    out.push(v);
  }
  return out;
}

function reference(name: string): ((v: Values) => Values) | undefined {
  return (REFERENCES as Record<string, ((v: Values) => Values) | undefined>)[name];
}

function pick(v: Values | undefined, keys: string[]): Values | undefined {
  if (!v) return undefined;
  const out: Values = {};
  for (const k of keys) if (v[k] !== undefined) out[k] = v[k]!;
  return out;
}

/** Build the strip's columns and rows from a level's tests. */
export function planStrip(level: Pick<Level, 'starter' | 'tests'>): StripPlan {
  const widths = portWidths(level);
  const ins: string[] = [];
  const outs: string[] = [];
  const addIn = (k: string) => !ins.includes(k) && ins.push(k);
  const addOut = (k: string) => !outs.includes(k) && outs.push(k);
  const port = (label: string): Port => ({ label, width: widths.get(label) ?? 1 });

  const segments: TestSegment[] = [];
  const makers: ((i: number) => PlanColumn)[] = [];
  let start = 0;
  level.tests.forEach((test, ti) => {
    let count = 0;
    let make: (i: number) => PlanColumn;
    switch (test.kind) {
      case 'truth-table': {
        for (const r of test.rows) {
          Object.keys(r.inputs).forEach(addIn);
          Object.keys(r.expect).forEach(addOut);
        }
        count = test.rows.length;
        make = (i) => ({ test: ti, kind: test.kind, index: i, inputs: test.rows[i]!.inputs, expect: test.rows[i]!.expect });
        break;
      }
      case 'exhaustive': {
        test.inputs.forEach(addIn);
        test.outputs.forEach(addOut);
        const ports = test.inputs.map(port);
        const ref = reference(test.reference);
        count = exhaustiveCount(ports);
        make = (i) => {
          const inputs = exhaustiveVector(ports, i);
          const expect = pick(ref?.(inputs), test.outputs);
          return { test: ti, kind: test.kind, index: i, inputs, ...(expect ? { expect } : {}) };
        };
        break;
      }
      case 'random': {
        test.inputs.forEach(addIn);
        test.outputs.forEach(addOut);
        count = test.count ?? 1000;
        const ports = test.inputs.map(port);
        const ref = reference(test.reference);
        let vectors: Values[] | undefined;
        make = (i) => {
          vectors ??= randomVectors(ports, count, test.seed ?? 1);
          const inputs = vectors[i]!;
          const expect = pick(ref?.(inputs), test.outputs);
          return { test: ti, kind: test.kind, index: i, inputs, ...(expect ? { expect } : {}) };
        };
        break;
      }
      case 'sequence': {
        for (const s of test.steps) {
          Object.keys(s.set ?? {}).forEach(addIn);
          Object.keys(s.expect ?? {}).forEach(addOut);
        }
        const cols = sequenceColumns(test, ti);
        count = cols.length;
        make = (i) => cols[i]!;
        break;
      }
      case 'program': {
        Object.keys(test.set ?? {}).forEach(addIn);
        Object.keys(test.expect).forEach(addOut);
        count = 1;
        make = (i) => ({
          test: ti,
          kind: test.kind,
          index: i,
          inputs: test.set ?? {},
          expect: test.expect,
          maxCycles: test.maxCycles,
        });
        break;
      }
      case 'riscv': {
        // One column per program run; the code-level UI owns the detailed view.
        Object.keys(test.expect.regs ?? {}).forEach(addOut);
        count = 1;
        make = (i) => ({ test: ti, kind: test.kind, index: i, inputs: test.setup?.regs ?? {}, expect: test.expect.regs ?? {} });
        break;
      }
    }
    segments.push({ kind: test.kind, start, count });
    makers.push(make);
    start += count;
  });

  const cache = new Map<number, PlanColumn>();
  return {
    count: start,
    segments,
    inputs: ins.map(port),
    outputs: outs.map(port),
    column: (i) => {
      let c = cache.get(i);
      if (c) return c;
      let s = segments.length - 1;
      while (s > 0 && segments[s]!.start > i) s--;
      c = makers[s]!(i - segments[s]!.start);
      if (cache.size > 4096) cache.clear();
      cache.set(i, c);
      return c;
    },
  };
}

/** A streamed result (CaseResult carries kind, test, step, cycle and actualNum when the checker sets them). */
export type StreamedCase = CaseResult;

/**
 * Place streamed results on columns. Results arrive in test order; a test ends
 * after its planned count, or earlier when a result's `index` restarts or its
 * `kind` changes. Sequence results with `step` land on that step's column.
 * Returns results by column, and `extra` for results past the plan.
 */
export function assignResults(plan: StripPlan, cases: readonly StreamedCase[]): { byColumn: (StreamedCase | undefined)[]; extra: StreamedCase[] } {
  const byColumn: (StreamedCase | undefined)[] = new Array(plan.count);
  const extra: StreamedCase[] = [];
  let seg = 0;
  let k = 0;
  let lastIndex = -1;
  for (const c of cases) {
    // The worker tags each result with its test: place it directly.
    if (typeof c.test === 'number') {
      const s = plan.segments[c.test];
      const at = s && s.kind === 'sequence' && typeof c.step === 'number' ? c.step : c.index;
      if (s && at >= 0 && at < s.count) byColumn[s.start + at] = c;
      else extra.push(c);
      continue;
    }
    // Advance to the next test when this one is full or the result clearly starts a new test.
    while (seg < plan.segments.length) {
      const s = plan.segments[seg]!;
      const restarted = k > 0 && typeof c.index === 'number' && c.index <= lastIndex && s.kind !== 'sequence';
      const otherKind = typeof c.kind === 'string' && c.kind !== s.kind && plan.segments.slice(seg + 1).some((n) => n.kind === c.kind);
      if (k >= s.count || restarted || otherKind) {
        seg++;
        k = 0;
        lastIndex = -1;
      } else break;
    }
    const s = plan.segments[seg];
    if (!s) {
      extra.push(c);
      continue;
    }
    let col = s.start + k;
    if (s.kind === 'sequence' && typeof c.step === 'number') {
      for (let j = 0; j < s.count; j++)
        if (plan.column(s.start + j).step === c.step) {
          col = s.start + j;
          break;
        }
    }
    byColumn[col] = c;
    k++;
    lastIndex = typeof c.index === 'number' ? c.index : lastIndex + 1;
  }
  return { byColumn, extra };
}

/** How one value is drawn. */
export type Cell =
  | { kind: 'empty' }
  | { kind: 'leaf'; bit: 0 | 1 }
  | { kind: 'unknown' }
  | { kind: 'num'; value: number };

/** Parse an `actual` string from a checker: '0', '1', 'X', a decimal or 0x-hex number, anything with X is unknown. */
export function parseActual(s: string | undefined): number | 'x' | undefined {
  if (s === undefined || s === '') return undefined;
  if (/[xXzZ?]/.test(s) && !/^0x[0-9a-f]+$/i.test(s)) return 'x';
  const n = /^0x/i.test(s) ? parseInt(s.slice(2), 16) : /^[01]+$/.test(s) && s.length > 1 ? parseInt(s, 2) : Number(s);
  return Number.isFinite(n) ? n >>> 0 : 'x';
}

/** The cell for a value on a port of `width` bits. */
export function cellFor(value: number | 'x' | undefined, width: number): Cell {
  if (value === undefined) return { kind: 'empty' };
  if (value === 'x') return { kind: 'unknown' };
  if (width <= 1 && (value === 0 || value === 1)) return { kind: 'leaf', bit: value };
  return { kind: 'num', value };
}

/** Actual value of `label` in a result: numeric field first, then the string. */
export function actualValue(r: StreamedCase | undefined, label: string): number | 'x' | undefined {
  if (!r) return undefined;
  const n = r.actualNum?.[label];
  if (typeof n === 'number') return n >>> 0;
  if (n === null && r.actual?.[label] === undefined) return 'x';
  return parseActual(r.actual?.[label]);
}

export type ColumnState = 'pending' | 'active' | 'pass' | 'fail';

/** A column's state: its result if any, else active when it is the next one to run. */
export function columnState(result: StreamedCase | undefined, column: number, nextColumn: number, running: boolean): ColumnState {
  if (result) return result.pass ? 'pass' : 'fail';
  return running && column === nextColumn ? 'active' : 'pending';
}

/** Format a number pill. */
export function formatNum(n: number, width: number, radix: 'hex' | 'dec'): string {
  if (radix === 'dec') return String(n >>> 0);
  const digits = Math.max(1, Math.ceil(width / 4));
  return (n >>> 0).toString(16).toUpperCase().padStart(digits, '0');
}

/** Pixel width of a column holding these ports. */
export function columnWidth(ports: Port[], radix: 'hex' | 'dec'): number {
  let chars = 0;
  for (const p of ports) {
    if (p.width <= 1) continue;
    const c = radix === 'hex' ? Math.ceil(p.width / 4) : String(2 ** Math.min(p.width, 32) - 1).length;
    chars = Math.max(chars, c);
  }
  return chars === 0 ? 28 : Math.max(30, Math.round(chars * 7.4 + 14));
}

/** Estimated case count for a level (what the progress bar starts from). */
export function plannedTotal(level: Pick<Level, 'starter' | 'tests'> | null): number {
  return level ? planStrip(level).count : 0;
}
