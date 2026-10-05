import { Level, type Part, type PartType, type TestSpec, type TruthRow } from '@build-a-computer/schema';

/**
 * Small helpers shared by the level modules (phase0-2, phase3-4, ...).
 * Every level is validated with `Level.parse` when its module loads, so a
 * schema error fails the build.
 */

/** A level as authors write it: schema defaults may be left out. */
export type LevelDraft = Pick<Level, 'id' | 'track' | 'phase' | 'order' | 'title' | 'goal' | 'palette' | 'starter'> &
  Partial<Omit<Level, 'id' | 'track' | 'phase' | 'order' | 'title' | 'goal' | 'palette' | 'starter'>>;

/** Validate a level. New levels are drafts until the owner approves the text. */
export const defineLevel = (l: LevelDraft): Level => Level.parse({ version: 1, draft: true, ...l });

/** A locked level input. `width` > 1 makes it a number input (a "byte switch"). */
export const sw = (label: string, x: number, y: number, width = 1): Part => ({
  id: label,
  type: 'switch',
  x,
  y,
  rot: 0,
  flip: false,
  label,
  locked: true,
  ...(width > 1 ? { props: { width } } : {}),
});

/** A locked level output. `width` > 1 makes it a number display. */
export const lamp = (label: string, x: number, y: number, width = 1, format: 'hex' | 'dec' | 'signed' | 'bin' = 'dec'): Part => ({
  id: label,
  type: 'lamp',
  x,
  y,
  rot: 0,
  flip: false,
  label,
  locked: true,
  ...(width > 1 ? { props: { width, format } } : {}),
});

/** Inputs stacked on the left, outputs on the right, 4 cells apart. */
export function column(make: (label: string, x: number, y: number) => Part, labels: string[], x: number): Part[] {
  const top = -((labels.length - 1) * 4) / 2;
  return labels.map((l, i) => make(l, x, Math.round(top + i * 4)));
}

/** Every combination of 1-bit inputs, in binary counting order (first label = high bit). */
export function truthTable(inputs: string[], f: (i: Record<string, number>) => Record<string, number>): TestSpec {
  const rows: TruthRow[] = [];
  for (let n = 0; n < 1 << inputs.length; n++) {
    const i: Record<string, number> = {};
    inputs.forEach((l, k) => (i[l] = (n >> (inputs.length - 1 - k)) & 1));
    rows.push({ inputs: i, expect: f(i) });
  }
  return { kind: 'truth-table', rows };
}

/** Explicit rows computed by a model (edge cases next to a random test). */
export function rowsOf(cases: Record<string, number>[], f: (i: Record<string, number>) => Record<string, number>): TestSpec {
  return { kind: 'truth-table', rows: cases.map((i) => ({ inputs: i, expect: f(i) })) };
}

/** Palettes grow: each one is the previous plus what the last level unlocked. */
export const grow = (base: readonly PartType[], ...add: PartType[]): PartType[] => [...base, ...add.filter((p) => !base.includes(p))];
