/**
 * @ground-up/asm: RV32IMA assembler, flat-image linker and disassembler.
 *
 * - `assemble(source)` -> relocatable object + diagnostics (ASM-01)
 * - `link(objects)` / `build(source)` -> flat image, symbols, source map (ASM-02)
 * - `disassemble(bytes, base)` / `disassembleWord(word, pc)` (ASM-02)
 * - `tokenize(source)` -> classified tokens with ranges for the editor (ASM-03)
 * - `encode` / `decode` and the encoding table (to be shared with rv32)
 */

export * from './encoding';
export * from './lexer';
export * from './diagnostics';
export type { Expr, Value } from './expr';
export type { Fixup, FixupKind } from './fixups';
export * from './assembler';
export * from './linker';
export * from './disasm';
