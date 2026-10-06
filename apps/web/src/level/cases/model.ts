/**
 * Pure model behind the test cases view (TestCasesDialog.tsx): one row per
 * case for every test kind (truth tables, exhaustive and random vectors,
 * sequence steps, programs, code-level runs, Track 2 calls), the rule that
 * generated each test, the full spec of a case, the reasons it passed or
 * failed, search, and CSV. Rows are the test strip's columns (same plan,
 * same result placement), built lazily: an exhaustive 16-bit test has 65,536.
 */
import { disassembleAll } from '@build-a-computer/content';
import { disassemble } from '@build-a-computer/asm';
import type { CaseResult } from '@build-a-computer/sim-logic';
import type { Level, TestSpec } from '@build-a-computer/schema';
import { isBoardKind } from '@build-a-computer/platform-core';
import type { RvCheck } from '@build-a-computer/worker';
import { t } from '../../i18n';
import { caseChecks, caseDetail, checkLabel, checkLine, hex32, showReg } from '../panels/testDiff';
import { actualValue, formatNum, planStrip, type PlanColumn, type Port, type StripPlan, type TestKind } from '../testStripModel';

type Values = Record<string, number>;
type TestLevel = Pick<Level, 'starter' | 'tests'>;
type RiscvTest = Extract<TestSpec, { kind: 'riscv' }>;
type JsTest = Extract<TestSpec, { kind: 'js' }>;

export type Radix = 'hex' | 'dec';
export type CaseStatus = 'pass' | 'fail' | 'pending';
export type StatusFilter = 'all' | CaseStatus;

/** One test of the level, with how its cases are generated. */
export interface TestInfo {
  test: number;
  kind: TestKind;
  /** "Test 2" or the test's name. */
  title: string;
  /** "all 65,536 combinations of A, B (reference: adder8)". */
  rule: string;
  /** First row and row count. */
  start: number;
  count: number;
}

export type ColRole = 'test' | 'case' | 'in' | 'want' | 'got' | 'steps' | 'name' | 'expect' | 'actual' | 'status' | 'why';

export interface TableCol {
  id: string;
  role: ColRole;
  label: string;
  port?: Port;
}

export interface CaseTable {
  /** 'ports': one column per input/output (board tests). 'text': name/expectation/actual (code and JS tests). */
  layout: 'ports' | 'text';
  plan: StripPlan;
  count: number;
  tests: TestInfo[];
  /** Columns shown in the table. */
  columns: TableCol[];
  /** Columns in the CSV export (the table's, plus the reasons). */
  csvColumns: TableCol[];
  /** Any multi-bit value (the hex/dec toggle matters). */
  multiBit: boolean;
  /** Port widths by label. */
  widths: Map<string, number>;
}

/** One case: the plan's column, with its result when the tests have run. */
export interface CaseRow {
  i: number;
  test: number;
  index: number;
  kind: TestKind;
  plan: PlanColumn;
  result: CaseResult | undefined;
  inputs: Values | undefined;
  expect: Values | undefined;
}

/** One satisfied (ok) or broken check, as text. */
export interface Reason {
  ok: boolean;
  text: string;
}

/** One line of a case's spec. `block` values are multi-line (program listings, JSON). */
export interface SpecItem {
  label: string;
  value: string;
  block?: boolean;
}

export function testTitle(level: Pick<Level, 'tests'>, i: number): string {
  const test = level.tests[i];
  const name = test && (test.kind === 'riscv' || test.kind === 'js') ? test.name : undefined;
  return name ?? t('cases.testN', { n: i + 1 });
}

