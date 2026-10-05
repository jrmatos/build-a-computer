import type { PartType } from '@build-a-computer/schema';
import type { BlockModel } from './types';
import { adderModel, aluModel, decoderModel, muxModel } from './arith';
import { counterModel, ramModel, registerModel, romModel } from './memory';
import { branchcmpModel, immgenModel, lsuModel, regfileModel, rvaluModel } from './rv';

export { adderModel, aluEval, aluModel, decoderModel, muxModel, shiftBits } from './arith';
export { counterModel, parseRomData, ramModel, registerModel, romModel } from './memory';
export {
  branchcmpModel,
  branchTaken,
  immFormat,
  immgenModel,
  immOf,
  lsuLoad,
  lsuMisaligned,
  lsuModel,
  lsuStore,
  regfileModel,
  RV_ALU_OPS,
  rvAluOp,
  rvaluModel,
} from './rv';
export type { RegFileState } from './rv';
export type { RamState, RegisterState, RomParseError, RomParseResult, RomState } from './memory';

/**
 * Behavioral models for built-in blocks, by part type. The engine evaluates
 * any part type found here through the BlockModel contract. Pin order follows
 * `pinsOf(part)` (inputs only for `inputs`, outputs only for the result).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BLOCKS: Partial<Record<PartType, BlockModel<any>>> = {
  register: registerModel,
  counter: counterModel,
  ram: ramModel,
  rom: romModel,
  mux: muxModel,
  decoder: decoderModel,
  adder: adderModel,
  alu: aluModel,
  regfile: regfileModel,
  immgen: immgenModel,
  rvalu: rvaluModel,
  branchcmp: branchcmpModel,
  lsu: lsuModel,
};
