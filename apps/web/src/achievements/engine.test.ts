import { describe, expect, it } from 'vitest';
import { LEVELS } from '@build-a-computer/content';
import { WorkspaceAchievements } from '@build-a-computer/schema';
import { ACHIEVEMENTS, CATEGORIES, SPEEDRUN_MS, achievementById } from './definitions';
import {
  chipDepth,
  emptySaved,
  emptyState,
  evaluate,
  mergeSaved,
  points,
  progressOf,
  contextOf,
  type EngineEvent,
  type EngineState,
} from './engine';
import { achievements as dict } from '../i18n/en/achievements';
import { emitAchievement, onAchievementSignal } from './events';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const LATER = new Date('2026-10-06T12:00:00.000Z');

/** Run events in order against a growing completed set; collect unlocks. */
function run(
  events: EngineEvent[],
  opts: { state?: EngineState; completed?: string[]; now?: Date } = {},
) {
  let state = opts.state ?? emptyState();
  const completed = new Set(opts.completed ?? []);
  const unlocked: string[] = [];
  for (const e of events) {
    if (e.type === 'level-completed') completed.add(e.levelId);
    const r = evaluate(state, e, { levels: LEVELS, completed, now: opts.now ?? NOW });
    state = r.state;
    unlocked.push(...r.unlocked);
  }
  return { state, unlocked, completed };
}

const pass = (
  levelId: string,
  extra: Partial<Extract<EngineEvent, { type: 'level-completed' }>> = {},
): EngineEvent[] => [
  { type: 'tests-run', levelId, passed: 4, total: 4 },
  { type: 'level-completed', levelId, first: true, hour: 14, ...extra },
];
const fail = (levelId: string): EngineEvent => ({
  type: 'tests-run',
  levelId,
  passed: 1,
  total: 4,
});

describe('definitions', () => {
  it('has unique ids, a known category, and a title and description for every achievement', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(40);
    for (const a of ACHIEVEMENTS) {
      expect(CATEGORIES).toContain(a.category);
      expect(dict[`ach.${a.id}.title`], a.id).toBeTruthy();
      expect(dict[`ach.${a.id}.desc`], a.id).toBeTruthy();
    }
  });

  it('every milestone names a real level, and every phase clear has levels', () => {
    for (const a of ACHIEVEMENTS.filter((x) => x.level))
      expect(
        LEVELS.some((l) => l.id === a.level),
        a.id,
      ).toBe(true);
    const ctx = contextOf(emptyState(), { levels: LEVELS, completed: new Set() });
    for (const a of ACHIEVEMENTS.filter((x) => x.category === 'phases'))
      expect(progressOf(a, ctx)!.target, a.id).toBeGreaterThan(0);
  });
});

