import { z } from 'zod';

/**
 * Built-in part types.
 * - I/O: switch (width > 1 = number input), button, const, lamp (width > 1 = value display), clock
 * - Gates: bitwise over `props.width` bits
 * - Wiring: splitter (bus -> chunks), joiner (chunks -> bus), buffer, tristate (Z when en = 0)
 * - Blocks: canonical behavioral models unlocked by levels (plan: behavioral swap)
 * - chip: an instance of a player-made custom chip, `part.chip` = ChipDef id
 */
export const PART_TYPES = [
  'switch',
  'button',
  'const',
  'lamp',
  'clock',
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'buffer',
  'tristate',
  'splitter',
  'joiner',
  'dff',
  'register',
  'counter',
  'ram',
  'rom',
  'mux',
  'decoder',
  'adder',
  'alu',
  // Phase 5 RISC-V datapath blocks (canonical models; pins in sim-logic parts-spec).
  'regfile',
  'immgen',
  'rvalu',
  'branchcmp',
  'lsu',
  'chip',
] as const;
export const PartType = z.enum(PART_TYPES);
export type PartType = z.infer<typeof PartType>;

/** Widest bus in v1. RV32 needs 32; the plan's 64 is deferred (ADR-006). */
export const MAX_WIDTH = 32;

const Id = z.string().min(1).max(64);
const GridCoord = z.number().int().min(-1_000_000).max(1_000_000);
export const Width = z.number().int().min(1).max(MAX_WIDTH);

/** A pin on a part, by stable part id and pin name. */
export const PinRef = z.object({ part: Id, pin: z.string().min(1).max(32) });
export type PinRef = z.infer<typeof PinRef>;

export const Rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Rotation = z.infer<typeof Rotation>;

/** Per-type settings. Every field is optional; defaults live in sim-logic `PART_INFO`. */
export const PartProps = z
  .object({
    /** Bus width in bits: I/O, gates, buffer, tristate, register, counter, mux, adder, alu, ram/rom data, splitter/joiner total. */
    width: Width,
    /** splitter/joiner: bits per chunk (width must be a multiple). Default 1. */
    chunk: Width,
    /** const value; switch initial value for width > 1. Unsigned. */
    value: z.number().int().min(0).max(0xffffffff),
    /** decoder: select bits (1..5). */
    selectBits: z.number().int().min(1).max(5),
    /** ram/rom: address bits (1..16). */
    addrWidth: z.number().int().min(1).max(16),
    /** rom contents: hex bytes/words separated by whitespace, one entry per address. */
    data: z.string().max(1_000_000),
    /** lamp/display: how to show multi-bit values. */
    format: z.enum(['hex', 'dec', 'signed', 'bin']),
  })
  .partial();
export type PartProps = z.infer<typeof PartProps>;

export const Part = z.object({
  id: Id,
  type: PartType,
  /** Grid position of the part's origin, in grid cells. */
  x: GridCoord,
  y: GridCoord,
  rot: Rotation.default(0),
  flip: z.boolean().default(false),
  label: z.string().max(40).optional(),
  /** Level-owned parts (fixed inputs and outputs) cannot be deleted. */
  locked: z.boolean().optional(),
  /** Initial state for 1-bit switches. */
  on: z.boolean().optional(),
  props: PartProps.optional(),
  /** For type 'chip': the ChipDef id. Referenced by id, never by name. */
  chip: Id.optional(),
});
export type Part = z.infer<typeof Part>;

export const Wire = z.object({
  id: Id,
  from: PinRef,
  to: PinRef,
  /** Waypoints in grid cells, between the two pins. */
  points: z.array(z.tuple([GridCoord, GridCoord])).max(256).default([]),
});
export type Wire = z.infer<typeof Wire>;

export const Board = z.object({
  parts: z.array(Part).max(200_000),
  wires: z.array(Wire).max(400_000),
});
export type Board = z.infer<typeof Board>;

export const emptyBoard = (): Board => ({ parts: [], wires: [] });
