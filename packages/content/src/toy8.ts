/**
 * Toy-8: the 8-bit teaching CPU of Phase 4 (TOY-01). STUB: the Phase 3/4
 * content agent writes the spec (docs/toy8.md), the reference model and
 * these helpers; the machine-code editor imports them.
 */
export interface Toy8Instruction {
  mnemonic: string;
  /** Instruction length in bytes. */
  size: number;
}

/** Decode the instruction at `bytes[0..]` for the mnemonic preview. */
export function disassemble(_bytes: ArrayLike<number>): Toy8Instruction & { text: string } {
  return { mnemonic: '?', size: 1, text: '?' };
}

/** Assemble one line of Toy-8 assembly into bytes, or throw with a message. */
export function assembleLine(_line: string): number[] {
  throw new Error('Toy-8 assembler not implemented yet');
}