describe('event -> unlock rules', () => {
  it('finishing Meet NAND unlocks Universal Gate with the event time', () => {
    const { state, unlocked } = run(pass('meet-nand'));
    expect(unlocked).toContain('universal-gate');
    expect(state.saved.unlocked['universal-gate']).toEqual({ at: NOW.toISOString() });
  });

  it('a lamp lighting unlocks First Light; an 8-bit bus unlocks Bus Driver but a 4-bit one does not', () => {
    expect(run([{ type: 'lamp-lit' }]).unlocked).toEqual(['first-light']);
    expect(run([{ type: 'bus-driven', width: 4 }]).unlocked).toEqual([]);
    expect(run([{ type: 'bus-driven', width: 8 }]).unlocked).toEqual(['bus-driver']);
  });

  it('first pass on the first run: Clean Run; with no hints opened: No Hints Needed; and De Morgan for OR', () => {
    const { unlocked } = run(pass('or-gate'));
    expect(unlocked).toEqual(expect.arrayContaining(['clean-run', 'no-hints', 'de-morgan']));
  });

  it('a failed first run means no Clean Run; an opened hint means no No Hints Needed', () => {
    const { unlocked, state } = run([
      fail('not-gate'),
      { type: 'hint-shown', levelId: 'not-gate' },
      ...pass('not-gate'),
    ]);
    expect(unlocked).not.toContain('clean-run');
    expect(unlocked).not.toContain('no-hints');
    expect(state.saved.stats.tried).toEqual(['not-gate']);
  });

  it('Minimalist when the parts are at most the reference count, on gate levels only', () => {
    expect(run(pass('xor-gate', { parts: 4, referenceParts: 4 })).unlocked).toContain('minimalist');
    expect(run(pass('xor-gate', { parts: 5, referenceParts: 4 })).unlocked).not.toContain(
      'minimalist',
    );
    expect(run(pass('half-adder', { parts: 1, referenceParts: 5 })).unlocked).not.toContain(
      'minimalist',
    );
  });

  it('Speedrunner within the limit on a new level, not on Phase 0 and not on a repeat', () => {
    expect(run(pass('and-gate', { ms: SPEEDRUN_MS - 1 })).unlocked).toContain('speedrunner');
    expect(run(pass('and-gate', { ms: SPEEDRUN_MS + 1 })).unlocked).not.toContain('speedrunner');
    expect(run(pass('wires-and-lamps', { ms: 1000 })).unlocked).not.toContain('speedrunner');
    expect(run(pass('and-gate', { ms: 1000, first: false })).unlocked).not.toContain('speedrunner');
  });

  it('Persistence after 10 failed runs in a row, then the streak resets', () => {
    const fails = Array.from({ length: 10 }, () => fail('mux'));
    const r = run([...fails, ...pass('mux')]);
    expect(r.unlocked).toContain('persistence');
    expect(r.state.session.fails.mux).toBeUndefined();
    expect(run([...fails.slice(1), ...pass('mux')]).unlocked).not.toContain('persistence');
  });

  it('phase clear and progress: all of Phase 0 unlocks Powered Up; progress counts levels', () => {
    const phase0 = LEVELS.filter(
      (l) => l.track === 'nand-to-os' && l.phase === 0 && !l.optional,
    ).map((l) => l.id);
    const partial = run(phase0.slice(0, -1).flatMap((id) => pass(id)));
    expect(partial.unlocked).not.toContain('phase-t1-0');
    const ctx = contextOf(partial.state, { levels: LEVELS, completed: partial.completed });
    expect(progressOf(achievementById('phase-t1-0')!, ctx)).toEqual({
      value: phase0.length - 1,
      target: phase0.length,
    });
    expect(run(phase0.flatMap((id) => pass(id))).unlocked).toContain('phase-t1-0');
  });

  it('sync backfills milestones from progress, but never skill achievements', () => {
    const { unlocked } = run([{ type: 'sync' }], {
      completed: ['meet-nand', 'or-gate', 'the-clock'],
    });
    expect(unlocked).toEqual(expect.arrayContaining(['universal-gate', 'clockwork']));
    expect(unlocked).not.toContain('de-morgan');
    expect(unlocked).not.toContain('clean-run');
  });

  it('chips: first chip, then three deep for Matryoshka', () => {
    expect(run([{ type: 'chips', count: 1, depth: 1 }]).unlocked).toEqual(['chip-maker']);
    expect(run([{ type: 'chips', count: 3, depth: 3 }]).unlocked).toEqual(
      expect.arrayContaining(['chip-maker', 'matryoshka']),
    );
  });

  it('secrets: Night Owl between midnight and 4, Marathon after five new levels in a sitting', () => {
    expect(run(pass('not-gate', { hour: 2 })).unlocked).toContain('night-owl');
    expect(run(pass('not-gate', { hour: 4 })).unlocked).not.toContain('night-owl');
    const five = ['not-gate', 'and-gate', 'or-gate', 'nor-gate', 'xor-gate'].flatMap((id) =>
      pass(id),
    );
    expect(run(five).unlocked).toContain('marathon');
    expect(run(five.slice(0, 8)).unlocked).not.toContain('marathon');
  });

  it('tool signals unlock their achievements', () => {
    expect(
      run([
        { type: 'share-created' },
        { type: 'pack-exported' },
        { type: 'workspace-exported' },
        { type: 'case-debugged' },
      ]).unlocked,
    ).toEqual(expect.arrayContaining(['sharer', 'level-designer', 'backed-up', 'debugger']));
  });
});

describe('never re-awards', () => {
  it('a second identical event unlocks nothing and keeps the first timestamp', () => {
    const first = run(pass('meet-nand'));
    const second = run(pass('meet-nand'), { state: first.state, now: LATER });
    expect(second.unlocked).toEqual([]);
    expect(second.state.saved.unlocked['universal-gate']!.at).toBe(NOW.toISOString());
  });

  it('an event that changes nothing returns the same state object', () => {
    const s = run([{ type: 'lamp-lit' }]).state;
    const r = evaluate(
      s,
      { type: 'lamp-lit' },
      { levels: LEVELS, completed: new Set(), now: LATER },
    );
    expect(r.state).toBe(s);
    expect(r.unlocked).toEqual([]);
  });
});