/** How a test's cases come about. */
export function testRule(test: TestSpec, ports: Port[] = []): string {
  switch (test.kind) {
    case 'truth-table':
      return t('cases.rule.truth-table', { n: test.rows.length.toLocaleString('en-US') });
    case 'exhaustive': {
      const bits = test.inputs.reduce((n, l) => n + (ports.find((p) => p.label === l)?.width ?? 1), 0);
      const inputs = test.inputs.join(', ');
      if (bits > 16) return t('cases.rule.exhaustiveTooBig', { inputs, ref: test.reference });
      return t('cases.rule.exhaustive', { n: (2 ** bits).toLocaleString('en-US'), inputs, ref: test.reference });
    }
    case 'random':
      return t('cases.rule.random', { n: (test.count ?? 1000).toLocaleString('en-US'), seed: test.seed ?? 1, ref: test.reference });
    case 'sequence':
      return t('cases.rule.sequence', { n: test.steps.length.toLocaleString('en-US'), checks: test.steps.filter((s) => s.expect && Object.keys(s.expect).length).length.toLocaleString('en-US') });
    case 'program':
      return t('cases.rule.program', { bytes: parseHexLoose(test.program).length, rom: test.rom ?? 'ROM', max: (test.maxCycles ?? 0).toLocaleString('en-US'), halt: test.halt ?? 'HALT' });
    case 'riscv':
      return t('cases.rule.riscv', { steps: (test.maxSteps ?? 5_000_000).toLocaleString('en-US') });
    case 'js':
      return t('cases.rule.js', { call: callText(test), ms: (test.timeoutMs ?? 10_000).toLocaleString('en-US'), seed: test.seed ?? 1 });
  }
}

/** Build the table for a level's tests. */
export function buildCaseTable(level: TestLevel): CaseTable {
  const plan = planStrip(level);
  const ports = [...plan.inputs, ...plan.outputs];
  const tests: TestInfo[] = level.tests.map((test, i) => ({
    test: i,
    kind: test.kind,
    title: testTitle(level, i),
    rule: testRule(test, ports),
    start: plan.segments[i]?.start ?? 0,
    count: plan.segments[i]?.count ?? 0,
  }));
  const text = level.tests.length > 0 && level.tests.every((x) => !isBoardKind(x.kind));
  const hasSteps = level.tests.some((x) => x.kind === 'sequence' || x.kind === 'program');
  let columns: TableCol[];
  if (text) {
    columns = [
      { id: 'test', role: 'test', label: t('cases.col.test') },
      { id: 'name', role: 'name', label: t('cases.col.name') },
      { id: 'expect', role: 'expect', label: t('cases.col.expect') },
      { id: 'actual', role: 'actual', label: t('cases.col.actual') },
      { id: 'status', role: 'status', label: t('cases.col.status') },
    ];
  } else {
    columns = [
      { id: 'test', role: 'test', label: t('cases.col.test') },
      { id: 'case', role: 'case', label: t('cases.col.case') },
      ...plan.inputs.map((p): TableCol => ({ id: `in:${p.label}`, role: 'in', label: p.label, port: p })),
      ...plan.outputs.map((p): TableCol => ({ id: `want:${p.label}`, role: 'want', label: p.label, port: p })),
      ...plan.outputs.map((p): TableCol => ({ id: `got:${p.label}`, role: 'got', label: p.label, port: p })),
      ...(hasSteps ? [{ id: 'steps', role: 'steps', label: t('cases.col.steps') } as TableCol] : []),
      { id: 'status', role: 'status', label: t('cases.col.status') },
    ];
  }
  const why: TableCol = { id: 'why', role: 'why', label: t('cases.col.why') };
  return {
    layout: text ? 'text' : 'ports',
    plan,
    count: plan.count,
    tests,
    columns,
    csvColumns: [...columns, why],
    multiBit: ports.some((p) => p.width > 1),
    widths: new Map(ports.map((p) => [p.label, p.width])),
  };
}

const nonEmpty = (v: Values | undefined): Values | undefined => (v && Object.keys(v).length ? v : undefined);

