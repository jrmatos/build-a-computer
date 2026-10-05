import type { PartType } from '@ground-up/schema';
import { and, nand, not, or, xor, type Value } from './values';

/** How the engine treats a part. */
export type PartBehavior =
  | { kind: 'gate'; eval: (inputs: readonly number[]) => Value }
  | { kind: 'switch' }
  | { kind: 'lamp' }
  | { kind: 'clock' }
  | { kind: 'dff' };

export interface PartLogic {
  inputs: readonly string[];
  outputs: readonly string[];
  behavior: PartBehavior;
}

const gate2 = (fn: (a: number, b: number) => Value): PartLogic => ({
  inputs: ['a', 'b'],
  outputs: ['out'],
  behavior: { kind: 'gate', eval: (i) => fn(i[0]!, i[1]!) },
});

/** Pin names and behavior for every built-in part. Geometry lives in the editor. */
export const LIBRARY: Record<PartType, PartLogic> = {
  switch: { inputs: [], outputs: ['out'], behavior: { kind: 'switch' } },
  lamp: { inputs: ['in'], outputs: [], behavior: { kind: 'lamp' } },
  clock: { inputs: [], outputs: ['out'], behavior: { kind: 'clock' } },
  nand: gate2(nand),
  not: { inputs: ['in'], outputs: ['out'], behavior: { kind: 'gate', eval: (i) => not(i[0]!) } },
  and: gate2(and),
  or: gate2(or),
  nor: gate2((a, b) => not(or(a, b))),
  xor: gate2(xor),
  xnor: gate2((a, b) => not(xor(a, b))),
  dff: { inputs: ['d', 'clk'], outputs: ['q'], behavior: { kind: 'dff' } },
};
