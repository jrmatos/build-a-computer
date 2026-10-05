import { z } from 'zod';
import { Board, PartType } from './board';

const Id = z.string().min(1).max(64);

/**
 * A player-made custom chip ("Make chip", plan: Custom chips).
 * Its ports are the switches (inputs) and lamps (outputs) on its board,
 * in the order the player chose. Chips reference other chips by id only,
 * never contain themselves (E-SIM-05), and leave a tombstone when deleted
 * so old saves still load (E-DATA-08).
 */
export const ChipDef = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  /** Bumped on every edit of the definition. */
  version: z.number().int().min(1),
  board: Board,
  ports: z.object({
    /** Ids of switch parts on `board`, top to bottom on the chip's left edge. */
    inputs: z.array(Id).max(64),
    /** Ids of lamp parts on `board`, top to bottom on the chip's right edge. */
    outputs: z.array(Id).max(64),
  }),
  /** Tile color, a CSS hex like #4c6ef5. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Behavioral swap: a verified equivalent built-in block runs instead of the gates (CHIP-04). */
  model: PartType.optional(),
  /** Debug toggle: run the player's gates even when a model is available. */
  simulateGates: z.boolean().optional(),
  /** Tombstone: deleted, kept so boards that use it still load. */
  deleted: z.boolean().optional(),
});
export type ChipDef = z.infer<typeof ChipDef>;

export const ChipMap = z.record(Id, ChipDef);
export type ChipMap = z.infer<typeof ChipMap>;
