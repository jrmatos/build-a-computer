import type { PartType } from '@ground-up/schema';
import type { BlockModel } from './types';
import { adderModel, aluModel, decoderModel, muxModel } from './arith';
import { counterModel, ramModel, registerModel, romModel } from './memory';

export { adderModel, aluEval, aluModel, decoderModel, muxModel, shiftBits } from './arith';
export { counterModel, parseRomData, ramModel, registerModel, romModel } from './memory';
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
};
