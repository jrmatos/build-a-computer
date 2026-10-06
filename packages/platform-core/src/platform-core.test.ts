import { describe, expect, it } from 'vitest';
import { Level, type TestSpec } from '@build-a-computer/schema';
import {
  allTestKinds,
  boardKinds,
  builtinRegistry,
  canRunTests,
  canShowSolution,
  emptyProgress,
  groupLevels,
  hintState,
  initialSource,
  isBoardKind,
  isUnlocked,
  levelState,
  MODES,
  modeOf,
  nextLevel,
  Registry,
  runLevel,
  runLevelCase,
  solutionKind,
  sourceToSave,
  TEST_KINDS,
  trackOf,
  withCompleted,
  completedIds,
  isOutdated,
  type Checker,
  type CheckResult,
  type Failure,
  type KindRunner,
} from './index';

const level = (over: Partial<Level>): Level =>
  Level.parse({ id: 'x', version: 1, track: 'nand-to-os', phase: 1, order: 1, title: 'X', goal: 'g', palette: [], starter: { parts: [], wires: [] }, ...over });

describe('registry', () => {
  it('every schema mode and test kind has a plugin; each mode lists exactly its kinds', () => {
    expect(Object.keys(MODES).sort()).toEqual(['board', 'code', 'js']);
    for (const m of Object.values(MODES)) {
      expect([...m.testKinds].sort(), m.id).toEqual(allTestKinds().filter((k) => TEST_KINDS[k].mode === m.id).sort());
    }
    expect(boardKinds()).toEqual(['truth-table', 'exhaustive', 'random', 'sequence', 'program']);
    expect(isBoardKind('riscv')).toBe(false);
    expect(isBoardKind('js')).toBe(false);
  });
  it('levels without a mode are board levels', () => {
    expect(modeOf(undefined).id).toBe('board');
    expect(modeOf({ mode: 'code' }).machine).toBe('rv32');
    expect(modeOf('js').work).toBe('source');
  });
  it('tracks name their modes; the sandbox is free play', () => {
    expect(trackOf('sandbox').freePlay).toBe(true);
    expect(trackOf('nand-to-os').modes).toEqual(['board', 'code']);
    expect(trackOf({ track: 'neuron-to-llm' }).modes).toEqual(['js']);
  });
  it('refuses duplicates and tracks with unknown modes', () => {
    const r = builtinRegistry();
    expect(() => r.registerMode(MODES.board)).toThrow(/already/);
    expect(() => new Registry().registerTrack({ id: 'sandbox', modes: ['board'], freePlay: true })).toThrow(/unknown mode/);
    expect(() => r.mode('nope' as never)).toThrow(/Unknown level mode/);
  });
});

describe('unlock graph and progress', () => {
  it('free-play levels are always open; others need every requirement', () => {
    expect(isUnlocked(level({ track: 'sandbox', requires: ['a'] }), [])).toBe(true);
    expect(isUnlocked(level({ requires: ['a', 'b'] }), ['a'])).toBe(false);
    expect(isUnlocked(level({ requires: ['a', 'b'] }), new Set(['a', 'b']))).toBe(true);
    expect(levelState(level({ id: 'x' }), ['x'])).toBe('completed');
  });
  it('next level stays in the track; free play has none', () => {
    const a = level({ id: 'a', order: 1 });
    const b = level({ id: 'b', order: 2 });
    const t2 = level({ id: 'c', track: 'neuron-to-llm', order: 3 });
    expect(nextLevel(a, [t2, b, a])?.id).toBe('b');
    expect(nextLevel(b, [t2, b, a])).toBeUndefined();
    expect(nextLevel(level({ track: 'sandbox' }), [a, b])).toBeUndefined();
  });
  it('groups free-play tracks first', () => {
    const g = groupLevels([level({ id: 'a' }), level({ id: 's', track: 'sandbox', phase: 0 }), level({ id: 'c', track: 'neuron-to-llm' })]);
    expect(g.map((x) => x.track)).toEqual(['sandbox', 'nand-to-os', 'neuron-to-llm']);
  });
  it('records completion at the given time, never backward; flags outdated completions', () => {
    // eslint-disable-next-line no-restricted-syntax -- a fixed instant, not the clock
    const p = withCompleted(emptyProgress(), { id: 'a', version: 1 }, new Date(0));
    expect(p.levels.a).toEqual({ status: 'completed', levelVersion: 1, completedAt: '1970-01-01T00:00:00.000Z' });
    expect(completedIds(p)).toEqual(['a']);
    expect(isOutdated(p, { id: 'a', version: 2 })).toBe(true);
  });
});

