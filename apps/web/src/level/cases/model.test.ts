import { describe, expect, it } from 'vitest';
import type { CaseResult } from '@build-a-computer/sim-logic';
import type { Level, TestSpec } from '@build-a-computer/schema';
import { assignResults } from '../testStripModel';
import { csvField, csvLine, csvText } from './csv';
import {
  buildCaseTable,
  caseReasons,
  caseRow,
  caseSpec,
  cellText,
  csvHeader,
  csvRow,
  escapeText,
  filterRows,
  fmtValue,
  matchesQuery,
  programListing,
  rowHaystack,
  summarizeJson,
  testRule,
  type CaseTable,
} from './model';

type L = Pick<Level, 'starter' | 'tests'>;
const lvl = (tests: TestSpec[], parts: Level['starter']['parts'] = []): L => ({ starter: { parts, wires: [] }, tests });
const sw = (label: string, width = 1) => ({ id: `s${label}`, type: 'switch' as const, x: 0, y: 0, rot: 0 as const, flip: false, label, props: { width } });
const lamp = (label: string, width = 1) => ({ id: `l${label}`, type: 'lamp' as const, x: 0, y: 0, rot: 0 as const, flip: false, label, props: { width } });
const res = (extra: Partial<CaseResult>): CaseResult => ({ index: 0, pass: true, inputs: {}, expected: {}, actual: {}, ...extra });

const rowsOf = (level: L, table: CaseTable, results: CaseResult[] = []) => {
  const { byColumn } = assignResults(table.plan, results);
  return { byColumn, row: (i: number) => caseRow(table, i, byColumn) };
};

const halfAdder: TestSpec = {
  kind: 'truth-table',
  rows: [
    { inputs: { A: 0, B: 0 }, expect: { S: 0, C: 0 } },
    { inputs: { A: 0, B: 1 }, expect: { S: 1, C: 0 } },
    { inputs: { A: 1, B: 0 }, expect: { S: 1, C: 0 } },
    { inputs: { A: 1, B: 1 }, expect: { S: 0, C: 1 } },
  ],
};

describe('case table: board tests', () => {
  it('truth table: one row per case, columns per input, expected and actual output', () => {
    const level = lvl([halfAdder]);
    const table = buildCaseTable(level);
    expect(table.layout).toBe('ports');
    expect(table.count).toBe(4);
    expect(table.columns.map((c) => c.id)).toEqual(['test', 'case', 'in:A', 'in:B', 'want:S', 'want:C', 'got:S', 'got:C', 'status']);
    expect(table.tests[0]!.rule).toBe('4 rows written in the level');
    const { row } = rowsOf(level, table);
    expect(table.columns.map((c) => cellText(level, table, row(3), c, 'dec'))).toEqual(['1', '4', '1', '1', '0', '1', '', '', 'not run']);
  });

  it('exhaustive: all combinations with the reference outputs and the rule', () => {
    const level = lvl([{ kind: 'exhaustive', inputs: ['A', 'B'], outputs: ['S'], reference: 'adder8' } as TestSpec], [sw('A', 8), sw('B', 8), lamp('S', 8)]);
    const table = buildCaseTable(level);
    expect(table.count).toBe(65_536);
    expect(table.multiBit).toBe(true);
    expect(table.tests[0]!.rule).toBe('all 65,536 combinations of A, B (reference: adder8)');
    const r = rowsOf(level, table).row(0x0305);
    expect(r.inputs).toEqual({ A: 3, B: 5 });
    const want = table.columns.find((c) => c.id === 'want:S')!;
    expect(cellText(level, table, r, want, 'dec')).toBe(String(r.expect!.S));
    expect(cellText(level, table, r, table.columns.find((c) => c.id === 'in:A')!, 'hex')).toBe('0x03');
  });

  it('random: rule names count and seed', () => {
    const test = { kind: 'random', inputs: ['A'], outputs: ['S'], reference: 'adder8', count: 1000, seed: 7 } as TestSpec;
    expect(testRule(test)).toBe('1,000 random vectors, seed 7 (reference: adder8)');
  });

  it('sequence: one row per step with inputs held, ticks and checks', () => {
    const level = lvl([
      {
        kind: 'sequence',
        steps: [
          { set: { D: 1 }, ticks: 2, expect: { Q: 1 } },
          { set: { D: 0 }, ticks: 0 },
          { ticks: 2, expect: { Q: 0 }, power: 'cycle' },
        ],
      },
    ]);
    const table = buildCaseTable(level);
    expect(table.tests[0]!.rule).toBe('3 steps, 2 with checked outputs');
    expect(table.columns.some((c) => c.role === 'steps')).toBe(true);
    const { row } = rowsOf(level, table);
    const steps = table.columns.find((c) => c.role === 'steps')!;
    expect(cellText(level, table, row(0), steps, 'dec')).toBe('+2');
    expect(cellText(level, table, row(2), steps, 'dec')).toBe('⏻ +2');
    const spec = caseSpec(level, table, row(1), 'dec');
    expect(spec.find((s) => s.label === 'Checks')?.value).toBe('nothing checked at this step');
    expect(spec.find((s) => s.label === 'Inputs held')?.value).toBe('D = 0');
  });

  it('program: spec lists hex and the Toy-8 disassembly', () => {
    const test = { kind: 'program', program: '10 05 f0 00', rom: 'ROM', halt: 'HALT', maxCycles: 100, expect: { OUT: 5 } } as TestSpec;
    const level = lvl([test]);
    const table = buildCaseTable(level);
    expect(table.tests[0]!.rule).toBe('program of 4 bytes in ROM; up to 100 cycles or until HALT = 1');
    const spec = caseSpec(level, table, rowsOf(level, table).row(0), 'dec');
    expect(spec.find((s) => s.label === 'Program (hex)')?.value).toContain('10 05 f0 00');
    expect(spec.find((s) => s.label === 'Disassembly')?.value.split('\n')).toHaveLength(2);
  });

  it('program: RV32 words disassemble as RISC-V', () => {
    // addi a0, zero, 5
    const listing = programListing({ kind: 'program', program: '13 05 50 00', wordBytes: 4, rom: 'ROM', halt: 'HALT', maxCycles: 10, expect: {} });
    expect(listing).toMatch(/^0000: (li a0, 5|addi a0, zero, 5)/);
  });
});

