import { JsSetup, type JsModule, type Level, type PartType, type TestSpec } from '@build-a-computer/schema';

/**
 * Shared pieces of the Track 2 (Neuron to LLM) levels of phases 1 to 3:
 * the level base, a 'js' test builder and small helpers for the tutorial
 * text. Player code is an ES module (main.js); tests call its exports
 * (docs/js-levels.md).
 */

export type JsTest = Extract<TestSpec, { kind: 'js' }>;

/** Track 2 levels place no parts. */
export const NO_BOARD: Level['starter'] = { parts: [], wires: [] };

/** Fields every Track 2 level of phases 1 to 3 shares. */
export const base = { track: 'neuron-to-llm' as const, palette: [] as PartType[], starter: NO_BOARD, mode: 'js' as const };

/** A level's JS setup with the schema defaults filled in. */
export const jsSetup = (s: Partial<JsSetup>): JsSetup => JsSetup.parse(s);

/** A 'js' test that compares `entry(...args)` with `expect` (numbers within `tolerance`). */
export function eq(name: string, entry: string, args: unknown[], expect: unknown, tolerance = 1e-6): JsTest {
  return { kind: 'js', name, entry, args, expect, tolerance, seed: 1, timeoutMs: 10_000 };
}

/** A 'js' metric test: `entry(...args)` returns an object whose `metric` lies in [min, max]. */
export function metric(
  name: string,
  entry: string,
  args: unknown[],
  m: { name: string; min?: number; max?: number },
  opts: { seed?: number; timeoutMs?: number } = {},
): JsTest {
  return { kind: 'js', name, entry, args, metric: m, tolerance: 1e-6, seed: opts.seed ?? 1, timeoutMs: opts.timeoutMs ?? 10_000 };
}

/** A fenced JavaScript block for tutorial and hint text. */
export const code = (src: string): string => '```js\n' + src.trim() + '\n```';

/** Modules unlocked so far, by level group (they only grow). */
export const MODULES = {
  none: [] as JsModule[],
  tensor: ['tensor'] as JsModule[],
  autograd: ['tensor', 'autograd'] as JsModule[],
  nn: ['tensor', 'autograd', 'nn', 'optim'] as JsModule[],
  data: ['tensor', 'autograd', 'nn', 'optim', 'data'] as JsModule[],
};
