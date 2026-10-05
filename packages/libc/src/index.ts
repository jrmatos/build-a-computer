/**
 * Small C library for C levels (plan: packages/libc, CC-06). The C and
 * assembly live in `lib/` (readable files, built by GCC for the golden tests);
 * `src/generated.ts` carries the same text as strings for the browser.
 *
 * - crt0.s: `_start` zeroes .bss, calls `main(0, NULL)`, and passes its return
 *   value to `exit` (ecall a7 = 93, code in a0). `exit`/`_exit` live here too.
 * - stdio.c: putchar, puts, getchar over the UART (polling LSR), printf,
 *   sprintf, snprintf, vprintf, vsnprintf (%d %i %u %x %X %o %c %s %p %%,
 *   width, '0' and '-' flags, `*`, precision for %s, l/h ignored).
 * - stdlib.c: malloc, free, calloc, realloc (first-fit free list sorted by
 *   address, coalescing on free; heap from `_end` up to sp - 4 KiB), atoi,
 *   abs, rand/srand (LCG, RAND_MAX 32767), abort, __assert_fail.
 * - string.c, ctype.c: the usual functions, one byte at a time.
 * - end.s: `_end` / `__bss_end`, the first byte after all globals.
 *
 * Link order matters: crt0.s first (so `__bss_start` is the start of .bss and
 * `_start` is at the RAM base) and end.s last (so `_end` is past every
 * global). `withLibc` returns the files in that order. Linking program files
 * before LIBC_SOURCES (as rv-check does) also works: end.s is still last, and
 * crt0 then zeroes only libc's .bss, which is harmless because the loader
 * starts with RAM zeroed. Never link anything after end.s: the heap would
 * overlap its globals.
 */

import { HEADER_FILES, SOURCE_FILES } from './generated';

export interface LibFile {
  name: string;
  text: string;
}

/** Header files by name, passed to the compiler for #include <...>. */
export const LIBC_HEADERS: Record<string, string> = Object.fromEntries(
  HEADER_FILES.map((f) => [f.name, f.text]),
);

const byName = (name: string): LibFile => {
  const f = SOURCE_FILES.find((s) => s.name === name);
  if (!f) throw new Error(`libc: missing ${name}`);
  return { name: f.name, text: f.text };
};

/** Startup code; link it first. */
export const LIBC_CRT0: LibFile = byName('crt0.s');
/** End-of-program marker (`_end`); link it last. */
export const LIBC_END: LibFile = byName('end.s');
/** The C files of the library (`.c`, compiled with @build-a-computer/cc). */
export const LIBC_C_SOURCES: LibFile[] = SOURCE_FILES.filter((f) => f.name.endsWith('.c')).map(
  (f) => ({
    name: f.name,
    text: f.text,
  }),
);

/**
 * Sources linked into every C level that keeps `libc: true`: `.s` assembled,
 * `.c` compiled. In link order: crt0.s, the C files, end.s. Program files go
 * after crt0.s and before end.s; `withLibc` does that.
 */
export const LIBC_SOURCES: LibFile[] = [LIBC_CRT0, ...LIBC_C_SOURCES, LIBC_END];

/** The player's (and level's) files wrapped in libc, in link order: crt0.s, files, libc C files, end.s. */
export function withLibc<T extends LibFile>(files: readonly T[]): (T | LibFile)[] {
  return [LIBC_CRT0, ...files, ...LIBC_C_SOURCES, LIBC_END];
}