/** Row `i`, with its result (`byColumn` from assignResults). Streamed values win over the plan, as on the strip. */
export function caseRow(table: CaseTable, i: number, byColumn: readonly (CaseResult | undefined)[]): CaseRow {
  const plan = table.plan.column(i);
  const result = byColumn[i];
  return {
    i,
    test: plan.test,
    index: plan.index,
    kind: plan.kind,
    plan,
    result,
    inputs: nonEmpty(result?.inputs) ?? plan.inputs,
    expect: nonEmpty(result?.expected) ?? plan.expect,
  };
}

export function rowStatus(r: CaseRow): CaseStatus {
  return r.result ? (r.result.pass ? 'pass' : 'fail') : 'pending';
}

/** A value on a port: 1-bit as 0/1, wider in hex ("0x2A") or decimal. */
export function fmtValue(v: number | 'x' | undefined, width: number, radix: Radix): string {
  if (v === undefined) return '';
  if (v === 'x') return 'X';
  if (width <= 1 && (v === 0 || v === 1)) return String(v);
  return radix === 'hex' ? `0x${formatNum(v, width, 'hex')}` : String(v >>> 0);
}

/** "A=3, B=5" */
export function valuesText(v: Values | undefined, widths: Map<string, number>, radix: Radix): string {
  if (!v || !Object.keys(v).length) return t('cases.spec.none');
  // Port order (the table's), then any other label.
  const order = [...widths.keys()];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return Object.entries(v)
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([k, x]) => `${k} = ${fmtValue(x, widths.get(k) ?? (x > 1 ? 32 : 1), radix)}`)
    .join(', ');
}

/** Text with control characters as escapes: "hi\n", "\x1b[2J". */
export function escapeText(s: string): string {
  let out = '';
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c === '\\') out += '\\\\';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += c;
  }
  return out;
}

const quoteText = (s: string, max = 40): string => {
  const e = escapeText(s);
  return `"${e.length > max ? `${e.slice(0, max)}…` : e}"`;
};

/** Bytes of a hex string ("01 02 ff", "0x01,0x02"); bad digits are skipped. */
export function parseHexLoose(hex: string): number[] {
  const clean = hex.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

const hexBytes = (bytes: readonly number[], max = 64): string =>
  bytes
    .slice(0, max)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ') + (bytes.length > max ? ` … (${bytes.length} bytes)` : '');

const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

/** "1e-6" rather than "0.000001" (as js-check shows tolerances). */
export const showTolerance = (x: number): string => (x > 0 && x < 1e-3 ? x.toExponential() : String(x));

const fmtMetric = (v: number): string => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))));

export function metricRange(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return `[${fmtMetric(min)}, ${fmtMetric(max)}]`;
  if (min !== undefined) return `≥ ${fmtMetric(min)}`;
  if (max !== undefined) return `≤ ${fmtMetric(max)}`;
  return t('panels.test.anyValue');
}

const MARK = '\uE000';

/**
 * JSON for display: tensors ({shape, data}) as "tensor [2, 3] (6 values)",
 * long number arrays as "[784 numbers: 0, 0.5, …]", long strings cut.
 */
export function summarizeJson(value: unknown, pretty = false): string {
  const replacer = (_k: string, v: unknown): unknown => {
    if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { shape?: unknown }).shape) && Array.isArray((v as { data?: unknown }).data)) {
      const tv = v as { shape: number[]; data: unknown[] };
      return `${MARK}tensor [${tv.shape.join(', ')}] (${tv.data.length} values)${MARK}`;
    }
    if (Array.isArray(v) && v.length > 16 && v.every((x) => typeof x === 'number')) {
      const head = (v as number[]).slice(0, 4).map((x) => fmtMetric(x)).join(', ');
      return `${MARK}[${v.length} numbers: ${head}, …]${MARK}`;
    }
    if (typeof v === 'string' && v.length > 200) return `${v.slice(0, 200)}…`;
    if (typeof v === 'number' && !Number.isFinite(v)) return `${MARK}${String(v)}${MARK}`;
    return v;
  };
  const s = JSON.stringify(value, replacer, pretty ? 2 : undefined);
  if (s === undefined) return String(value);
  return s.replace(new RegExp(`"${MARK}(.*?)${MARK}"`, 'g'), '$1');
}

