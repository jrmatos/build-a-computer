/**
 * Level-runner policies shared by every mode: when tests run, how hints are
 * revealed and when "Show solution" (ADR-007) is offered.
 */
import type { Level } from '@build-a-computer/schema';
import { modeOf, trackOf } from './builtin';

/**
 * Tests run on levels of tracks that are not free play, once they plan at
 * least one case (`plannedCases` comes from the app's test plan).
 */
export function canRunTests(level: Pick<Level, 'track'> | null | undefined, plannedCases: number): boolean {
  return !!level && !trackOf(level.track).freePlay && plannedCases > 0;
}

/** Hints are revealed one at a time, in order. */
export interface HintState {
  /** Hints the player has opened. */
  shown: readonly string[];
  /** 1-based number of the next hint, or null when all are shown. */
  next: number | null;
  total: number;
}

export function hintState(level: Pick<Level, 'hints'>, opened: number): HintState {
  const total = level.hints.length;
  const n = Math.max(0, Math.min(Math.floor(opened), total));
  return { shown: level.hints.slice(0, n), next: n < total ? n + 1 : null, total };
}

/**
 * "Show solution" is offered on levels with tests, but not while the player
 * edits a chip's inside (the solution is the level's, not the chip's).
 */
export function canShowSolution(level: Pick<Level, 'tests'>, opts: { inChip: boolean }): boolean {
  return level.tests.length > 0 && !opts.inChip;
}

/** What a reference solution replaces: the board, or the editor's source. */
export const solutionKind = (level: Pick<Level, 'mode'>): 'board' | 'source' => modeOf(level).work;

/** The source a level opens with: the saved source, else the mode's starter, else empty. */
export function initialSource(level: Pick<Level, 'mode' | 'code' | 'js'>, saved?: string | null): string {
  return saved ?? modeOf(level).starter(level) ?? '';
}

/** Source to store in a save: source-based modes only, so board saves stay unchanged. */
export function sourceToSave(level: Pick<Level, 'mode'>, source: string): string | undefined {
  return modeOf(level).work === 'source' ? source : undefined;
}
