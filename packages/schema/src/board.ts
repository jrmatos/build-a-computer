import { z } from 'zod';

/** Built-in part types. Custom chips (M4) will add `chip:<id>` types. */
export const PART_TYPES = [
  'switch',
  'lamp',
  'clock',
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'dff',
] as const;
export const PartType = z.enum(PART_TYPES);
export type PartType = z.infer<typeof PartType>;

const Id = z.string().min(1).max(64);
const GridCoord = z.number().int().min(-1_000_000).max(1_000_000);

/** A pin on a part, by stable part id and pin name. */
export const PinRef = z.object({ part: Id, pin: z.string().min(1).max(32) });
export type PinRef = z.infer<typeof PinRef>;

export const Rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Rotation = z.infer<typeof Rotation>;

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
  /** Initial state for switches. */
  on: z.boolean().optional(),
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
