import type { Part } from '@build-a-computer/schema';
import type { Signal } from '../values';

/**
 * A behavioral model for a built-in block (register, RAM, adder, ALU, ...).
 * Canonical models double as the fast "behavioral swap" for verified player
 * chips (plan: Behavioral swap). Models are pure: no DOM, clock or randomness
 * except through `rng`.
 *
 * Inputs and outputs follow `pinsOf(part)` order (inputs only / outputs only).
 */
export interface BlockModel<S = unknown> {
  /** Fresh state at power on. `mode` follows the level's power setting (E-SIM-07). */
  init(part: Part, mode: 'zero' | 'random', rng: { nextU32(): number }): S;
  /** Outputs from the current inputs and state (combinational read). */
  outputs(inputs: readonly Signal[], state: S, part: Part): Signal[];
  /**
   * Rising edge of `clk` (clocked parts only): returns the next state. Inputs are sampled before the edge.
   * Models may update large state in place and return the same object (RAM does), so engines must
   * not keep the old state expecting it to stay unchanged. `inputs` includes the `clk` pin, which
   * models ignore: the engine decides when an edge happened (an X clock never fires).
   */
  clock?(inputs: readonly Signal[], state: S, part: Part): S;
  /** State survives power off (ROM). */
  nonVolatile?: boolean;
  /** Read-only view of memory for the CPU/memory panels (RAM, ROM, register). */
  inspect?(state: S): ArrayLike<number>;
}