describe('why a case passed or failed', () => {
  it('board: every checked output, satisfied or not', () => {
    const level = lvl([halfAdder]);
    const table = buildCaseTable(level);
    const pass = res({ index: 1, pass: true, test: 0, kind: 'truth-table', inputs: { A: 0, B: 1 }, expected: { S: 1, C: 0 }, actual: { S: '1', C: '0' } });
    const fail = res({ index: 3, pass: false, test: 0, kind: 'truth-table', inputs: { A: 1, B: 1 }, expected: { S: 0, C: 1 }, actual: { S: '0', C: '0' } });
    const { row } = rowsOf(level, table, [pass, fail]);
    expect(caseReasons(level, row(1))).toEqual([
      { ok: true, text: 'S = 1 ✓ (expected 1)' },
      { ok: true, text: 'C = 0 ✓ (expected 0)' },
    ]);
    expect(caseReasons(level, row(3))).toEqual([
      { ok: true, text: 'S = 0 ✓ (expected 0)' },
      { ok: false, text: 'C = 0 ✗ (expected 1)' },
    ]);
    expect(caseReasons(level, row(0))).toEqual([]);
  });

  it('program: the halt and the outputs', () => {
    const level = lvl([{ kind: 'program', program: '00', rom: 'ROM', halt: 'HALT', maxCycles: 1000, expect: { OUT: 42 } } as TestSpec], [lamp('OUT', 8)]);
    const table = buildCaseTable(level);
    const { row } = rowsOf(level, table, [res({ test: 0, kind: 'program', halted: true, cycle: 42, expected: { OUT: 42 }, actual: { OUT: '42' } })]);
    expect(caseReasons(level, row(0), 'hex', table.widths).map((r) => r.text)).toEqual(['HALT = 1 after 42 of 1,000 cycles ✓', 'OUT = 0x2A ✓ (expected 0x2A)']);
  });

  it('riscv: registers, exit code and UART from the checks', () => {
    const test = { kind: 'riscv', name: 'sum', expect: { regs: { a0: 55 }, uart: 'Hello world\n', exitCode: 0 }, maxSteps: 1000 } as TestSpec;
    const level = lvl([test]);
    const table = buildCaseTable(level);
    expect(table.layout).toBe('text');
    expect(csvHeader(table)).toEqual(['Test', 'Name', 'Expected', 'Actual', 'Result', 'Why']);
    const checks = [
      { kind: 'reg', name: 'a0', expected: 55, actual: 55, ok: true },
      { kind: 'exit', expected: 0, actual: 0, ok: true },
      { kind: 'uart', expected: 'Hello world\n', actual: 'Hello world\n', firstDiff: 12, ok: true },
    ];
    const { row } = rowsOf(level, table, [{ ...res({ test: 0, kind: 'riscv' }), checks } as CaseResult]);
    expect(caseReasons(level, row(0)).map((r) => r.text)).toEqual(['a0 = 55 ✓', 'exit code = 0 ✓', 'UART matches ✓ (12 bytes)']);
    expect(csvRow(level, table, row(0), 'dec')).toEqual(['1', 'sum', 'a0 = 55; exit 0; UART "Hello world\\n"', 'a0 = 55; exit 0; UART "Hello world\\n"', 'pass', 'a0 = 55 ✓; exit code = 0 ✓; UART matches ✓ (12 bytes)']);
  });

  it('riscv: a failing check uses the shared diff line', () => {
    const level = lvl([{ kind: 'riscv', expect: { regs: { a0: 55 } }, maxSteps: 10 } as TestSpec]);
    const table = buildCaseTable(level);
    const checks = [{ kind: 'reg', name: 'a0', expected: 55, actual: 45, ok: false }];
    const { row } = rowsOf(level, table, [{ ...res({ test: 0, kind: 'riscv', pass: false }), checks } as CaseResult]);
    expect(caseReasons(level, row(0))).toEqual([{ ok: false, text: 'a0: expected 55, got 45 ✗' }]);
  });

  it('riscv spec: setup, input with escapes, expectations', () => {
    const test = {
      kind: 'riscv',
      setup: { regs: { a0: 3 }, memory: [{ addr: 0x80001000, hex: '01 02' }], disk: [{ sector: 2, hex: '00'.repeat(512) }] },
      input: 'hi\n\x1b',
      expect: { exitCode: 0, framebufferSha256: 'a'.repeat(64) },
      maxSteps: 5000,
    } as TestSpec;
    const level = lvl([test]);
    const table = buildCaseTable(level);
    const spec = caseSpec(level, table, rowsOf(level, table).row(0), 'dec');
    const get = (l: string) => spec.find((s) => s.label === l)?.value;
    expect(get('Registers before')).toBe('a0 = 3 (0x00000003)');
    expect(get('Memory before')).toBe('0x80001000: 01 02 (2 bytes)');
    expect(get('Disk')).toBe('sector 2: 512 bytes');
    expect(get('Input (UART / keyboard)')).toBe('"hi\\n\\x1b"');
    expect(get('Expected screen (SHA-256)')).toBe('a'.repeat(64));
    expect(get('Max steps')).toBe('5,000');
  });

  it('js: metric within its range, expected values with tolerance', () => {
    const metric = { kind: 'js', entry: 'train', args: [100], metric: { name: 'accuracy', min: 0.9, max: 1 }, tolerance: 1e-6, seed: 1, timeoutMs: 1000 } as TestSpec;
    const equal = { kind: 'js', entry: 'add', args: [{ shape: [2], data: [1, 2] }, 3], expect: [4, 5], tolerance: 1e-6, seed: 1, timeoutMs: 1000 } as TestSpec;
    const level = lvl([metric, equal]);
    const table = buildCaseTable(level);
    expect(table.tests[1]!.rule).toBe('calls add(tensor [2] (2 values), 3); time limit 1,000 ms, seed 1');
    const r0 = { ...res({ test: 0, kind: 'js', actual: { result: '{"accuracy":0.97}' } }), detail: { mismatches: [], metric: { name: 'accuracy', value: 0.97, min: 0.9, max: 1, ok: true } } } as CaseResult;
    const r1 = { ...res({ test: 1, kind: 'js', actual: { result: '[4,5]' } }), detail: { mismatches: [] } } as CaseResult;
    const { row } = rowsOf(level, table, [r0, r1]);
    expect(caseReasons(level, row(0))).toEqual([{ ok: true, text: 'accuracy 0.97 within [0.9, 1] ✓' }]);
    expect(caseReasons(level, row(1))).toEqual([{ ok: true, text: 'result matches the expected value ± 1e-6 ✓' }]);
    expect(cellText(level, table, row(0), table.columns.find((c) => c.role === 'expect')!, 'dec')).toBe('accuracy in [0.9, 1]');
    const spec = caseSpec(level, table, row(1), 'dec');
    expect(spec.find((s) => s.label === 'Arguments')?.value).toBe('[\n  tensor [2] (2 values),\n  3\n]');
    expect(spec.find((s) => s.label === 'Tolerance')?.value).toBe('± 1e-6');
  });

  it('js: mismatches and a metric out of range fail', () => {
    const level = lvl([{ kind: 'js', entry: 'f', args: [], metric: { name: 'loss', max: 0.1 }, tolerance: 1e-6, seed: 1, timeoutMs: 1000 } as TestSpec]);
    const table = buildCaseTable(level);
    const r = { ...res({ test: 0, kind: 'js', pass: false }), detail: { mismatches: [{ path: 'result', message: 'x' }], metric: { name: 'loss', value: 0.5, max: 0.1, ok: false } } } as CaseResult;
    expect(caseReasons(level, rowsOf(level, table, [r]).row(0))).toEqual([{ ok: false, text: 'loss 0.5 ✗ (needs ≤ 0.1)' }]);
  });
});

