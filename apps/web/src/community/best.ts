/**
 * Local best results per level (COM-04). Honor system: the numbers come from
 * this device's test runs and never leave it. Each metric keeps its own best
 * (fewest parts, fewest wires, fewest cycles); a new level version starts over
 * because its tests may have changed.
 */
import { create } from 'zustand';
import type { CaseResult } from '@build-a-computer/sim-logic';
import type { Board, Level } from '@build-a-computer/schema';
import { communityDb, communityWrite } from './db';

export type Metric = 'parts' | 'wires' | 'cycles';

export interface BestEntry {
  levelId: string;
  levelVersion: number;
  /** Parts the player placed (level-owned starter parts are not counted). Board levels. */
  parts?: number;
  wires?: number;
  /**
   * Clock work the tests needed: per test, the largest `cycle` a case reported
   * (sequence: half-periods; program: cycles; code levels: instructions
   * executed), summed over tests. Absent for combinational levels.
   */
  cycles?: number;
  /** 'instructions' for code levels, 'ticks'/'cycles' for clocked boards. */
  cycleUnit?: 'ticks' | 'cycles' | 'instructions';
  at: string;
}

export interface BestUpdate {
  entry: BestEntry;
  /** Metrics that got better (empty on the first result for a level). */
  improved: Metric[];
  first: boolean;
}

/** Measure one passing run. */
export function measure(level: Level, board: Board, cases: readonly CaseResult[], now = new Date()): BestEntry {
  const entry: BestEntry = { levelId: level.id, levelVersion: level.version, at: now.toISOString() };
  if (level.mode === 'board') {
    const starter = new Set(level.starter.parts.map((p) => p.id));
    entry.parts = board.parts.filter((p) => !p.locked && !starter.has(p.id)).length;
    entry.wires = board.wires.length;
  }
  const perTest = new Map<number, number>();
  let kind: CaseResult['kind'];
  for (const c of cases) {
    if (typeof c.cycle !== 'number' || !Number.isFinite(c.cycle)) continue;
    const ti = c.test ?? 0;
    perTest.set(ti, Math.max(perTest.get(ti) ?? 0, c.cycle));
    kind ??= c.kind;
  }
  if (perTest.size) {
    entry.cycles = [...perTest.values()].reduce((a, b) => a + b, 0);
    entry.cycleUnit = level.mode === 'code' || kind === 'riscv' ? 'instructions' : kind === 'program' ? 'cycles' : 'ticks';
  }
  return entry;
}

const better = (a: number | undefined, b: number | undefined): boolean => b !== undefined && (a === undefined || b < a);

/** Merge a new result into the stored best: each metric keeps its minimum. Pure. */
export function mergeBest(prev: BestEntry | undefined, next: BestEntry): BestUpdate {
  if (!prev || prev.levelId !== next.levelId || next.levelVersion > prev.levelVersion) return { entry: next, improved: [], first: true };
  // A result for an older level version never replaces the current record.
  if (next.levelVersion < prev.levelVersion) return { entry: prev, improved: [], first: false };
  const improved: Metric[] = [];
  const entry: BestEntry = { ...prev };
  for (const m of ['parts', 'wires', 'cycles'] as const) {
    if (better(prev[m], next[m])) {
      entry[m] = next[m];
      improved.push(m);
      if (m === 'cycles' && next.cycleUnit) entry.cycleUnit = next.cycleUnit;
    }
  }
  if (improved.length) entry.at = next.at;
  return { entry, improved, first: false };
}

/** Validate a stored record (never throws). */
export function decodeBest(raw: unknown, key: string): BestEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (r.levelId !== key || !int(r.levelVersion) || typeof r.at !== 'string') return null;
  const out: BestEntry = { levelId: key, levelVersion: r.levelVersion as number, at: r.at };
  for (const m of ['parts', 'wires', 'cycles'] as const) if (int(r[m])) out[m] = r[m] as number;
  if (r.cycleUnit === 'ticks' || r.cycleUnit === 'cycles' || r.cycleUnit === 'instructions') out.cycleUnit = r.cycleUnit;
  return out;
}

// ---------------------------------------------------------------- store

interface BestState {
  best: Record<string, BestEntry>;
  /** The last update, for the success card ("New best!"). */
  last: (BestUpdate & { levelId: string }) | null;
}

export const useBest = create<BestState>()(() => ({ best: {}, last: null }));

let loaded: Promise<void> | null = null;

export function loadBest(): Promise<void> {
  loaded ??= communityDb()
    .then((s) => s.all('best'))
    .then((rows) => {
      const best: Record<string, BestEntry> = {};
      for (const [k, v] of rows) {
        const e = decodeBest(v, k);
        if (e) best[k] = e;
      }
      useBest.setState((s) => ({ best: { ...best, ...s.best } }));
    })
    .catch((e: unknown) => console.error(e));
  return loaded;
}

/** Record a passing run; returns what changed. */
export async function recordBest(level: Level, board: Board, cases: readonly CaseResult[]): Promise<BestUpdate | null> {
  if (level.track === 'sandbox') return null;
  await loadBest();
  const update = mergeBest(useBest.getState().best[level.id], measure(level, board, cases));
  useBest.setState((s) => ({ best: { ...s.best, [level.id]: update.entry }, last: { ...update, levelId: level.id } }));
  if (update.first || update.improved.length) await communityWrite((s) => s.put('best', level.id, update.entry));
  return update;
}
