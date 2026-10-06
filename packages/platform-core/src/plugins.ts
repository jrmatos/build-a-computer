/**
 * Track and mode plugins (docs/plan.md "Track plugin interface", ADR-010).
 *
 * The plan sketches one `TrackPlugin` per track. In practice the split that
 * matters to the app is the level's `mode`: a board level, a code level
 * (assembly or C on the RV32 machine) and a JavaScript level each bring their
 * own editor, live machine, test kinds and solution format, and Track 1 uses
 * two of them. So a track plugin names the modes its levels use, and a mode
 * plugin carries everything mode-specific that is not UI code. The web app
 * and the worker add their own halves (React components, checker adapters)
 * keyed by the same mode ids.
 *
 * Everything here is plain data: no simulator, compiler or sandbox imports.
 */
import type { Level, TestSpec } from '@build-a-computer/schema';

export type TrackId = Level['track'];
export type LevelMode = Level['mode'];
export type TestKind = TestSpec['kind'];

/** What the player works in. The plan also names 'graph' and 'quiz' for later tracks. */
export type EditorKind = 'board' | 'code' | 'js';

/** The worker subsystem that runs a level live (code levels load rv32 lazily, js levels the sandbox). */
export type MachineKind = 'logic' | 'rv32' | 'js-sandbox';

/** A track: a sequence of levels with its own unlock graph. */
export interface TrackPlugin {
  id: TrackId;
  /** Level modes this track's levels use. */
  modes: readonly LevelMode[];
  /**
   * Free play (the sandbox): always unlocked, no tests to run, no "next
   * level", listed first on the level map.
   */
  freePlay: boolean;
}

/** One level mode: the non-UI half of a mode's plugin. */
export interface ModePlugin {
  id: LevelMode;
  editor: EditorKind;
  /** What the player edits, saves and is tested on: the board, or source text. */
  work: 'board' | 'source';
  /** The live machine in the worker. */
  machine: MachineKind;
  /** Test kinds this mode's checker runs (others fail with a message). */
  testKinds: readonly TestKind[];
  /** Test cases can be replayed frame by frame on the live board (case debugger). */
  caseReplay: boolean;
  /** The source a level opens with when the player has none saved ('work: source' modes). */
  starter(level: Pick<Level, 'code' | 'js'>): string | undefined;
}

/** One test kind: which mode runs it and how its cases are shaped. */
export interface TestKindSpec {
  kind: TestKind;
  /** The mode whose checker runs it. */
  mode: LevelMode;
  /** Cases drive and read the board's labelled ports. */
  board: boolean;
  /** Every test of this kind is exactly one case (a program run, a call). */
  single: boolean;
}
