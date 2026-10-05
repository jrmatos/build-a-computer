import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../define';
import { DATA, KEPT, NO_BOARD, callerLibrary, code, rv, u32, wordsHex } from '../phase6/common';
import {
  FUNCTIONS_H,
  FUNCTIONS_HARNESS,
  GEOM_H,
  HEAP_HARNESS,
  LIST_H,
  PHASE7_LAST_REQUIRED_ID,
  POINTERS_H,
  POINTERS_HARNESS,
  type Rect,
  STRINGS_HARNESS,
  STRUCTS_HARNESS,
  cCode,
  clampSum,
  collatzModel,
  compileModel,
  functionsModel,
  heapInput,
  heapModel,
  pointersModel,
  reportLine,
  structsModel,
} from './common';

/**
 * Phase 8, C: translating C to assembly by hand, variables and control flow,
 * functions, pointers and arrays, structs, strings and printf, the heap, and
 * (optional) a compiler. From the second level on the player writes main.c;
 * it is compiled by @build-a-computer/cc and linked with libc and the
 * level's read-only harness. DRAFT text (owner approves). CNT-10.
 */

const base = {
  track: 'nand-to-os' as const,
  phase: 8,
  palette: [] as Level['palette'],
  starter: NO_BOARD,
  mode: 'code' as const,
};

/** A fenced C snippet for a tutorial. */
const c = (src: string): string => '```c\n' + src.trim() + '\n```';
/** A fenced assembly snippet for a tutorial. */
const s = (src: string): string => '```asm\n' + src.trim() + '\n```';

/** A test that types `input` into the UART and checks the console and the exit code. */
const io = (
  name: string,
  input: string,
  uart: string,
  exitCode: number | undefined,
  maxSteps: number,
) => ({
  ...rv(
    name,
    undefined,
    exitCode === undefined ? { uart } : { uart, exitCode: u32(exitCode) },
    maxSteps,
  ),
  input,
});

// ------------------------------------------------------------- test cases

const clampCase = (name: string, xs: number[], lo: number, hi: number) => {
  const sum = u32(clampSum(xs, lo, hi));
  return rv(
    name,
    {
      regs: { a0: DATA, a1: xs.length, a2: u32(lo), a3: u32(hi) },
      memory: [{ addr: DATA, hex: wordsHex(xs) }],
    },
    { regs: { a0: sum, ...KEPT }, exitCode: sum },
    20_000,
  );
};

const collatzCase = (n: number) => {
  const m = collatzModel(n);
  return io(`n = ${n}`, `${n}\n`, m.uart, m.steps, 5_000_000);
};

const functionsCase = (a: number, b: number, n: number) => {
  const m = functionsModel(a, b, n);
  return io(`gcd(${a}, ${b}), ${n} disks`, `${a} ${b} ${n}\n`, m.uart, m.moves, 10_000_000);
};

const pointersCase = (name: string, nums: number[]) => {
  const m = pointersModel(nums);
  return io(name, `${nums.length}\n${nums.join(' ')}\n`, m.uart, m.exitCode, 2_000_000);
};

const structsCase = (name: string, rects: Rect[]) => {
  const m = structsModel(rects);
  const input = `${rects.length}\n` + rects.map((r) => r.join(' ') + '\n').join('');
  return io(name, input, m.uart, m.overlaps, 5_000_000);
};

const stringsCase = (name: string, lines: string[]) =>
  io(
    name,
    `${lines.length}\n` + lines.map((l) => l + '\n').join(''),
    lines.map((l, i) => reportLine(i + 1, l)).join(''),
    lines.length,
    5_000_000,
  );

/** RAM for the heap level: small, so the leak check (count every node that fits) stays quick. */
export const HEAP_RAM = 128 * 1024;

const heapCase = (name: string, nums: number[], gone: number) =>
  io(name, heapInput(nums, gone), heapModel(nums, gone), 0, 20_000_000);

const compilerCase = (name: string, expr: string) =>
  io(name, `${expr}\n`, compileModel(expr), 0, 5_000_000);

/** The expressions the compiler level's tests compile (also run by phase8.test.ts). */
export const COMPILER_EXPRESSIONS: Record<string, string> = {
  'one number': '42',
  'precedence: 2 + 3 * 4': '2 + 3 * 4',
  parentheses: '2 + 3 * (4 - 1)',
  'left to right: 10 - 4 - 3': '10 - 4 - 3',
  'division and remainder': '100 / 7 % 4',
  'nested parentheses, odd spacing': '((1+2)*  (3 +4) )/ 2',
};