function callText(test: JsTest): string {
  const args = (test.args ?? []).map((a) => {
    const s = summarizeJson(a);
    return s.length > 40 ? `${s.slice(0, 39)}…` : s;
  });
  return `${test.entry}(${args.join(', ')})`;
}

/** Code and JS tests: the name shown in the table. */
export function caseName(level: Pick<Level, 'tests'>, row: CaseRow): string {
  const test = level.tests[row.test];
  if (test?.kind === 'js') return test.name ?? callText(test);
  return testTitle(level, row.test);
}

/** One-line expectation of a code or JS test. */
export function expectSummary(test: TestSpec | undefined): string {
  if (!test) return '';
  if (test.kind === 'riscv') {
    const e = test.expect;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(e.regs ?? {})) parts.push(`${k} = ${showReg(v)}`);
    if (e.exitCode !== undefined) parts.push(t('cases.exp.exit', { code: e.exitCode }));
    for (const m of e.memory ?? []) parts.push(t('cases.exp.mem', { addr: hex32(m.addr), n: parseHexLoose(m.hex).length }));
    if (e.uart !== undefined) parts.push(t('cases.exp.uart', { text: quoteText(e.uart) }));
    if (e.framebufferSha256) parts.push(t('cases.exp.fb', { hash: e.framebufferSha256.slice(0, 8) }));
    return parts.join('; ');
  }
  if (test.kind === 'js') {
    if (test.metric) return t('cases.exp.metric', { name: test.metric.name, range: metricRange(test.metric.min, test.metric.max) });
    if (test.expect !== undefined) {
      const v = summarizeJson(test.expect);
      return t('cases.exp.equals', { value: v.length > 80 ? `${v.slice(0, 79)}…` : v, tol: showTolerance(test.tolerance ?? 1e-6) });
    }
    return t('cases.spec.finite');
  }
  return '';
}

function checkActual(c: RvCheck): string {
  switch (c.kind) {
    case 'reg':
      return `${c.name} = ${showReg(c.actual)}`;
    case 'exit':
      return t('cases.exp.exit', { code: c.actual === null ? '–' : c.actual });
    case 'memory':
      return `${checkLabel(c)}: ${c.actual === null ? '–' : c.actual.split(' ').slice(0, 8).join(' ')}`;
    case 'uart':
      return t('cases.exp.uart', { text: quoteText(c.actual) });
    case 'framebuffer':
      return t('cases.exp.fb', { hash: (c.actual ?? '').slice(0, 8) });
  }
}

/** One-line actual outcome of a code or JS case (empty before a run). */
export function actualSummary(row: CaseRow): string {
  const r = row.result;
  if (!r) return '';
  const checks = caseChecks(r);
  if (checks?.length) return checks.map(checkActual).join('; ');
  const a = r.actual ?? {};
  if (a.result !== undefined) {
    const m = caseDetail(r)?.metric;
    return m ? `${m.name} = ${m.value === null ? 'NaN' : fmtMetric(m.value)}` : a.result;
  }
  if (a.error !== undefined) return a.error;
  return r.message?.split('\n')[0] ?? '';
}

