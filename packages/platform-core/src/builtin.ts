/**
 * The built-in tracks and modes, as data. The simulators, compilers and
 * sandboxes behind them live in their own packages and are wired up by the
 * worker (checker adapters) and the app (workspaces, panels); platform-core
 * imports none of them.
 */
import type { Level } from '@build-a-computer/schema';
import type { LevelMode, ModePlugin, TestKind, TestKindSpec, TrackId, TrackPlugin } from './plugins';
import { Registry } from './registry';

/** Board levels: wire parts on the canvas, checked on the logic simulator. */
export const BOARD_MODE: ModePlugin = {
  id: 'board',
  editor: 'board',
  work: 'board',
  machine: 'logic',
  testKinds: ['truth-table', 'exhaustive', 'random', 'sequence', 'program'],
  caseReplay: true,
  starter: () => undefined,
};

/** Code levels (Phase 6+): assembly or C, run on the RV32 machine. */
export const CODE_MODE: ModePlugin = {
  id: 'code',
  editor: 'code',
  work: 'source',
  machine: 'rv32',
  testKinds: ['riscv'],
  caseReplay: false,
  starter: (level) => level.code?.starter,
};

/** Track 2 levels: the player's JavaScript module, run in the sandbox. */
export const JS_MODE: ModePlugin = {
  id: 'js',
  editor: 'js',
  work: 'source',
  machine: 'js-sandbox',
  testKinds: ['js'],
  caseReplay: false,
  starter: (level) => level.js?.starter,
};

/** Built-in test kinds. A Record, so a new schema kind without a plugin fails to compile. */
export const TEST_KINDS: Record<TestKind, TestKindSpec> = {
  'truth-table': { kind: 'truth-table', mode: 'board', board: true, single: false },
  exhaustive: { kind: 'exhaustive', mode: 'board', board: true, single: false },
  random: { kind: 'random', mode: 'board', board: true, single: false },
  sequence: { kind: 'sequence', mode: 'board', board: true, single: false },
  program: { kind: 'program', mode: 'board', board: true, single: true },
  riscv: { kind: 'riscv', mode: 'code', board: false, single: true },
  js: { kind: 'js', mode: 'js', board: false, single: true },
};

/** Built-in modes, keyed like the schema's `Level.mode`. */
export const MODES: Record<LevelMode, ModePlugin> = { board: BOARD_MODE, code: CODE_MODE, js: JS_MODE };

/** Built-in tracks, keyed like the schema's `Level.track`. */
export const TRACKS: Record<TrackId, TrackPlugin> = {
  'nand-to-os': { id: 'nand-to-os', modes: ['board', 'code'], freePlay: false },
  'neuron-to-llm': { id: 'neuron-to-llm', modes: ['js'], freePlay: false },
  sandbox: { id: 'sandbox', modes: ['board'], freePlay: true },
};

/** A registry with the built-in modes, test kinds and tracks. */
export function builtinRegistry(): Registry {
  const r = new Registry();
  const kinds = Object.values(TEST_KINDS);
  for (const m of Object.values(MODES)) r.registerMode(m, kinds.filter((k) => k.mode === m.id).map(({ mode: _mode, ...k }) => k));
  for (const t of Object.values(TRACKS)) r.registerTrack(t);
  return r;
}

/** The registry the app and the worker use. */
export const registry: Registry = builtinRegistry();

/** The mode plugin of a level (or mode id). */
export const modeOf = (of: LevelMode | Pick<Level, 'mode'> | null | undefined): ModePlugin => registry.mode(of);

/** The track plugin of a level (or track id). */
export const trackOf = (of: TrackId | Pick<Level, 'track'>): TrackPlugin => registry.track(typeof of === 'string' ? of : of.track);

/** How a test kind's cases are shaped and which mode runs it. */
export const testKindOf = (kind: TestKind): TestKindSpec => registry.testKind(kind);

/** True for kinds whose cases drive the board's labelled ports (and can be replayed on it). */
export const isBoardKind = (kind: TestKind): boolean => registry.testKind(kind).board;

/** Every test kind the app can run. */
export const allTestKinds = (): TestKind[] => registry.allTestKinds();

/** Test kinds that run on the board. */
export const boardKinds = (): TestKind[] => registry.allTestKinds().filter(isBoardKind);

/** True when the player's work on this level is source text (code and js levels), not a board. */
export const isSourceLevel = (level: Pick<Level, 'mode'> | null | undefined): boolean => !!level && modeOf(level).work === 'source';
