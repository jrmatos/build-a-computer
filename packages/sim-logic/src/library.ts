import type { PartType } from '@build-a-computer/schema';
import { BLOCKS } from './blocks/index';
import type { BlockModel } from './blocks/types';
import { mask, type Signal } from './values';

/**
 * How the engines treat each part type. Pins and widths come from
 * `pinsOf` (parts-spec.ts); this file only says what a part DOES.
 *
 * - source: switch, button, const — outputs a value set from outside.
 * - clock: the global clock.
 * - lamp: a sink.
 * - gate: bitwise and/or/xor/nand/nor/xnor/not over the part's width.
 * - buffer, tristate, splitter, joiner: wiring with one unit of delay.
 * - dff: 1-bit rising-edge D flip-flop (built in).
 * - block: any part type found in BLOCKS, evaluated through BlockModel.
 */
export type PartKind =
  | 'switch'
  | 'button'
  | 'const'
  | 'clock'
  | 'lamp'
  | 'gate'
  | 'buffer'
  | 'tristate'
  | 'splitter'
  | 'joiner'
  | 'dff'
  | 'block';

/** Kept for code that reads `part.behavior.kind` (checkers). */
export interface PartBehavior {
  kind: PartKind;
}

export const G_AND = 0;
export const G_OR = 1;
export const G_XOR = 2;
export const G_NAND = 3;
export const G_NOR = 4;
export const G_XNOR = 5;
export const G_NOT = 6;

export const GATE_OPS: Partial<Record<PartType, number>> = {
  and: G_AND,
  or: G_OR,
  xor: G_XOR,
  nand: G_NAND,
  nor: G_NOR,
  xnor: G_XNOR,
  not: G_NOT,
};

const FIXED: Partial<Record<PartType, PartKind>> = {
  switch: 'switch',
  button: 'button',
  const: 'const',
  clock: 'clock',
  lamp: 'lamp',
  buffer: 'buffer',
  tristate: 'tristate',
  splitter: 'splitter',
  joiner: 'joiner',
  dff: 'dff',
};

/** The kind of a part type, or undefined when the engine cannot run it (yet). */
export function kindOf(type: PartType): PartKind | undefined {
  if (GATE_OPS[type] !== undefined) return 'gate';
  const k = FIXED[type];
  if (k) return k;
  return BLOCKS[type] ? 'block' : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const blockOf = (type: PartType): BlockModel<any> | undefined => BLOCKS[type];

/** Scratch result of `gate`: avoids allocating in the hot loop. */
export interface VX2 {
  v: number;
  x: number;
}

/**
 * Bitwise gate with per-bit X: a bit is X unless the known input bits decide
 * it (0 AND X = 0, 1 OR X = 1, anything XOR X = X). `m` is the width mask.
 * Inputs must have v & x = 0. Writes the result into `out`.
 */
export function gate(op: number, av: number, ax: number, bv: number, bx: number, m: number, out: VX2): void {
  const a0 = ~(av | ax) & m;
  let k1: number;
  let k0: number;
  switch (op) {
    case G_AND:
    case G_NAND:
      k1 = av & bv;
      k0 = a0 | (~(bv | bx) & m);
      break;
    case G_OR:
    case G_NOR:
      k1 = av | bv;
      k0 = a0 & ~(bv | bx) & m;
      break;
    case G_XOR:
    case G_XNOR: {
      const known = ~(ax | bx) & m;
      k1 = (av ^ bv) & known;
      k0 = ~(av ^ bv) & known;
      break;
    }
    default:
      // NOT
      k1 = a0;
      k0 = av;
  }
  if (op >= G_NAND && op <= G_XNOR) {
    const t = k1;
    k1 = k0;
    k0 = t;
  }
  out.v = k1 >>> 0;
  out.x = (m & ~(k1 | k0)) >>> 0;
}

/** Signal form of `gate`, for the reference engine and tests. */
export function gateSignal(op: number, a: Signal, b: Signal, w: number): Signal {
  const out = { v: 0, x: 0 };
  gate(op, a.v, a.x, b.v, b.x, mask(w), out);
  return { w, v: out.v, x: out.x };
}