/** Why a case passed or failed: every check, satisfied or not. Empty before a run. */
export function caseReasons(level: TestLevel, row: CaseRow, radix: Radix = 'dec', widths?: Map<string, number>): Reason[] {
  const r = row.result;
  if (!r) return [];
  const test = level.tests[row.test];
  const out: Reason[] = [];
  if (row.kind === 'riscv' || test?.kind === 'riscv') {
    const checks = caseChecks(r);
    if (checks?.length) {
      for (const c of checks) out.push(c.ok ? { ok: true, text: checkOk(c) } : { ok: false, text: t('cases.why.bad', { text: checkLine(c) }) });
      if (!r.pass && out.every((x) => x.ok) && r.message) out.push({ ok: false, text: r.message });
      return out;
    }
    return r.message ? [{ ok: r.pass, text: r.message }] : [];
  }
  if (row.kind === 'js' || test?.kind === 'js') {
    const d = caseDetail(r);
    const jt = test?.kind === 'js' ? test : undefined;
    if (d?.metric) {
      const m = d.metric;
      const value = m.value === null ? 'NaN' : fmtMetric(m.value);
      const range = metricRange(m.min, m.max);
      out.push({ ok: m.ok, text: t(m.ok ? 'cases.why.metric' : 'cases.why.metricBad', { name: m.name, value, range }) });
    } else if (d && d.mismatches.length) {
      for (const x of d.mismatches) out.push({ ok: false, text: t('cases.why.bad', { text: x.message }) });
    } else if (r.pass && jt?.expect !== undefined) {
      out.push({ ok: true, text: t('cases.why.equal', { tol: showTolerance(jt.tolerance ?? 1e-6) }) });
    } else if (r.pass) {
      out.push({ ok: true, text: t('cases.why.finite') });
    }
    if (!r.pass && !out.some((x) => !x.ok) && r.message) out.push({ ok: false, text: r.message });
    return out;
  }
  // Board tests: every checked output, then how a program run ended.
  const w = (k: string) => widths?.get(k) ?? guessWidth(row, k);
  if (row.kind === 'program' && test?.kind === 'program') {
    const halt = test.halt ?? 'HALT';
    const max = (test.maxCycles ?? 0).toLocaleString('en-US');
    if (r.halted === true) out.push({ ok: true, text: t('cases.why.halted', { halt, cycles: (r.cycle ?? 0).toLocaleString('en-US'), max }) });
    else if (r.halted === false) out.push({ ok: false, text: t('cases.why.notHalted', { halt, max }) });
  }
  // No output was read (time budget, setup error): the checker's message says why.
  const read = Object.keys(r.actual ?? {}).length > 0 || Object.keys(r.actualNum ?? {}).length > 0;
  if (!r.pass && !read && r.message) return [...out, { ok: false, text: r.message }];
  const expect = row.expect ?? {};
  for (const [label, want] of Object.entries(expect)) {
    const got = actualValue(r, label);
    const ok = got === want;
    out.push({ ok, text: t(ok ? 'cases.why.eq' : 'cases.why.ne', { label, got: got === undefined ? '–' : fmtValue(got, w(label), radix), want: fmtValue(want, w(label), radix) }) });
  }
  if (!Object.keys(expect).length && row.kind === 'sequence') out.push({ ok: r.pass, text: r.pass ? t('cases.why.noChecks') : (r.message ?? '') });
  if (!r.pass && !out.some((x) => !x.ok) && r.message) out.push({ ok: false, text: r.message });
  return out;
}

function guessWidth(row: CaseRow, label: string): number {
  const v = row.expect?.[label] ?? row.inputs?.[label] ?? 0;
  return v > 1 ? 32 : 1;
}

function checkOk(c: RvCheck): string {
  switch (c.kind) {
    case 'reg':
      return t('cases.why.reg', { label: c.name, got: showReg(c.actual) });
    case 'exit':
      return t('cases.why.exit', { got: c.actual === null ? '–' : showReg(c.actual) });
    case 'memory':
      return t('cases.why.memory', { label: checkLabel(c), n: c.expected.split(' ').filter(Boolean).length });
    case 'uart':
      return t('cases.why.uart', { n: utf8Length(c.expected) });
    case 'framebuffer':
      return t('cases.why.screen', { hash: c.expected.slice(0, 8) });
  }
}

/** Port widths by label (the table's planned ports). */
export function widthsOf(table: CaseTable): Map<string, number> {
  return table.widths;
}