describe('ADR-007: a shown solution grants no skill achievements for that level', () => {
  it('revealing before solving blocks Clean Run, No Hints Needed, Minimalist, Speedrunner and De Morgan', () => {
    const { unlocked, state } = run([
      { type: 'solution-revealed', levelId: 'or-gate' },
      ...pass('or-gate', { parts: 3, referenceParts: 3, ms: 5000 }),
    ]);
    for (const id of ['clean-run', 'no-hints', 'minimalist', 'speedrunner', 'de-morgan'])
      expect(unlocked).not.toContain(id);
    expect(state.saved.stats.clean ?? []).not.toContain('or-gate');
    expect(state.saved.stats.minimal ?? []).not.toContain('or-gate');
    expect(state.saved.stats.revealed).toEqual(['or-gate']);
  });

  it('revealing on one level does not block skill achievements on another', () => {
    const { unlocked } = run([
      { type: 'solution-revealed', levelId: 'and-gate' },
      ...pass('or-gate'),
    ]);
    expect(unlocked).toEqual(expect.arrayContaining(['clean-run', 'de-morgan']));
  });

  it('a level revealed on another device loses its skill facts on merge', () => {
    const mine = run(pass('or-gate', { parts: 3, referenceParts: 3 })).state.saved;
    expect(mine.stats.minimal).toEqual(['or-gate']);
    const theirs = { unlocked: {}, stats: { revealed: ['or-gate'] } };
    const merged = mergeSaved(mine, theirs);
    expect(merged.stats.minimal).toBeUndefined();
    expect(merged.stats.clean).toBeUndefined();
    // Unlocks already earned stay earned.
    expect(merged.unlocked['clean-run']).toBeDefined();
  });
});

describe('import merge', () => {
  it('is a union with the earliest timestamp, union of lists and max of counters', () => {
    const a = {
      unlocked: { x: { at: LATER.toISOString() }, y: { at: NOW.toISOString() } },
      stats: { runs: 3, tried: ['b', 'a'] },
    };
    const b = {
      unlocked: { x: { at: NOW.toISOString() }, z: { at: LATER.toISOString() } },
      stats: { runs: 7, tried: ['c', 'a'] },
    };
    const m = mergeSaved(a, b);
    expect(m.unlocked).toEqual({
      x: { at: NOW.toISOString() },
      y: { at: NOW.toISOString() },
      z: { at: LATER.toISOString() },
    });
    expect(m.stats).toEqual({ runs: 7, tried: ['a', 'b', 'c'] });
    expect(mergeSaved(b, a)).toEqual(m);
  });

  it('merging nothing or itself changes nothing, and the result fits the workspace schema', () => {
    const s = run([...pass('meet-nand'), { type: 'lamp-lit' }]).state.saved;
    expect(mergeSaved(s, undefined)).toBe(s);
    expect(mergeSaved(s, s)).toEqual(mergeSaved(s, emptySaved()));
    expect(WorkspaceAchievements.parse(JSON.parse(JSON.stringify(mergeSaved(s, s))))).toEqual(
      mergeSaved(s, s),
    );
  });

  it('an imported unlock is not awarded again later', () => {
    const imported = mergeSaved(emptySaved(), {
      unlocked: { 'first-light': { at: NOW.toISOString() } },
      stats: {},
    });
    const r = run([{ type: 'lamp-lit' }], {
      state: { ...emptyState(), saved: imported },
      now: LATER,
    });
    expect(r.unlocked).toEqual([]);
    expect(r.state.saved.unlocked['first-light']!.at).toBe(NOW.toISOString());
  });
});

describe('helpers', () => {
  it('chipDepth counts nesting, ignores deleted chips and survives cycles', () => {
    const chip = (inner: string[], deleted = false) => ({
      board: { parts: inner.map((c) => ({ type: 'chip', chip: c })) },
      deleted,
    });
    expect(chipDepth({})).toBe(0);
    expect(chipDepth({ a: chip([]) })).toBe(1);
    expect(chipDepth({ a: chip([]), b: chip(['a']), c: chip(['b']) })).toBe(3);
    expect(chipDepth({ a: chip([]), b: chip(['a']), c: chip(['b'], true) })).toBe(2);
    expect(chipDepth({ a: chip(['b']), b: chip(['a']) })).toBe(2);
  });

  it('points sum the tiers of unlocked achievements', () => {
    const s = run([{ type: 'lamp-lit' }, { type: 'pack-exported' }]).state.saved;
    expect(points(s)).toBe(10 + 25);
  });

  it('the event bus queues signals until a listener subscribes', () => {
    emitAchievement({ type: 'share-created' });
    const got: string[] = [];
    const off = onAchievementSignal((s) => got.push(s.type));
    emitAchievement({ type: 'pack-exported' });
    off();
    expect(got).toEqual(['share-created', 'pack-exported']);
  });
});
