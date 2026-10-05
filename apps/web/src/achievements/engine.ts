/**
 * Pure achievement engine: apply an event to the saved facts, then unlock
 * every rule that now holds. No storage, no DOM, no clock (the caller passes
 * `now`): this is what the tests exercise.
 *
 * Guarantees:
 * - An unlock is never re-awarded and never moves its timestamp later.
 * - A level whose solution was shown (ADR-007) gets no skill achievements:
 *   it never enters the clean / no-hints / minimal lists, and `skill` rules
 *   that look at the level itself check `revealed`.
 * - Merging two states (workspace import, another tab) is a union with the
 *   earliest timestamp; lists union, counters take the max.
 */
import type { LevelInfo } from '@build-a-computer/content';
import type { WorkspaceAchievements } from '@build-a-computer/schema';
import {
  ACHIEVEMENTS,
  isGateLevel,
  TIER_POINTS,
  type AchievementDef,
  type Progress,
} from './definitions';

export type SavedAchievements = WorkspaceAchievements;
type Stats = SavedAchievements['stats'];
type ListKey = {
  [K in keyof Stats]-?: NonNullable<Stats[K]> extends string[] ? K : never;
}[keyof Stats];

/** What only this page load knows. */
export interface Session {
  /** Failed test runs in a row, per level. */
  fails: Record<string, number>;
  /** Fail streak of the level just completed (read by Persistence). */
  lastFailStreak: number;
  /** Levels completed for the first time during this page load. */
  firstCompletions: number;
  /** Custom chips in the library (not deleted), and the deepest nesting. */
  chipCount: number;
  chipDepth: number;
  /** Parts on the Sandbox board. */
  sandboxParts: number;
}

export interface EngineState {
  saved: SavedAchievements;
  session: Session;
}

export type EngineEvent =
  /** Re-check derived progress: startup, progress changed, import. */
  | { type: 'sync' }
  | { type: 'tests-run'; levelId: string; passed: number; total: number }
  | {
      type: 'level-completed';
      levelId: string;
      first: boolean;
      /** Time from opening the level to this pass. */
      ms?: number;
      /** Parts the player placed (board levels). */
      parts?: number;
      /** Parts in the reference solution, when known. */
      referenceParts?: number;
      /** Local hour 0-23, for the clock-based secrets. */
      hour: number;
    }
  | { type: 'hint-shown'; levelId: string }
  | { type: 'solution-revealed'; levelId: string }
  | { type: 'case-debugged'; levelId?: string }
  | { type: 'share-created' }
  | { type: 'pack-exported' }
  | { type: 'workspace-exported' }
  | { type: 'lamp-lit' }
  | { type: 'bus-driven'; width: number }
  | { type: 'unstable' }
  | { type: 'contention' }
  | { type: 'chips'; count: number; depth: number }
  | { type: 'sandbox-parts'; count: number };

export interface Env {
  levels: readonly LevelInfo[];
  completed: ReadonlySet<string>;
  now: Date;
}

/** What a rule sees. */
export interface Ctx {
  saved: SavedAchievements;
  session: Session;
  levels: readonly LevelInfo[];
  completed: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
}

export const emptySaved = (): SavedAchievements => ({ unlocked: {}, stats: {} });
export const emptySession = (): Session => ({
  fails: {},
  lastFailStreak: 0,
  firstCompletions: 0,
  chipCount: 0,
  chipDepth: 0,
  sandboxParts: 0,
});
export const emptyState = (): EngineState => ({ saved: emptySaved(), session: emptySession() });

const has = (s: Stats, k: ListKey, id: string) => s[k]?.includes(id) === true;
const add = (s: Stats, k: ListKey, id: string): Stats =>
  has(s, k, id) ? s : { ...s, [k]: [...(s[k] ?? []), id] };

/** Apply an event to the facts. Pure. */
export function reduce(state: EngineState, e: EngineEvent, levels: readonly LevelInfo[]): EngineState {
  let stats = state.saved.stats;
  let session = state.session;
  switch (e.type) {
    case 'tests-run': {
      stats = { ...stats, runs: (stats.runs ?? 0) + 1 };
      const pass = e.total > 0 && e.passed === e.total;
      if (!has(stats, 'tried', e.levelId)) {
        stats = add(stats, 'tried', e.levelId);
        if (pass) stats = add(stats, 'firstPass', e.levelId);
      }
      if (!pass)
        session = {
          ...session,
          fails: { ...session.fails, [e.levelId]: (session.fails[e.levelId] ?? 0) + 1 },
        };
      break;
    }
    case 'hint-shown':
      stats = add(stats, 'hinted', e.levelId);
      break;
    case 'solution-revealed':
      stats = add(stats, 'revealed', e.levelId);
      break;
    case 'level-completed': {
      const id = e.levelId;
      const level = levels.find((l) => l.id === id);
      const revealed = has(stats, 'revealed', id);
      if (!revealed) {
        if (e.first && has(stats, 'firstPass', id)) stats = add(stats, 'clean', id);
        if (e.first && level && level.hintCount > 0 && !has(stats, 'hinted', id))
          stats = add(stats, 'noHints', id);
        if (
          isGateLevel(level) &&
          e.parts !== undefined &&
          e.referenceParts !== undefined &&
          e.parts <= e.referenceParts
        )
          stats = add(stats, 'minimal', id);
      }
      const { [id]: streak = 0, ...fails } = session.fails;
      session = {
        ...session,
        fails,
        lastFailStreak: streak,
        firstCompletions: session.firstCompletions + (e.first ? 1 : 0),
      };
      break;
    }
    case 'chips':
      session = { ...session, chipCount: e.count, chipDepth: Math.max(session.chipDepth, e.depth) };
      break;
    case 'sandbox-parts':
      session = { ...session, sandboxParts: Math.max(session.sandboxParts, e.count) };
      break;
    default:
      break;
  }
  if (stats === state.saved.stats && session === state.session) return state;
  return { saved: stats === state.saved.stats ? state.saved : { ...state.saved, stats }, session };
}