/** The text of one cell. */
export function cellText(level: TestLevel, table: CaseTable, row: CaseRow, col: TableCol, radix: Radix): string {
  const width = col.port?.width ?? 1;
  switch (col.role) {
    case 'test':
      return String(row.test + 1);
    case 'case':
      return String(row.index + 1);
    case 'in':
      return fmtValue(row.inputs?.[col.label], width, radix);
    case 'want':
      return fmtValue(row.expect?.[col.label], width, radix);
    case 'got':
      return fmtValue(actualValue(row.result, col.label), width, radix);
    case 'steps':
      if (row.kind === 'sequence') return `${row.plan.power ? '⏻ ' : ''}+${row.plan.ticks ?? 0}`;
      if (row.kind === 'program') return `${row.result?.cycle ?? '–'} / ${row.plan.maxCycles ?? '–'}`;
      return '';
    case 'name':
      return caseName(level, row);
    case 'expect':
      return expectSummary(level.tests[row.test]);
    case 'actual':
      return actualSummary(row);
    case 'status': {
      const s = rowStatus(row);
      return s === 'pass' ? t('cases.pass') : s === 'fail' ? t('cases.fail') : t('cases.notRun');
    }
    case 'why':
      return caseReasons(level, row, radix, widthsOf(table))
        .map((x) => x.text)
        .join('; ');
  }
}

/** Whether a 'got' cell differs from the expected value. */
export function cellWrong(row: CaseRow, col: TableCol): boolean {
  if (col.role !== 'got' || !row.result) return false;
  const want = row.expect?.[col.label];
  const got = actualValue(row.result, col.label);
  return want !== undefined && got !== undefined && got !== want;
}

/** CSV header: inputs, expected and actual columns named so a spreadsheet keeps them apart. */
export function csvHeader(table: CaseTable): string[] {
  return table.csvColumns.map((c) =>
    c.role === 'in' ? t('cases.col.in', { label: c.label }) : c.role === 'want' ? t('cases.col.want', { label: c.label }) : c.role === 'got' ? t('cases.col.got', { label: c.label }) : c.label,
  );
}

export function csvRow(level: TestLevel, table: CaseTable, row: CaseRow, radix: Radix): string[] {
  return table.csvColumns.map((c) => cellText(level, table, row, c, radix));
}

/**
 * Text a search looks through: every cell, values on ports as "label=dec" and
 * "label=0xHEX" in both formats, the reasons and the checker's message. Lowercase.
 */
export function rowHaystack(level: TestLevel, table: CaseTable, row: CaseRow): string {
  const parts: string[] = [];
  const add = (label: string, v: number | 'x' | undefined, width: number) => {
    if (v === undefined) return;
    const dec = fmtValue(v, width, 'dec');
    const hex = fmtValue(v, width, 'hex');
    parts.push(`${label}=${dec}`, `${label}=${hex}`, dec, hex);
  };
  const widths = widthsOf(table);
  for (const [k, v] of Object.entries(row.inputs ?? {})) add(k, v, widths.get(k) ?? 1);
  for (const [k, v] of Object.entries(row.expect ?? {})) add(k, v, widths.get(k) ?? 1);
  if (row.result) for (const p of table.plan.outputs) add(p.label, actualValue(row.result, p.label), p.width);
  for (const c of table.csvColumns) if (c.role !== 'in' && c.role !== 'want' && c.role !== 'got') parts.push(cellText(level, table, row, c, 'dec'));
  parts.push(t('cases.caseN', { n: row.index + 1 }), t(`cases.kind.${row.kind}`));
  if (row.result?.message) parts.push(row.result.message);
  return parts.join(' \u0001 ').toLowerCase();
}

/** Every whitespace-separated term must appear ("a=3 fail"). Spaces around "=" are ignored. */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = query.toLowerCase().replace(/\s*=\s*/g, '=').split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