describe('search and filters', () => {
  const level = lvl([halfAdder]);
  const table = buildCaseTable(level);
  const results = [
    res({ index: 0, pass: true, test: 0, inputs: { A: 0, B: 0 }, expected: { S: 0, C: 0 }, actual: { S: '0', C: '0' } }),
    res({ index: 1, pass: false, test: 0, inputs: { A: 0, B: 1 }, expected: { S: 1, C: 0 }, actual: { S: '0', C: '0' } }),
  ];
  const { byColumn } = assignResults(table.plan, results);

  it('matches label=value terms, ignoring spaces around =', () => {
    const h = rowHaystack(level, table, caseRow(table, 3, byColumn));
    expect(matchesQuery(h, 'a=1 b = 1')).toBe(true);
    expect(matchesQuery(h, 'a=0')).toBe(false);
  });

  it('filters by status and query', () => {
    expect(filterRows(level, table, byColumn, { query: '', status: 'fail', test: null })).toEqual([1]);
    expect(filterRows(level, table, byColumn, { query: '', status: 'pass', test: null })).toEqual([0]);
    expect(filterRows(level, table, byColumn, { query: '', status: 'pending', test: null })).toEqual([2, 3]);
    expect(filterRows(level, table, byColumn, { query: 'c=1', status: 'all', test: null })).toEqual([3]);
    expect(filterRows(level, table, byColumn, { query: 'fail', status: 'all', test: 0 })).toEqual([1]);
  });
});

