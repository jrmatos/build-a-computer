/**
 * Development only: in-memory code levels for working on the code workspace
 * before the real levels ship. `?devcode=1` (or `#level=dev-code`) opens the
 * assembly level, `?devc=1` (or `#level=dev-c`) the C level. Production
 * builds never return them.
 */
import { Level } from '@build-a-computer/schema';

export const DEV_CODE_LEVEL_ID = 'dev-code';
export const DEV_C_LEVEL_ID = 'dev-c';

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

const C_STARTER = `#include <stdio.h>
#include "util.h"

/* Sum the numbers 1..n. */
int sum_to(int n) {
    int s = 0;
    for (int i = 1; i <= n; i++)
        s += i;
    return s;
}

int main(void) {
    int s = sum_to(10);
    printf("sum = %d\\n", s);
    return square(s) == 3025 ? 0 : 1;
}
`;

const UTIL_H = `#ifndef UTIL_H
#define UTIL_H

/* Library: x * x. */
int square(int x);

#endif
`;

const UTIL_C = `#include "util.h"

int square(int x) {
    return x * x;
}
`;

let cached: Level | null = null;
let cachedC: Level | null = null;

/** A dev level, or undefined outside development. */
export function devLevelById(id: string): Level | undefined {
  if (!import.meta.env.DEV) return undefined;
  if (id === DEV_C_LEVEL_ID) {
    cachedC ??= Level.parse({
      id: DEV_C_LEVEL_ID,
      version: 1,
      track: 'nand-to-os',
      phase: 8,
      order: 99,
      title: 'Dev: C workspace',
      goal: 'Development level for the C editor. Print the sum of 1..10 and return 0 from main.',
      tutorial: 'Edit **main.c**. `util.h` and `util.c` are read-only library files compiled with yours; the **libc** tab lists the headers you can include.',
      palette: [],
      starter: { parts: [], wires: [] },
      mode: 'code',
      code: {
        language: 'c',
        starter: C_STARTER,
        devices: ['uart'],
        library: [
          { name: 'util.h', text: UTIL_H },
          { name: 'util.c', text: UTIL_C },
        ],
      },
      tests: [{ kind: 'riscv', name: 'sum of 1..10', expect: { uart: 'sum = 55\n', exitCode: 0 } }],
      draft: true,
    });
    return cachedC;
  }
  if (id !== DEV_CODE_LEVEL_ID) return undefined;
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

/** `?devcode=1` opens the assembly dev level, `?devc=1` the C one (development only). */
export function devLevelFromUrl(url: URL): string | null {
  if (!import.meta.env.DEV) return null;
  if (url.searchParams.get('devc')) return DEV_C_LEVEL_ID;
  return url.searchParams.get('devcode') ? DEV_CODE_LEVEL_ID : null;
}