/** Rows shown for a search, a status filter and a test (null: all tests). */
export function filterRows(
  level: TestLevel,
  table: CaseTable,
  byColumn: readonly (CaseResult | undefined)[],
  opts: { query: string; status: StatusFilter; test: number | null },
): number[] {
  const out: number[] = [];
  const seg = opts.test === null ? null : table.tests[opts.test];
  const from = seg ? seg.start : 0;
  const to = seg ? seg.start + seg.count : table.count;
  const q = opts.query.trim();
  for (let i = from; i < to; i++) {
    if (opts.status !== 'all') {
      const r = byColumn[i];
      const s: CaseStatus = r ? (r.pass ? 'pass' : 'fail') : 'pending';
      if (s !== opts.status) continue;
    }
    if (q && !matchesQuery(rowHaystack(level, table, caseRow(table, i, byColumn)), q)) continue;
    out.push(i);
  }
  return out;
}

/** Program listing: "00: LDI R0, 0x05" (Toy-8) or "00000000: addi a0, zero, 5" (RV32). */
export function programListing(test: Extract<TestSpec, { kind: 'program' }>, max = 512): string {
  const bytes = parseHexLoose(test.program);
  let lines: string[];
  if ((test.wordBytes ?? 1) === 4) {
    lines = disassemble(Uint8Array.from(bytes), 0).map((l) => `${l.address.toString(16).padStart(4, '0')}: ${l.text}`);
  } else {
    lines = disassembleAll(bytes).map((l) => `${l.addr.toString(16).padStart(2, '0')}: ${l.text}`);
  }
  if (lines.length > max) return `${lines.slice(0, max).join('\n')}\n… (${lines.length - max} more)`;
  return lines.join('\n');
}

/** Everything a case sets and checks, before or after a run. */
export function caseSpec(level: TestLevel, table: CaseTable, row: CaseRow, radix: Radix): SpecItem[] {
  const test = level.tests[row.test];
  if (!test) return [];
  const widths = widthsOf(table);
  const vals = (v: Values | undefined) => valuesText(v, widths, radix);
  const items: SpecItem[] = [];
  switch (test.kind) {
    case 'truth-table':
    case 'exhaustive':
    case 'random':
      items.push({ label: t('cases.spec.inputs'), value: vals(row.inputs) }, { label: t('cases.spec.expect'), value: vals(row.expect) });
      if (test.kind !== 'truth-table') items.push({ label: t('cases.spec.reference'), value: test.reference });
      break;
    case 'sequence': {
      const step = test.steps[row.plan.step ?? row.index];
      items.push({ label: t('cases.spec.step'), value: t('cases.spec.stepOf', { n: (row.plan.step ?? row.index) + 1, total: test.steps.length }) });
      if (step?.power === 'cycle') items.push({ label: t('cases.spec.power'), value: t('cases.spec.powerCycle') });
      items.push({ label: t('cases.spec.sets'), value: vals(step?.set) });
      items.push({ label: t('cases.spec.holds'), value: vals(row.inputs) });
      items.push({ label: t('cases.spec.ticks'), value: t('cases.spec.ticksN', { n: step?.ticks ?? 0 }) });
      items.push({ label: t('cases.spec.checks'), value: step?.expect && Object.keys(step.expect).length ? vals(step.expect) : t('cases.spec.noChecks') });
      break;
    }
    case 'program': {
      const bytes = parseHexLoose(test.program);
      items.push({ label: t('cases.spec.rom'), value: t('cases.spec.romWords', { rom: test.rom ?? 'ROM', bytes: test.wordBytes ?? 1 }) });
      items.push({ label: t('cases.spec.maxCycles'), value: (test.maxCycles ?? 0).toLocaleString('en-US') });
      items.push({ label: t('cases.spec.halt'), value: t('cases.spec.haltIs', { halt: test.halt ?? 'HALT' }) });
      if (test.set && Object.keys(test.set).length) items.push({ label: t('cases.spec.inputs'), value: vals(test.set) });
      items.push({ label: t('cases.spec.expect'), value: vals(test.expect) });
      items.push({ label: t('cases.spec.program'), value: `${hexBytes(bytes, 256)}\n(${t('cases.spec.bytes', { n: bytes.length })})`, block: true });
      items.push({ label: t('cases.spec.disasm'), value: programListing(test), block: true });
      break;
    }
    case 'riscv':
      riscvSpec(test, items);
      break;
    case 'js': {
      items.push({ label: t('cases.spec.entry'), value: test.entry });
      items.push({ label: t('cases.spec.args'), value: summarizeJson(test.args ?? [], true), block: true });
      if (test.metric) items.push({ label: t('cases.spec.metric'), value: t('cases.exp.metric', { name: test.metric.name, range: metricRange(test.metric.min, test.metric.max) }) });
      if (test.expect !== undefined) {
        items.push({ label: t('cases.spec.expectValue'), value: summarizeJson(test.expect, true), block: true });
        items.push({ label: t('cases.spec.tolerance'), value: `± ${showTolerance(test.tolerance ?? 1e-6)}` });
      }
      if (!test.metric && test.expect === undefined) items.push({ label: t('cases.spec.expectValue'), value: t('cases.spec.finite') });
      items.push({ label: t('cases.spec.seed'), value: String(test.seed ?? 1) });
      items.push({ label: t('cases.spec.timeout'), value: t('cases.spec.ms', { n: (test.timeoutMs ?? 10_000).toLocaleString('en-US') }) });
      break;
    }
  }
  return items;
}

