import { CodeSetup, type Level, type TestSpec } from '@build-a-computer/schema';

/**
 * Shared pieces of the Phase 6 (Assembly) code levels: test builders,
 * byte helpers and the read-only library files some levels assemble with
 * the player's source. Conventions (RAM base, sp, exit) follow
 * docs/code-levels.md.
 */

/**
 * Id of the last required Phase 5 level; Phase 6 starts after it. (The
 * optional 'rv-pipeline' after it must not gate Phase 6.)
 */
export const PHASE5_LAST_ID = 'running-programs';

/** Where the program image is loaded: the start of RAM. */
export const RAM_BASE = 0x8000_0000;

/** Where tests poke input data (arrays, strings): 64 KiB into RAM, far from code and stack. */
export const DATA = 0x8001_0000;

/** UART transmit register: a byte stored here is printed. */
export const UART = 0x1000_0000;

/** A level's code setup with the schema defaults filled in (1 MiB of RAM, no library). */
export const code = (c: Partial<Omit<CodeSetup, 'language'>>): CodeSetup =>
  CodeSetup.parse({ language: 'rv32-asm', ...c });

/** Code levels place no parts. */
export const NO_BOARD: Level['starter'] = { parts: [], wires: [] };

export type RiscvTest = Extract<TestSpec, { kind: 'riscv' }>;
type Setup = NonNullable<RiscvTest['setup']>;

/** A 'riscv' test case. */
export function rv(name: string, setup: Setup | undefined, expect: RiscvTest['expect'], maxSteps = 100_000): RiscvTest {
  return { kind: 'riscv', name, ...(setup ? { setup } : {}), expect, maxSteps };
}

/** A 32-bit value as an unsigned number (what tests compare). */
export const u32 = (n: number): number => n >>> 0;

/** Hex of 32-bit words, little-endian, as memory bytes. */
export function wordsHex(words: readonly number[]): string {
  return words
    .map((w) => {
      const v = w >>> 0;
      return [0, 8, 16, 24].map((s) => ((v >>> s) & 0xff).toString(16).padStart(2, '0')).join('');
    })
    .join('');
}

/** Hex of an ASCII string's bytes plus a terminating 0 byte. */
export const cstringHex = (s: string): string =>
  [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '00';

/** Values the library's `_start` puts in s0-s3 before calling the player's function. */
export const SENTINELS = { s0: 0x5eed_0000, s1: 0x5eed_1111, s2: 0x5eed_2222, s3: 0x5eed_3333 } as const;

/**
 * A read-only `_start` that calls the player's `fn` with the test's a0,
 * then exits with the result. Before the call it saves sp and fills s0-s3
 * with sentinels; after it, a1 = how far sp moved (must be 0), so a test
 * can check that the function kept the calling convention.
 */
export function callerLibrary(fn: string, extra = ''): string {
  return `# Provided by the level (read only). Runs first: it calls your ${fn}.
    .text
    .globl _start
_start:
    la   t0, saved_sp
    sw   sp, 0(t0)          # remember sp
    li   s0, ${hex(SENTINELS.s0)}     # values your function must preserve
    li   s1, ${hex(SENTINELS.s1)}
    li   s2, ${hex(SENTINELS.s2)}
    li   s3, ${hex(SENTINELS.s3)}
    call ${fn}               # a0 in, a0 out
    la   t0, saved_sp
    lw   t0, 0(t0)
    sub  a1, sp, t0         # a1 = 0 when sp came back where it was
    li   a7, 93             # exit, code in a0
    ecall
${extra}
    .data
saved_sp:
    .word 0
`;
}

/** What every caller-library test expects besides the result: s0-s3 kept and sp restored. */
export const KEPT = { ...SENTINELS, a1: 0 };

const hex = (n: number): string => '0x' + (n >>> 0).toString(16);
