import type { Board, ChipMap } from '@ground-up/schema';

export interface FlattenResult {
  board: Board;
  /** Flat part id -> path of instance ids from the root, for diagnostics and probes. */
  origin: Map<string, string[]>;
}

/**
 * Inline custom chips into one flat board (SIM-02). STUB: returns the board
 * unchanged; the chips agent replaces it. Contract: flat ids are
 * `${instanceId}/${innerId}` (nested: `a/b/c`); outer wires to a chip pin are
 * joined to the inner port's net with zero delay; chips with `model` and no
 * `simulateGates` become that built-in block; self-inclusion throws
 * ChipCycleError (E-SIM-05).
 */
export function flattenBoard(board: Board, _chips: ChipMap = {}): FlattenResult {
  return { board, origin: new Map() };
}

export class ChipCycleError extends Error {
  constructor(readonly path: string[]) {
    super(`A chip cannot contain itself: ${path.join(' → ')}`);
    this.name = 'ChipCycleError';
  }
}