describe('formatting', () => {
  it('values in hex or decimal', () => {
    expect(fmtValue(1, 1, 'hex')).toBe('1');
    expect(fmtValue(42, 8, 'hex')).toBe('0x2A');
    expect(fmtValue(42, 8, 'dec')).toBe('42');
    expect(fmtValue('x', 8, 'dec')).toBe('X');
    expect(fmtValue(undefined, 8, 'dec')).toBe('');
  });

  it('escapes control characters', () => {
    expect(escapeText('a\tb\r\n\\\x00')).toBe('a\\tb\\r\\n\\\\\\x00');
  });

  it('summarizes tensors and long arrays', () => {
    expect(summarizeJson({ w: { shape: [2, 3], data: [1, 2, 3, 4, 5, 6] } })).toBe('{"w":tensor [2, 3] (6 values)}');
    expect(summarizeJson(Array.from({ length: 20 }, (_, i) => i))).toBe('[20 numbers: 0, 1, 2, 3, …]');
  });
});

describe('CSV', () => {
  it('quotes fields with commas, quotes, line breaks and edge spaces', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(' pad')).toBe('" pad"');
    expect(csvField(undefined)).toBe('');
    expect(csvField(3)).toBe('3');
    expect(csvLine(['a', 'b,c', ''])).toBe('a,"b,c",');
    expect(csvText([['h1', 'h2'], ['1', '2']])).toBe('h1,h2\r\n1,2\r\n');
  });

  it('one column per input and output for board levels', () => {
    const level = lvl([halfAdder]);
    const table = buildCaseTable(level);
    expect(csvHeader(table)).toEqual(['Test', 'Case', 'in A', 'in B', 'want S', 'want C', 'got S', 'got C', 'Result', 'Why']);
  });
});