export function contextOf(state: EngineState, env: Pick<Env, 'levels' | 'completed'>): Ctx {
  return {
    saved: state.saved,
    session: state.session,
    levels: env.levels,
    completed: env.completed,
    revealed: new Set(state.saved.stats.revealed ?? []),
  };
}

/** A rule's progress toward its target, if it has one. Level milestones count as 0/1. */
export function progressOf(def: AchievementDef, ctx: Ctx): Progress | null {
  if (def.progress) return def.progress(ctx);
  if (def.level) return { value: ctx.completed.has(def.level) ? 1 : 0, target: 1 };
  return null;
}

function holds(def: AchievementDef, e: EngineEvent, ctx: Ctx): boolean {
  if (
    def.level &&
    (ctx.completed.has(def.level) || (e.type === 'level-completed' && e.levelId === def.level))
  )
    return true;
  if (def.progress) {
    const p = def.progress(ctx);
    if (p.target > 0 && p.value >= p.target) return true;
  }
  return def.test?.(e, ctx) === true;
}

export interface EvalResult {
  state: EngineState;
  /** Ids unlocked by this event, in definition order. */
  unlocked: string[];
}

/** Apply an event and unlock everything that now holds. Pure; never re-awards. */
export function evaluate(
  state: EngineState,
  e: EngineEvent,
  env: Env,
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
): EvalResult {
  // A completed level counts even if the caller's completed set is a step behind.
  const completed =
    e.type === 'level-completed' && !env.completed.has(e.levelId)
      ? new Set([...env.completed, e.levelId])
      : env.completed;
  const next = reduce(state, e, env.levels);
  const ctx = contextOf(next, { levels: env.levels, completed });
  const at = env.now.toISOString();
  const unlocked: string[] = [];
  for (const def of defs) {
    if (next.saved.unlocked[def.id]) continue;
    if (holds(def, e, ctx)) unlocked.push(def.id);
  }
  if (!unlocked.length) return { state: next, unlocked };
  const map = { ...next.saved.unlocked };
  for (const id of unlocked) map[id] = { at };
  return { state: { ...next, saved: { ...next.saved, unlocked: map } }, unlocked };
}

const LIST_KEYS: ListKey[] = [
  'tried',
  'firstPass',
  'hinted',
  'revealed',
  'clean',
  'noHints',
  'minimal',
];

/** Union two saved states: earliest unlock time, union of lists, max of counters. Pure. */
export function mergeSaved(
  a: SavedAchievements,
  b: SavedAchievements | undefined,
): SavedAchievements {
  if (!b) return a;
  const unlocked = { ...a.unlocked };
  for (const [id, u] of Object.entries(b.unlocked)) {
    const cur = unlocked[id];
    if (!cur || Date.parse(u.at) < Date.parse(cur.at)) unlocked[id] = { at: u.at };
  }
  const stats: Stats = {};
  const runs = Math.max(a.stats.runs ?? 0, b.stats.runs ?? 0);
  if (runs) stats.runs = runs;
  for (const k of LIST_KEYS) {
    const set = new Set([...(a.stats[k] ?? []), ...(b.stats[k] ?? [])]);
    if (set.size) stats[k] = [...set].sort();
  }
  // ADR-007 holds across devices: a level revealed anywhere loses its skill facts.
  if (stats.revealed?.length) {
    const rev = new Set(stats.revealed);
    for (const k of ['clean', 'noHints', 'minimal'] as const) {
      const kept = stats[k]?.filter((id) => !rev.has(id));
      if (kept?.length) stats[k] = kept;
      else delete stats[k];
    }
  }
  return { unlocked, stats };
}

/** Ids `after` has that `before` did not. */
export const newlyUnlocked = (before: SavedAchievements, after: SavedAchievements): string[] =>
  Object.keys(after.unlocked).filter((id) => !before.unlocked[id]);

/** Deepest chip nesting in a library: a chip with no chips inside is depth 1. Cycles are cut. */
export function chipDepth(
  chips: Record<string, { board: { parts: { type: string; chip?: string }[] }; deleted?: boolean }>,
): number {
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const c = chips[id];
    if (!c || seen.has(id)) return 0;
    seen.add(id);
    let d = 0;
    for (const p of c.board.parts)
      if (p.type === 'chip' && p.chip) d = Math.max(d, depth(p.chip, seen));
    seen.delete(id);
    memo.set(id, d + 1);
    return d + 1;
  };
  let max = 0;
  for (const [id, c] of Object.entries(chips))
    if (!c.deleted) max = Math.max(max, depth(id, new Set()));
  return max;
}

/** Points for the unlocked achievements this app knows. */
export function points(
  saved: SavedAchievements,
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
): number {
  return defs.reduce((sum, d) => sum + (saved.unlocked[d.id] ? TIER_POINTS[d.tier] : 0), 0);
}