// ------------------------------------------------------------------ levels

export const PHASE8: Level[] = [
  defineLevel({
    ...base,
    id: 'c-by-hand',
    order: 1,
    title: 'Translating C to assembly by hand',
    goal:
      'Be the C compiler: write clamp_sum in assembly, exactly as the C code in the tutorial says. a0 = a (address of the array), a1 = n, ' +
      'a2 = lo, a3 = hi; return the sum in a0 and keep the calling rules.',
    tutorial:
      'C is a shorthand for the assembly you already write. Here is the function to translate:\n\n' +
      c(String.raw`
int clamp_sum(int *a, int n, int lo, int hi) {
    int sum = 0;
    for (int i = 0; i < n; i++) {
        int x = a[i];
        if (x < lo) x = lo;
        else if (x > hi) x = hi;
        sum += x;
    }
    return sum;
}`) +
      '\n\nA compiler works one construct at a time, with fixed patterns:\n\n' +
      '| C | Assembly |\n| --- | --- |\n' +
      '| parameters | arrive in a0, a1, a2, a3 (in order) |\n' +
      '| a local variable (`sum`, `i`) | a register (t0, t1, …) |\n' +
      '| `a[i]` on an int array | address a + 4 · i, then `lw` |\n' +
      '| `if (x < lo)` | branch around the body when the opposite is true: `bge x, lo, skip` |\n' +
      '| `for (init; cond; step) body` | init; `loop:` test cond or jump to the end; body; step; `j loop` |\n' +
      '| `return sum` | put sum in a0, `ret` |\n\n' +
      'The for loop becomes:\n\n' +
      s(`
    li   t1, 0          # i = 0
loop:
    bge  t1, a1, done   # leave when !(i < n)
    # ... body ...
    addi t1, t1, 1      # i++
    j    loop
done:`) +
      '\n\n`int` is signed, so use the signed branches (`blt`, `bge`), not `bltu`/`bgeu`. ' +
      'The library file calls your clamp_sum and checks that s0–s3 and sp survive, like any C caller expects.',
    hints: [
      'Translate line by line, in order. Give each C variable its own register and write it in a comment: t0 = sum, t1 = i, t3 = x.',
      'a[i]: slli t2, t1, 2 (i · 4, an int is 4 bytes) / add t2, a0, t2 / lw t3, 0(t2).',
      'if (x < lo) x = lo; else if (x > hi) x = hi; becomes: bge t3, a2, not_low / mv t3, a2 / j add_it / not_low: ble t3, a3, add_it / mv t3, a3 / add_it: add t0, t0, t3.',
      'You only need t registers, so nothing has to be saved on the stack: this is a leaf function (it calls nothing).',
      'clamp_sum: li t0, 0 / li t1, 0 / loop: bge t1, a1, done / slli t2, t1, 2 / add t2, a0, t2 / lw t3, 0(t2) / bge t3, a2, not_low / mv t3, a2 / j add_it / ' +
        'not_low: ble t3, a3, add_it / mv t3, a3 / add_it: add t0, t0, t3 / addi t1, t1, 1 / j loop / done: mv a0, t0 / ret',
    ],
    afterword:
      'That is all a compiler does: the same small patterns, applied without getting tired. From the next level on, the compiler writes this for you. ' +
      'Open the debugger on a C level and you can still see the assembly it produced, line by line.',
    code: code({
      starter:
        '# int clamp_sum(int *a, int n, int lo, int hi): the C code is in the tutorial.\n' +
        '# a0 = a, a1 = n, a2 = lo, a3 = hi. Return the sum in a0.\n' +
        '    .globl clamp_sum\n' +
        'clamp_sum:\n' +
        '    li   t0, 0           # int sum = 0;\n' +
        '    li   t1, 0           # int i = 0;\n' +
        '    # TODO: for (; i < n; i++) { x = a[i]; clamp x to lo..hi; sum += x; }\n' +
        '    mv   a0, t0          # return sum;\n' +
        '    ret\n',
      devices: [],
      library: [{ name: 'library.s', text: callerLibrary('clamp_sum') }],
    }),
    tests: [
      clampCase('[5, -3, 12, 7] into 0..10', [5, -3, 12, 7], 0, 10),
      clampCase('empty array (n = 0)', [], 0, 10),
      clampCase('negative numbers: signed compares', [-50, -2, -9, 3], -10, -1),
      clampCase('lo = hi', [1, 2, 3], 2, 2),
      clampCase('nothing to clamp', [100, 200, -300, 4000, 5], -1_000_000, 1_000_000),
    ],
    requires: [PHASE7_LAST_REQUIRED_ID],
  }),

  defineLevel({
    ...base,
    id: 'c-control-flow',
    order: 2,
    title: 'Variables and control flow',
    goal:
      'Your first C program. Read a number n, then print the Collatz sequence from n down to 1 on one line, separated by spaces: ' +
      'if n is even, the next number is n / 2; if odd, 3 · n + 1. Return the number of steps. When n is 0 or 1 print just n.',
    tutorial:
      "A C program starts at main, and main's return value becomes the exit code (libc's startup code calls main, then exits with what it returns). " +
      'printf prints text with numbers filled in:\n\n' +
      c(String.raw`
#include <stdio.h>

int main() {
    int total = 0;                  /* a variable: a name for a value */
    for (int i = 1; i <= 3; i++) {
        total = total + i;
        printf("i = %d, total = %d\n", i, total);
    }
    if (total > 5) {
        printf("big\n");
    } else {
        printf("small\n");
    }
    return total;                   /* exit code 6 */
}`) +
      '\n\n`%d` prints an int, `\\n` ends the line. `while (cond) { ... }` repeats while cond is true, and `n % 2` is the remainder (0 for even numbers).\n\n' +
      'The starter already has read_number, which reads digits typed into the console with getchar until the end of the line. ' +
      'For n = 6 the output is `6 3 10 5 16 8 4 2 1` and the exit code is 8 (eight steps).',
    hints: [
      'Print n first, before the loop: then every step prints " " and the new n, and the line ends with "\\n" after the loop.',
      'Loop while (n > 1), not while (n != 1): with n = 0 the second one never stops.',
      'Inside the loop: if (n % 2 == 0) n = n / 2; else n = 3 * n + 1; then steps++ and printf(" %d", n).',
      'int steps = 0; printf("%d", n); while (n > 1) { if (n % 2 == 0) { n = n / 2; } else { n = 3 * n + 1; } steps++; printf(" %d", n); } printf("\\n"); return steps;',
    ],
    afterword:
      'Nobody has proved that this loop ends for every n (the Collatz conjecture), but it has been checked far beyond any int. ' +
      'Step through it in the debugger: each C line highlights in turn, and the locals panel shows n and steps.',
    code: cCode(String.raw`#include <stdio.h>

/* Read a decimal number from the input; stops at the first non-digit. */
int read_number() {
    int n = 0;
    int c = getchar();
    while (c >= '0' && c <= '9') {
        n = n * 10 + (c - '0');
        c = getchar();
    }
    return n;
}

int main() {
    int n = read_number();
    int steps = 0;
    printf("%d", n);
    /* TODO: while n > 1: halve it when even, else 3 * n + 1;
       count the step and print " " and the new n */
    printf("\n");
    return steps;
}
`),
    tests: [collatzCase(6), collatzCase(1), collatzCase(0), collatzCase(27), collatzCase(97)],
    requires: ['c-by-hand'],
  }),

  defineLevel({
    ...base,
    id: 'c-functions',
    order: 3,
    title: 'Functions',
    goal:
      'Write two recursive functions. gcd(a, b): the greatest common divisor (gcd(a, 0) = a, else gcd(b, a % b)). ' +
      'hanoi(n, from, to, via): move a tower of n disks from peg from to peg to, printing "disk k: X -> Y" for each move; return the number of moves.',
    tutorial:
      "A C function has a return type, a name and typed parameters. Here the level's harness.c owns main; it reads three numbers and calls your functions:\n\n" +
      c(String.raw`
int moves = hanoi(n, 'A', 'C', 'B');
printf("%d moves\n", moves);`) +
      "\n\nThe compiler turns that call into what you did by hand in Phase 6: n goes in a0, 'A' in a1, 'C' in a2, 'B' in a3, then `call hanoi`; " +
      'the result comes back in a0. Your function saves ra and the s registers it uses, so it may call itself as often as it likes. ' +
      'functions.h holds the prototypes, so harness.c knows the types before it sees your code.\n\n' +
      'Recursion in C needs no stack bookkeeping from you:\n\n' +
      c(String.raw`
int fact(int n) {
    if (n <= 1) return 1;       /* base case: stop */
    return n * fact(n - 1);     /* a smaller problem of the same kind */
}`) +
      '\n\nTower of Hanoi: to move n disks from A to C, move n − 1 disks out of the way to B, move disk n to C, then move the n − 1 disks from B onto it. ' +
      'For 2 disks the output is `disk 1: A -> B`, `disk 2: A -> C`, `disk 1: B -> C`. `%c` prints a char.',
    hints: [
      'gcd is two lines: if (b == 0) return a; return gcd(b, a % b);',
      "hanoi's base case is n == 0: no disks, no moves, return 0.",
      'hanoi(n, from, to, via): first hanoi(n - 1, from, via, to), then printf("disk %d: %c -> %c\\n", n, from, to), then hanoi(n - 1, via, to, from). Add up the moves: both calls plus 1.',
      'int hanoi(int n, char from, char to, char via) { if (n == 0) return 0; int moves = hanoi(n - 1, from, via, to); printf("disk %d: %c -> %c\\n", n, from, to); ' +
        'moves = moves + 1 + hanoi(n - 1, via, to, from); return moves; }',
    ],
    afterword:
      "n disks always take 2ⁿ − 1 moves. Euclid's gcd is one of the oldest algorithms still in daily use (RSA keys need it). " +
      'In the debugger, the call stack panel shows one frame per recursive call, each with its own n.',
    code: cCode(
      String.raw`#include <stdio.h>
#include "functions.h"

/* Greatest common divisor: gcd(a, 0) = a, otherwise gcd(b, a % b). */
int gcd(int a, int b) {
    /* TODO */
    return 0;
}

/* Move n disks from peg from to peg to, using via. Print each move as
   "disk k: X -> Y" and return the number of moves. */
int hanoi(int n, char from, char to, char via) {
    if (n == 0) {
        return 0;
    }
    /* TODO: move n - 1 disks out of the way, move disk n, move the n - 1 disks back on top */
    return 0;
}
`,
      [
        { name: 'functions.h', text: FUNCTIONS_H },
        { name: 'harness.c', text: FUNCTIONS_HARNESS },
      ],
    ),
    tests: [
      functionsCase(12, 18, 2),
      functionsCase(17, 5, 1),
      functionsCase(7, 0, 0),
      functionsCase(0, 9, 3),
      functionsCase(1071, 462, 5),
    ],
    requires: ['c-control-flow'],
  }),

  defineLevel({
    ...base,
    id: 'c-pointers',
    order: 4,
    title: 'Pointers and arrays',
    goal:
      'Write swap(a, b) to exchange two ints through pointers, reverse(a, n) to reverse an array in place, and find_max(a, n) to return a pointer to ' +
      'the largest element (the first one on a tie), or 0 (a null pointer) when n is 0.',
    tutorial:
      'A pointer is an address, the kind you kept in a0 when you walked arrays in assembly. `&x` is the address of x; `*p` is the value at address p:\n\n' +
      c(String.raw`
int x = 5;
int *p = &x;    /* p holds the address of x */
*p = 7;         /* writes to x: x is now 7 */`) +
      "\n\nThat is how a function changes the caller's variables: the caller passes addresses. " +
      'An array name is the address of its first element, and `a[i]` means `*(a + i)`. Pointer arithmetic counts in elements, not bytes: ' +
      'for an int pointer, `p + 1` is 4 bytes further on, and `p++` steps to the next int.\n\n' +
      c(String.raw`
int sum(int *a, int n) {
    int total = 0;
    for (int *p = a; p < a + n; p++) total += *p;
    return total;
}`) +
      '\n\nA null pointer (0) means "no element". harness.c reads a count and that many numbers, calls your functions, ' +
      'and prints the index of the maximum by subtracting pointers (`m - numbers`).',
    hints: [
      'swap needs a temporary: int t = *a; *a = *b; *b = t;',
      'reverse: one pointer at the first element (a), one at the last (a + n - 1). While the first is below the last, swap them and move both inwards.',
      'find_max: start with best = a (the first element) and walk the rest; only take a new element when it is strictly greater (>), so ties keep the first. Return 0 first when n is 0.',
      'void reverse(int *a, int n) { int *lo = a; int *hi = a + n - 1; while (lo < hi) { swap(lo, hi); lo++; hi--; } } / ' +
        'int *find_max(int *a, int n) { if (n == 0) return 0; int *best = a; for (int i = 1; i < n; i++) if (a[i] > *best) best = &a[i]; return best; }',
    ],
    afterword:
      'Pointers are where C stops hiding the machine: every pointer is just a number in a register. ' +
      'That is also why C is easy to get wrong: nothing stops `*p` from reading past the end of an array.',
    code: cCode(
      String.raw`#include "pointers.h"

/* Swap the ints that a and b point to. */
void swap(int *a, int *b) {
    /* TODO */
}

/* Reverse the n ints starting at a, in place. */
void reverse(int *a, int n) {
    /* TODO: swap the two ends, then move both inwards */
}

/* A pointer to the largest of the n ints at a (the first one on a tie), or 0 when n is 0. */
int *find_max(int *a, int n) {
    /* TODO */
    return 0;
}
`,
      [
        { name: 'pointers.h', text: POINTERS_H },
        { name: 'harness.c', text: POINTERS_HARNESS },
      ],
    ),
    tests: [
      pointersCase('3 1 4 1 5', [3, 1, 4, 1, 5]),
      pointersCase('empty array: no max', []),
      pointersCase('one element', [-7]),
      pointersCase('tie: the first maximum wins', [-5, -2, -9, -2]),
      pointersCase('even length', [10, 20, 30, 40, 50, 60]),
    ],
    requires: ['c-functions'],
  }),

  defineLevel({
    ...base,
    id: 'c-structs',
    order: 5,
    title: 'Structs',
    goal:
      'Rectangles on a grid (geom.h): write width, height and area (0 when the rectangle is empty), largest (index of the biggest area, first on a tie, −1 for none) ' +
      'and intersect, which stores the overlap of two rectangles in *out and returns 1 when it has a nonzero area.',
    tutorial:
      'A struct groups values under one name. Its fields sit next to each other in memory, in order:\n\n' +
      c(String.raw`
struct point { int x; int y; };                 /* 8 bytes: x at +0, y at +4 */
struct rect { struct point min; struct point max; };  /* 16 bytes */`) +
      '\n\nA rect covers the cells with min.x ≤ x < max.x and min.y ≤ y < max.y, so its width is max.x − min.x (and 0 if that is negative). ' +
      'Use `.` on a struct and `->` on a pointer to one; `r->min.x` is `(*r).min.x`, a load from the address in r plus 0:\n\n' +
      c(String.raw`
int left(struct rect *r) {
    return r->min.x;
}

struct rect rects[16];    /* an array of structs: rects[i] is 16 bytes after rects[i - 1] */
int w = width(&rects[2]);`) +
      '\n\nPassing a pointer copies one word, not the whole struct, and lets the function fill in a struct for the caller, the way intersect fills in *out. ' +
      'Two rectangles overlap in max(min) to min(max) on each axis.',
    hints: [
      'Write two helpers first: int max(int a, int b) and int min(int a, int b).',
      'width(r) = max(r->max.x - r->min.x, 0). Without the clamp, two far-apart rectangles give a negative width and a negative height, whose product is positive.',
      'largest: keep best = -1 and best_area = -1, then for each i compare area(&rs[i]) > best_area.',
      'intersect: out->min.x = max(a->min.x, b->min.x); out->min.y = max(a->min.y, b->min.y); out->max.x = min(a->max.x, b->max.x); out->max.y = min(a->max.y, b->max.y); return area(out) > 0;',
    ],
    afterword:
      'A struct is a promise about memory layout: field offsets the compiler computes once. Device registers, file system blocks and network packets are all described this way, ' +
      'which is how the operating system in Phase 9 reads them.',
    code: cCode(
      String.raw`#include "geom.h"

/* Width and height: 0 when max is not past min. */
int width(struct rect *r) {
    /* TODO */
    return 0;
}

int height(struct rect *r) {
    /* TODO */
    return 0;
}

int area(struct rect *r) {
    return width(r) * height(r);
}

/* Index of the rectangle with the largest area (the first on a tie); -1 when n is 0. */
int largest(struct rect *rs, int n) {
    /* TODO */
    return -1;
}

/* The overlap of a and b, written to *out. Returns 1 when it has a nonzero area, else 0. */
int intersect(struct rect *a, struct rect *b, struct rect *out) {
    /* TODO */
    return 0;
}
`,
      [
        { name: 'geom.h', text: GEOM_H },
        { name: 'harness.c', text: STRUCTS_HARNESS },
      ],
    ),
    tests: [
      structsCase('three rectangles; two touch without overlapping', [
        [0, 0, 4, 3],
        [2, 1, 6, 5],
        [4, 0, 8, 3],
      ]),
      structsCase('no rectangles', []),
      structsCase('same rectangle twice: the first is largest', [
        [0, 0, 2, 2],
        [0, 0, 2, 2],
      ]),
      structsCase('far apart: no overlap', [
        [0, 0, 2, 2],
        [5, 5, 7, 7],
      ]),
      structsCase('negative coordinates and an empty rectangle', [
        [-5, -5, 5, 5],
        [3, 3, 1, 1],
        [-1, -1, 3, 3],
      ]),
    ],
    requires: ['c-pointers'],
  }),

  defineLevel({
    ...base,
    id: 'c-strings',
    order: 6,
    title: 'Strings and printf',
    goal:
      'Write str_len, str_reverse (in place) and word_count (words are runs of non-space characters), then report(number, line), which prints one line like: ' +
      '1: "hello world" 11 chars, 2 words, first \'h\', sum 0x45c, reversed "dlrow olleh". Leave out the first part for an empty line.',
    tutorial:
      "A C string is an array of chars ended by a 0 byte, as in Phase 6. A string literal like \"hi\" is 3 bytes: 'h', 'i', 0.\n\n" +
      c(String.raw`
int count_a(char *s) {
    int n = 0;
    for (int i = 0; s[i] != 0; i++) {
        if (s[i] == 'a') n++;
    }
    return n;
}`) +
      "\n\nprintf's format string mixes text and conversions, each taking the next argument:\n\n" +
      '| Conversion | Prints | Example |\n| --- | --- | --- |\n' +
      '| `%d` | int, signed decimal | `-42` |\n| `%u` | unsigned decimal | `4294967295` |\n| `%x` | hexadecimal | `45c` |\n' +
      '| `%c` | one char | `h` |\n| `%s` | the string at a char pointer | `hello` |\n| `%%` | a percent sign | `%` |\n\n' +
      'A width pads: `%5d` right-aligns in 5 columns, `%-5d` left-aligns, `%05d` pads with zeros. Inside a string, `\\"` is a double quote and `\\n` a newline.\n\n' +
      'The format for one report line (the `first` part only when the line is not empty; `sum` adds up the character codes):\n\n' +
      c(String.raw`
printf("%d: \"%s\" %d chars, %d words", number, line, len, words);
printf(", first '%c'", line[0]);
printf(", sum 0x%x", sum);
printf(", reversed \"%s\"\n", line);   /* after str_reverse(line) */`),
    hints: [
      'str_len: count up from 0 until s[n] == 0.',
      'str_reverse: i from the start, j from the end (str_len(s) - 1); swap s[i] and s[j] while i < j. A string of length 0 or 1 is already reversed.',
      'word_count: keep a flag in_word. A space sets it to 0; a non-space while in_word is 0 starts a new word (count++, in_word = 1). Leading, trailing and repeated spaces then count nothing.',
      'report: len = str_len(line); words = word_count(line); print the first part; if (len > 0) print first; add up line[i] for the sum; print it with %x; ' +
        'then str_reverse(line) and print the reversed part. Print everything before reversing, except the reversed text.',
    ],
    afterword:
      'printf is a few hundred lines of C in libc that turn each conversion into digits, with the same divide-by-ten loop you wrote in Phase 7. ' +
      'Missing that 0 byte at the end of a string is still one of the most common bugs in C programs.',
    code: cCode(
      String.raw`#include <stdio.h>

/* The number of characters before the terminating 0. */
int str_len(char *s) {
    /* TODO */
    return 0;
}

/* Reverse s in place. */
void str_reverse(char *s) {
    /* TODO */
}

/* Words are runs of characters other than spaces. */
int word_count(char *s) {
    /* TODO */
    return 0;
}

/* Print one report line, e.g.
   1: "hello world" 11 chars, 2 words, first 'h', sum 0x45c, reversed "dlrow olleh"
   (no ", first ..." part when the line is empty). */
void report(int number, char *line) {
    printf("%d: \"%s\"\n", number, line);
}
`,
      [{ name: 'harness.c', text: STRINGS_HARNESS }],
    ),
    tests: [
      stringsCase('hello world', ['hello world']),
      stringsCase('an empty line', ['before', '', 'after']),
      stringsCase('extra spaces', ['  lots   of   space  ']),
      stringsCase('one character', ['x']),
      stringsCase('punctuation', ['A man, a plan, a canal: Panama!', '1 + 1 = 2']),
    ],
    requires: ['c-structs'],
  }),

  defineLevel({
    ...base,
    id: 'c-heap',
    order: 7,
    title: 'Heap: malloc and free',
    goal:
      'Write a linked list (list.h): push_front allocates a node with malloc; reverse_list turns the list around; remove_all unlinks and frees every node with a given value; ' +
      'free_list frees every node. The harness repeats the work and then checks that no node leaked.',
    tutorial:
      'Locals live on the stack and vanish when their function returns. Memory that must outlive a call comes from the heap: ' +
      '`malloc(n)` returns the address of n fresh bytes (or 0 when the heap is full), and `free(p)` gives them back.\n\n' +
      c(String.raw`
#include <stdlib.h>

struct node *n = malloc(sizeof(struct node));   /* sizeof: the struct's size in bytes */
n->value = 42;
n->next = 0;
/* ... */
free(n);                                        /* n must not be used after this */`) +
      '\n\nA linked list chains nodes through their next pointers; the last one has next = 0. Walking it:\n\n' +
      c(String.raw`
for (struct node *p = head; p != 0; p = p->next) printf("%d\n", p->value);`) +
      '\n\nEvery malloc needs exactly one free. A node you lose track of without freeing is a leak: the memory stays taken until the program ends. ' +
      'This level runs in 128 KiB of RAM. Before and after your code runs, the harness counts how many more nodes fit in the heap; if fewer fit afterwards, it prints how many leaked. ' +
      "libc's malloc is in the libc sources: a first-fit free list, about 80 lines of C.",
    hints: [
      'push_front: n = malloc(sizeof(struct node)); n->value = value; n->next = head; return n;',
      'reverse_list: walk with prev = 0. For each node, save next = head->next, point head->next at prev, then prev = head and head = next. prev is the new head.',
      'free_list: read head->next into a variable before free(head); after free the node is not yours to read.',
      'remove_all: keep first (the head to return), prev (last kept node, 0 at first) and cur. For a matching node: if prev == 0 then first = next, else prev->next = next; then free(cur). ' +
        'Otherwise prev = cur. Always move on with cur = next, which you read before freeing.',
    ],
    afterword:
      'malloc is not magic: it is a list of free blocks carved out of the memory above your globals. In Phase 9 you write one for the kernel. ' +
      'Languages with garbage collectors run this bookkeeping for you, and Rust checks it when it compiles.',
    code: cCode(
      String.raw`#include <stdlib.h>
#include "list.h"

/* A new node holding value, in front of head. Returns the new head. */
struct node *push_front(struct node *head, int value) {
    struct node *n = malloc(sizeof(struct node));
    /* TODO: fill in n */
    return head;
}

/* Reverse the list by turning every next pointer around. Returns the new head. */
struct node *reverse_list(struct node *head) {
    /* TODO */
    return head;
}

/* Unlink and free every node whose value is value. Returns the new head. */
struct node *remove_all(struct node *head, int value) {
    /* TODO */
    return head;
}

/* Free every node. */
void free_list(struct node *head) {
    /* TODO */
}
`,
      [
        { name: 'list.h', text: LIST_H },
        { name: 'harness.c', text: HEAP_HARNESS },
      ],
      HEAP_RAM,
    ),
    tests: [
      heapCase('1 2 3 2 2, remove 2', [1, 2, 3, 2, 2], 2),
      heapCase('empty list', [], 7),
      heapCase('remove every node', [4, 4, 4], 4),
      heapCase('nothing to remove', [-1, 9, 8, -1], 5),
      heapCase('remove the head and the tail', [5, 1, 2, 5], 5),
    ],
    requires: ['c-strings'],
  }),

  defineLevel({
    ...base,
    id: 'c-compiler',
    order: 8,
    title: 'Build a compiler',
    goal:
      'Write a compiler: read one arithmetic expression (numbers, + - * / %, parentheses, spaces) ending in a newline, and print RISC-V assembly for a function calc that computes it, ' +
      'in exactly the stack-machine form the tutorial gives. * / % bind tighter than + −, and operators of the same level go left to right.',
    tutorial:
      'A compiler reads text and writes a program. This one compiles `2 + 3 * 4` into a function, using the stack for every value. Each number pushes itself:\n\n' +
      s(`
    li t0, 2
    addi sp, sp, -4
    sw t0, 0(sp)`) +
      '\n\nEach operator pops two values, combines them (`add`, `sub`, `mul`, `div`, `rem`), and pushes the result:\n\n' +
      s(`
    lw t1, 0(sp)
    lw t0, 4(sp)
    addi sp, sp, 4
    mul t0, t0, t1
    sw t0, 0(sp)`) +
      '\n\nThe output starts with a line `calc:` and ends by popping the result into a0: `lw a0, 0(sp)`, `addi sp, sp, 4`, `ret`. ' +
      'Every instruction line is 4 spaces, the mnemonic, one space, and the operands separated by ", ".\n\n' +
      'The parser is recursive descent: one function per grammar rule, each emitting code for what it read, so operands are pushed before their operator:\n\n' +
      c(String.raw`
/* expr   = term   { ("+" | "-") term }
   term   = factor { ("*" | "/" | "%") factor }
   factor = number | "(" expr ")"            */
void term() {
    factor();
    while (look == '*' || look == '/' || look == '%') {
        int op = look;
        next();
        factor();
        /* emit mul, div or rem */
    }
}`) +
      '\n\n`look` is the next input character, read one ahead with getchar. Skip spaces before and after each factor.',
    hints: [
      'Keep one global int look and a function next() { look = getchar(); }. Call next() once at the start of main.',
      "factor: skip spaces; if look is '(', call next(), expr(), skip spaces, and next() again for the ')'. Otherwise read digits into n (n = n * 10 + (look - '0')) and print the three push lines. Skip spaces at the end.",
      'Precedence comes from the call structure: expr calls term for each operand, and term calls factor, so * groups before + without any extra rule. The while loops make it left to right.',
      "Write emit_op(char *op) that prints the five lines with printf(\"    %s t0, t0, t1\\n\", op) in the middle. Then expr is: term(); while (look == '+' || look == '-') { int op = look; next(); term(); " +
        'if (op == \'+\') emit_op("add"); else emit_op("sub"); }. main: next(); printf("calc:\\n"); expr(); then print the three closing lines and return 0.',
    ],
    afterword:
      'This is the core of every compiler: parse, then emit. Real ones keep values in registers instead of the stack and build a tree first, so they can optimize. ' +
      'Paste your output into a Phase 6 level and call calc: it runs. Next stop: Crenshaw\'s "Let\'s Build a Compiler", or chibicc, a small C compiler you can read in a week.',
    code: cCode(String.raw`#include <stdio.h>

/*
 * Grammar:
 *   expr   = term   { ("+" | "-") term }
 *   term   = factor { ("*" | "/" | "%") factor }
 *   factor = number | "(" expr ")"
 */

int look; /* the next input character, not used yet */

void next() {
    look = getchar();
}

void skip_spaces() {
    while (look == ' ') next();
}

void push_number(int n) {
    printf("    li t0, %d\n", n);
    printf("    addi sp, sp, -4\n");
    printf("    sw t0, 0(sp)\n");
}

/* TODO: emit_op(char *op): pop two values, apply op, push the result */

/* TODO: factor(), term() and expr(); expr() and factor() call each other,
   so declare one of them before both:  void expr(); */

int main() {
    next();
    printf("calc:\n");
    /* TODO: expr(); */
    printf("    lw a0, 0(sp)\n");
    printf("    addi sp, sp, 4\n");
    printf("    ret\n");
    return 0;
}
`),
    tests: Object.entries(COMPILER_EXPRESSIONS).map(([name, expr]) => compilerCase(name, expr)),
    requires: ['c-heap'],
    optional: true,
  }),
];
