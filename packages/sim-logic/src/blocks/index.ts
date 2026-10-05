import type { PartType } from '@ground-up/schema';
import type { BlockModel } from './types';

/**
 * Behavioral models for built-in blocks, by part type. STUB: the blocks agent
 * fills this (register, counter, ram, rom, mux, decoder, adder, alu). The
 * engine evaluates any part type found here through the BlockModel contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BLOCKS: Partial<Record<PartType, BlockModel<any>>> = {};
