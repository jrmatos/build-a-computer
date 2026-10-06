import { JsSetup, type JsModule, type Level, type PartType, type TestSpec } from '@build-a-computer/schema';
import { GPT_JS } from './gpt-lib';

/**
 * Shared pieces of the Track 2 (Neuron to LLM) levels of phases 4 to 7:
 * the level base, 'js' test builders, dataset ids and the read-only tiny GPT
 * library. Player code is an ES module (main.js) whose exports the tests
 * call (docs/js-levels.md). Training levels are seeded and sized for a CPU:
 * a 1-layer transformer with d_model 32 and context 32 trains in seconds.
 * Their models and training loops use the tensor modules, so they run on the
 * GPU when there is one (to('auto'), E-ML-01) with the same tests passing.
 */

export type JsTest = Extract<TestSpec, { kind: 'js' }>;

/** Id of the last Phase 3 level; Phase 4 starts after it. */
export const PHASE3_LAST_ID = 'digit-recognizer';

/** Datasets of these levels (content/datasets/text, LICENSES.md). */
export const MACBETH = 'text-macbeth';
export const SONNETS = 'text-sonnets';
/** Distinct characters of the Macbeth text (the Sonnets use a subset of them). */
export const MACBETH_VOCAB_SIZE = 68;

/** Track 2 levels place no parts. */
const NO_BOARD: Level['starter'] = { parts: [], wires: [] };

/** Fields every level of phases 4 to 7 shares. */
export const base = { track: 'neuron-to-llm' as const, palette: [] as PartType[], starter: NO_BOARD, mode: 'js' as const };

/** Modules unlocked by the end of Phase 3; these levels keep them. */
export const MODULES: JsModule[] = ['tensor', 'autograd', 'nn', 'optim', 'data'];

/** A level's JS setup with the schema defaults filled in. */
export const jsSetup = (s: Partial<JsSetup>): JsSetup => JsSetup.parse({ modules: MODULES, ...s });

/** The read-only helpers around the 'nn' GPT, importable as './gpt.js'. */
export const GPT_LIBRARY = { name: 'gpt.js', text: GPT_JS };

/**
 * A 'js' test comparing `entry(...args)` with `expect`. Numbers match within
 * `tolerance` (E-ML-02: never exact equality for floats).
 */
export function eq(name: string, entry: string, args: unknown[], expect: unknown, tolerance = 1e-6): JsTest {
  return { kind: 'js', name, entry, args, expect, tolerance, seed: 1, timeoutMs: 10_000 };
}

/**
 * A 'js' metric test: `entry(...args)` returns an object whose `m.name` lies
 * in [min, max]. Training levels bound a loss from above (E-ML-02: a
 * statistic with margin, never an exact value).
 */
export function metric(name: string, entry: string, args: unknown[], m: { name: string; min?: number; max?: number }, timeoutMs = 10_000): JsTest {
  return { kind: 'js', name, entry, args, metric: m, tolerance: 1e-6, seed: 1, timeoutMs };
}

/** A fenced JavaScript block for tutorial and hint text. */
export const code = (src: string): string => '```js\n' + src.trim() + '\n```';
