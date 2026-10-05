import { describe, expect, it } from 'vitest';
import { SimHost } from '@build-a-computer/worker';
import { LevelPack, PACK_KIND, type Level } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { checkLevel, probeRows } from './checker';
import { cascade, isPackLevelId, namespacedId, namespaceLevel, staticIssues, toInstalled, validatePack } from './packs';
import { mergeBest, measure, decodeBest } from './best';
import { buildLevel, buildPack, defaultPalette, draftProblems, inputVectors, portsOf, referenceBoard, starterFrom, type LevelDraft } from './editor';
import { notBoard, notLevel } from './fixtures.test-util';

const host = () => new SimHost(() => 0, () => 0 as unknown as ReturnType<typeof setTimeout>);

const pack = (levels: Level[], solutions: LevelPack['solutions']): LevelPack =>
  LevelPack.parse({ kind: PACK_KIND, version: 1, name: 'My Gates!', author: 'Ada', levels, solutions });

describe('pack content-check rules (COM-03)', () => {
  it('namespaces ids and requirements', () => {
    expect(namespacedId('my-gates', 'not')).toBe('pack-my-gates--not');
    expect(isPackLevelId('pack-my-gates--not')).toBe(true);
    expect(isPackLevelId('nand-not')).toBe(false);
    const l = namespaceLevel(notLevel({ requires: ['and', 'nand-not'] }), 's', new Set(['and']));
    expect(l.id).toBe('pack-s--not');
    expect(l.requires).toEqual(['pack-s--and', 'nand-not']);
  });

  it('flags levels without a matching solution, unlocked starters, off-palette references and unknown requirements', () => {
    const offPalette = { ...notBoard(), parts: [...notBoard().parts, { id: 'x', type: 'xor' as const, x: 0, y: 9, rot: 0 as const, flip: false }] };
    const p = pack(
      [
        notLevel({ id: 'a' }),
        notLevel({ id: 'b', starter: { parts: [{ id: 'A', type: 'switch', x: 0, y: 0, rot: 0, flip: false, label: 'A' }], wires: [] } }),
        notLevel({ id: 'c' }),
        notLevel({ id: 'd', requires: ['nowhere'] }),
        notLevel({ id: 'e', tests: [] }),
      ],
      { a: { board: notBoard() }, b: { board: notBoard() }, c: { board: offPalette }, d: { source: 'x' } },
    );
    const issues = staticIssues(p, new Set());
    expect(issues.get('a')).toEqual([]);
    expect(issues.get('b')!.join()).toMatch(/locked/);
    expect(issues.get('c')!.join()).toMatch(/outside the palette: xor/);
    expect(issues.get('d')!.join()).toMatch(/board reference/);
    expect(issues.get('d')!.join()).toMatch(/unknown level: nowhere/);
    expect(issues.get('e')!.join()).toMatch(/no tests/);
  });

  it('rejects requirement loops and cascades failures to dependants', () => {
    const p = pack(
      [notLevel({ id: 'a', requires: ['b'] }), notLevel({ id: 'b', requires: ['a'] }), notLevel({ id: 'c' }), notLevel({ id: 'd', requires: ['c'] })],
      { a: { board: notBoard() }, b: { board: notBoard() }, c: { board: notBoard() }, d: { board: notBoard() } },
    );
    const issues = staticIssues(p, new Set());
    expect(issues.get('a')!.join()).toMatch(/loop/);
    expect(issues.get('b')!.join()).toMatch(/loop/);
    const reports = p.levels.map((l) => ({ id: l.id, installId: l.id, title: l.title, ok: l.id !== 'c', problems: [] as string[] }));
    cascade(p, reports);
    expect(reports.find((r) => r.id === 'd')!.ok).toBe(false);
  });

  it('E-RES-06: installs only levels whose reference passes and whose empty starter fails (run in the sim host)', async () => {
    const accidental = notLevel({ id: 'accidental', tests: [{ kind: 'truth-table', rows: [{ inputs: { A: 0 }, expect: {} }] }] });
    const wrong = notLevel({ id: 'wrong' });
    const p = pack([notLevel(), accidental, wrong, notLevel({ id: 'after', requires: ['wrong'] })], {
      not: { board: notBoard() },
      accidental: { board: notBoard() },
      wrong: { board: starterFrom(notBoard(), ['A', 'Y']) },
      after: { board: notBoard() },
    });
    const report = await validatePack(p, host(), new Set());
    const by = Object.fromEntries(report.levels.map((r) => [r.id, r]));
    expect(by.not!.ok).toBe(true);
    expect(by.accidental!.problems.join()).toMatch(/empty solution passes/);
    expect(by.wrong!.problems.join()).toMatch(/reference solution fails/);
    expect(by.after!.ok).toBe(false);
    const installed = toInstalled(p, report, new Date('2026-10-05T00:00:00Z'));
    expect(installed.slug).toBe('my-gates');
    expect(installed.levels.map((l) => l.id)).toEqual(['pack-my-gates--not']);
  });

  it('checkLevel reports the publishing rule', async () => {
    const c = await checkLevel(host(), notLevel(), { board: notBoard() }, {});
    expect(c).toMatchObject({ ok: true, referencePasses: true, emptyFails: true });
  });
});

