/**
 * Small C library for C levels (plan: packages/libc): crt0 (sets up the stack
 * and bss, calls main, exits with its return value via ecall 93), stdio over
 * the UART (putchar, puts, printf subset, getchar), string.h, stdlib (malloc,
 * free, atoi, abs, exit), ctype.h, and a few machine helpers for OS levels.
 * STUB: the libc agent writes the sources.
 */

export interface LibFile {
  name: string;
  text: string;
}

/** Header files by name, passed to the compiler for #include <...>. */
export const LIBC_HEADERS: Record<string, string> = {};

/** Sources linked into every C level that keeps `libc: true`: `.s` assembled, `.c` compiled. */
export const LIBC_SOURCES: LibFile[] = [];
