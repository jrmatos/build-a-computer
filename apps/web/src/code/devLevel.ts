/**
 * Development only: an in-memory code level for working on the code
 * workspace before the Phase 6 levels ship. Open it with `?devcode=1` (or
 * `#level=dev-code`). Production builds never return it.
 */
import { Level } from '@build-a-computer/schema';

export const DEV_CODE_LEVEL_ID = 'dev-code';

const STARTER = `# Sum the numbers 1..10 into a0, then exit.
    .text
    .globl _start
_start:
    li   t0, 1          # i = 1
    li   a0, 0          # sum = 0
    li   t1, 10         # limit
loop:
    add  a0, a0, t0     # sum += i
    addi t0, t0, 1
    ble  t0, t1, loop
    la   a1, message
    call print
    li   a7, 93         # exit(a0)
    ecall

    .data
message:
    .asciz "done\\n"
`;

const PRINT = `# Library: print the zero-terminated string at a1 to the UART.
    .globl print
    .equ UART, 0x10000000
print:
    li   t2, UART
1:  lbu  t3, 0(a1)
    beqz t3, 2f
    sb   t3, 0(t2)
    addi a1, a1, 1
    j    1b
2:  ret
`;

let cached: Level | null = null;

/** The dev level, or undefined outside development. */
export function devLevelById(id: string): Level | undefined {
  if (!import.meta.env.DEV || id !== DEV_CODE_LEVEL_ID) return undefined;
  cached ??= Level.parse({
    id: DEV_CODE_LEVEL_ID,
    version: 1,
    track: 'nand-to-os',
    phase: 6,
    order: 99,
    title: 'Dev: code workspace',
    goal: 'Development level for the assembly editor. Put the sum of 1..10 in a0 and exit.',
    tutorial: 'Edit **main.s**. `print.s` is a read-only library file assembled with yours.',
    palette: [],
    starter: { parts: [], wires: [] },
    mode: 'code',
    code: { language: 'rv32-asm', starter: STARTER, devices: ['uart'], library: [{ name: 'print.s', text: PRINT }] },
    tests: [{ kind: 'riscv', name: 'sum of 1..10', expect: { regs: { a0: 55 }, uart: 'done\n' } }],
    draft: true,
  });
  return cached;
}

/** `?devcode=1` opens the dev level (development only). */
export function devLevelFromUrl(url: URL): string | null {
  return import.meta.env.DEV && url.searchParams.get('devcode') ? DEV_CODE_LEVEL_ID : null;
}