describe('policies', () => {
  it('tests run on non-free-play levels with planned cases', () => {
    expect(canRunTests(level({}), 1)).toBe(true);
    expect(canRunTests(level({}), 0)).toBe(false);
    expect(canRunTests(level({ track: 'sandbox' }), 5)).toBe(false);
    expect(canRunTests(null, 5)).toBe(false);
  });
  it('hints open one at a time', () => {
    const l = level({ hints: ['a', 'b'] });
    expect(hintState(l, 0)).toEqual({ shown: [], next: 1, total: 2 });
    expect(hintState(l, 2)).toEqual({ shown: ['a', 'b'], next: null, total: 2 });
    expect(hintState(l, 9).shown).toEqual(['a', 'b']);
  });
  it('solutions: offered with tests outside chips; board or source by mode', () => {
    const tests: TestSpec[] = [{ kind: 'truth-table', rows: [{ inputs: {}, expect: {} }] }];
    expect(canShowSolution(level({ tests }), { inChip: false })).toBe(true);
    expect(canShowSolution(level({ tests }), { inChip: true })).toBe(false);
    expect(canShowSolution(level({}), { inChip: false })).toBe(false);
    expect(solutionKind({ mode: 'board' })).toBe('board');
    expect(solutionKind({ mode: 'code' })).toBe('source');
    expect(solutionKind({ mode: 'js' })).toBe('source');
  });
  it('sources: saved, else the mode starter; saved only for source modes', () => {
    expect(initialSource({ mode: 'js', js: { starter: 'S' } as Level['js'] })).toBe('S');
    expect(initialSource({ mode: 'code', code: { starter: 'C' } as Level['code'] }, 'mine')).toBe('mine');
    expect(initialSource({ mode: 'board' })).toBe('');
    expect(sourceToSave({ mode: 'board' }, 'x')).toBeUndefined();
    expect(sourceToSave({ mode: 'code' }, 'x')).toBe('x');
  });
});

describe('checker runner', () => {
  type R = CheckResult & { note?: string };
  const fail = (f: Failure): R => ({ ...f, pass: false });
  const runner = (n: number): KindRunner<R> => ({
    async run(_t, _ti, emit) {
      for (let i = 0; i < n; i++) await emit({ index: i, pass: i % 2 === 0 });
    },
    async runCase(_t, _ti, i) {
      return { index: i, pass: i % 2 === 0, note: 'one' };
    },
  });
  const checker = (opts: Partial<Checker<R, null>> = {}): Checker<R, null> => ({
    mode: 'board',
    singleCase: false,
    unsupported: (k) => `cannot run ${k}`,
    fail,
    open: () => ({ ok: true, session: { runner: (k) => (k === 'truth-table' ? runner(3) : undefined) } }),
    ...opts,
  });
  const tt: TestSpec = { kind: 'truth-table', rows: [{ inputs: {}, expect: {} }] };
  const js: TestSpec = { kind: 'js', entry: 'f', args: [], tolerance: 1e-6, seed: 1, timeoutMs: 1000 };

  it('streams tagged results in order, counts passes and fails unsupported kinds', async () => {
    const seen: R[] = [];
    const r = await runLevel(checker(), level({ tests: [tt, js] }), null, (c) => void seen.push(c));
    expect(r).toEqual({ passed: 2, total: 4 });
    expect(seen.map((c) => [c.test, c.index, c.pass])).toEqual([
      [0, 0, true],
      [0, 1, false],
      [0, 2, true],
      [1, 0, false],
    ]);
    expect(seen[3]).toMatchObject({ kind: 'js', message: 'cannot run js' });
  });
  it('a level-wide open failure is one case, or nothing when it does not count', async () => {
    const error: R = { index: 0, pass: false, message: 'cycle' };
    const seen: R[] = [];
    expect(await runLevel(checker({ open: () => ({ ok: false, error, counts: true }) }), level({ tests: [tt] }), null, (c) => void seen.push(c))).toEqual({ passed: 0, total: 1 });
    expect(seen).toEqual([error]);
    expect(await runLevel(checker({ open: () => ({ ok: false, error, counts: false }) }), level({ tests: [tt] }), null, () => undefined)).toEqual({ passed: 0, total: 0 });
  });
  it('runs one case, tagged; missing tests, extra cases and open failures are failed cases', async () => {
    const l = level({ tests: [tt, js] });
    expect(await runLevelCase(checker(), l, 0, 1, null)).toEqual({ index: 1, pass: false, note: 'one', test: 0 });
    expect(await runLevelCase(checker(), l, 5, 0, null)).toEqual({ index: 0, pass: false, test: 5, message: 'This test does not exist.' });
    expect(await runLevelCase(checker(), l, 1, 0, null)).toMatchObject({ kind: 'js', message: 'cannot run js', test: 1 });
    expect(await runLevelCase(checker({ singleCase: true }), l, 0, 2, null)).toMatchObject({ index: 2, message: 'There is no case 3 in this test.' });
    const error: R = { index: 0, pass: false, message: 'cycle' };
    expect(await runLevelCase(checker({ open: () => ({ ok: false, error, counts: true }) }), l, 0, 4, null)).toEqual({ index: 4, pass: false, message: 'cycle', kind: 'truth-table', test: 0 });
  });
});