describe('level editor (COM-02)', () => {
  const board = notBoard();
  const draft = (over: Partial<LevelDraft> = {}): LevelDraft => ({
    title: 'Invert it',
    goal: 'Make Y the opposite of A.',
    hints: ['One NAND is enough.', ' '],
    afterword: '',
    palette: defaultPalette(board, ['A', 'Y']),
    inputs: ['A'],
    outputs: ['Y'],
    rows: [],
    packName: 'Starter pack',
    author: '',
    description: '',
    ...over,
  });

  it('finds labelled inputs and outputs and the default palette', () => {
    const ports = portsOf(board);
    expect(ports.inputs.map((p) => p.label)).toEqual(['A']);
    expect(ports.outputs.map((p) => p.label)).toEqual(['Y']);
    expect(defaultPalette(board, ['A', 'Y'])).toEqual(['nand']);
  });

  it('enumerates small inputs exhaustively and samples wide ones deterministically', () => {
    expect(inputVectors([{ id: 'a', label: 'a', width: 1 }, { id: 'b', label: 'b', width: 2 }])).toHaveLength(8);
    const wide = inputVectors([{ id: 'a', label: 'a', width: 16 }]);
    expect(wide).toHaveLength(64);
    expect(wide[1]).toEqual({ a: 0xffff });
    expect(inputVectors([{ id: 'a', label: 'a', width: 16 }])).toEqual(wide);
  });

  it('generates the truth table from the reference, and the empty starter fails it', async () => {
    const h = host();
    const rows = await probeRows(h, board, {}, inputVectors(portsOf(board).inputs), ['Y']);
    expect(rows).toEqual([
      { inputs: { A: 0 }, expect: { Y: 1 } },
      { inputs: { A: 1 }, expect: { Y: 0 } },
    ]);
    const d = draft({ rows: rows.filter((r) => r !== null) });
    expect(draftProblems(d, board)).toEqual([]);
    const level = buildLevel(d, board);
    expect(level.id).toBe('invert-it');
    expect(level.hints).toEqual(['One NAND is enough.']);
    expect(level.starter.parts.every((p) => p.locked)).toBe(true);
    const c = await checkLevel(h, level, { board: referenceBoard(board, ['A', 'Y']) }, {});
    expect(c.ok).toBe(true);
    const p = buildPack(d, level, board, {});
    const report = await validatePack(p, h, new Set());
    expect(report.levels[0]!.ok).toBe(true);
  });

  it('a draft needs a title, I/O, rows and a pack name', () => {
    expect(draftProblems(draft({ title: ' ', inputs: [], packName: '' }), board)).toEqual(expect.arrayContaining(['title', 'inputs', 'rows', 'packName']));
  });
});

describe('local best results (COM-04)', () => {
  const pass = (over: Partial<CaseResult>): CaseResult => ({ index: 0, pass: true, inputs: {}, expected: {}, actual: {}, ...over });

  it('counts placed parts, wires and per-test cycles', () => {
    const e = measure(notLevel(), referenceBoard(notBoard(), ['A', 'Y']), [
      pass({ kind: 'sequence', test: 0, cycle: 2 }),
      pass({ kind: 'sequence', test: 0, cycle: 6 }),
      pass({ kind: 'sequence', test: 1, cycle: 4 }),
    ]);
    expect(e).toMatchObject({ parts: 1, wires: 3, cycles: 10, cycleUnit: 'ticks' });
    const code = measure({ ...notLevel(), mode: 'code' }, notBoard(), [pass({ kind: 'riscv', test: 0, cycle: 120 }), pass({ kind: 'riscv', test: 1, cycle: 30 })]);
    expect(code).toMatchObject({ cycles: 150, cycleUnit: 'instructions' });
    expect(code.parts).toBeUndefined();
  });

  it('keeps the minimum of each metric independently', () => {
    const base = { levelId: 'x', levelVersion: 1, at: '2026-01-01T00:00:00.000Z' };
    const first = mergeBest(undefined, { ...base, parts: 5, wires: 9 });
    expect(first.first).toBe(true);
    const u = mergeBest(first.entry, { ...base, parts: 4, wires: 12, at: '2026-02-01T00:00:00.000Z' });
    expect(u.improved).toEqual(['parts']);
    expect(u.entry).toMatchObject({ parts: 4, wires: 9, at: '2026-02-01T00:00:00.000Z' });
    expect(mergeBest(u.entry, { ...base, parts: 6, wires: 10 }).improved).toEqual([]);
  });

  it('a new level version starts over; an older one never overwrites', () => {
    const cur = { levelId: 'x', levelVersion: 2, parts: 7, at: 'a' };
    expect(mergeBest(cur, { levelId: 'x', levelVersion: 1, parts: 1, at: 'b' }).entry).toBe(cur);
    expect(mergeBest(cur, { levelId: 'x', levelVersion: 3, parts: 9, at: 'b' })).toMatchObject({ first: true, entry: { parts: 9 } });
  });

  it('decodes stored records defensively', () => {
    expect(decodeBest({ levelId: 'x', levelVersion: 1, at: 'a', parts: 3, wires: -1 }, 'x')).toEqual({ levelId: 'x', levelVersion: 1, at: 'a', parts: 3 });
    expect(decodeBest({ levelId: 'y', levelVersion: 1, at: 'a' }, 'x')).toBeNull();
    expect(decodeBest('nope', 'x')).toBeNull();
  });
});