function riscvSpec(test: RiscvTest, items: SpecItem[]): void {
  const regs = (r: Record<string, number> | undefined) =>
    Object.entries(r ?? {})
      .map(([k, v]) => `${k} = ${showReg(v)} (${hex32(v)})`)
      .join('\n');
  const mem = (m: { addr: number; hex: string }[] | undefined) =>
    (m ?? []).map((x) => {
      const b = parseHexLoose(x.hex);
      return `${hex32(x.addr)}: ${hexBytes(b)}${b.length > 1 && b.length <= 64 ? ` (${b.length} bytes)` : ''}`;
    }).join('\n');
  items.push({ label: t('cases.spec.name'), value: test.name ?? '—' });
  if (test.setup?.regs && Object.keys(test.setup.regs).length) items.push({ label: t('cases.spec.regs'), value: regs(test.setup.regs), block: true });
  if (test.setup?.memory?.length) items.push({ label: t('cases.spec.memory'), value: mem(test.setup.memory), block: true });
  if (test.setup?.disk?.length)
    items.push({
      label: t('cases.spec.disk'),
      value: test.setup.disk.map((d) => t('cases.spec.diskLine', { sector: d.sector, bytes: parseHexLoose(d.hex).length.toLocaleString('en-US') })).join('\n'),
      block: true,
    });
  if (test.input) items.push({ label: t('cases.spec.input'), value: `"${escapeText(test.input)}"`, block: true });
  const e = test.expect;
  if (e.regs && Object.keys(e.regs).length) items.push({ label: t('cases.spec.expRegs'), value: regs(e.regs), block: true });
  if (e.memory?.length) items.push({ label: t('cases.spec.expMemory'), value: mem(e.memory), block: true });
  if (e.uart !== undefined) items.push({ label: t('cases.spec.expUart'), value: `"${escapeText(e.uart)}"\n(${t('cases.spec.bytes', { n: utf8Length(e.uart) })})`, block: true });
  if (e.exitCode !== undefined) items.push({ label: t('cases.spec.exitCode'), value: showReg(e.exitCode) });
  if (e.framebufferSha256) items.push({ label: t('cases.spec.fb'), value: e.framebufferSha256, block: true });
  items.push({ label: t('cases.spec.maxSteps'), value: (test.maxSteps ?? 5_000_000).toLocaleString('en-US') });
}
