import { CodeSetup } from '@build-a-computer/schema';

/**
 * Shared pieces of the Phase 8 (C) levels: the read-only harness and header
 * files the levels compile with the player's main.c, and models that compute
 * each test's expected output. C levels link libc (crt0 calls main; its
 * return value is the exit code). getchar() waits for the next UART byte, so
 * every input format says where it ends (a count, or the end of a line).
 */

/** Id of the last required (non-optional) Phase 7 level; Phase 8 starts after it. */
export const PHASE7_LAST_REQUIRED_ID = 'block-device';

/** A C level's code setup: main.c, the UART console, libc linked. */
export const cCode = (
  starter: string,
  library: { name: string; text: string }[] = [],
  ramSize = 1024 * 1024,
): CodeSetup => CodeSetup.parse({ language: 'c', starter, devices: ['uart'], library, ramSize });

/** Reads one signed decimal number, skipping spaces and newlines before it. */
const READ_INT = String.raw`/* Read a decimal number (maybe with a leading '-'), skipping spaces and newlines before it. */
int read_int() {
    int c = getchar();
    while (c == ' ' || c == '\n') c = getchar();
    int sign = 1;
    if (c == '-') {
        sign = -1;
        c = getchar();
    }
    int n = 0;
    while (c >= '0' && c <= '9') {
        n = n * 10 + (c - '0');
        c = getchar();
    }
    return sign * n;
}
`;

// ------------------------------------------------------------ functions

export const FUNCTIONS_H = String.raw`/* functions.h: provided by the level (read only). The functions you write in main.c. */
int gcd(int a, int b);
int hanoi(int n, char from, char to, char via);
`;

export const FUNCTIONS_HARNESS = String.raw`/* harness.c: provided by the level (read only). It has main: it reads "a b n" and calls your functions. */
#include <stdio.h>
#include "functions.h"

${READ_INT}
int main() {
    int a = read_int();
    int b = read_int();
    int n = read_int();
    printf("gcd(%d, %d) = %d\n", a, b, gcd(a, b));
    int moves = hanoi(n, 'A', 'C', 'B');
    printf("%d moves\n", moves);
    return moves;
}
`;

// ------------------------------------------------------------- pointers

export const POINTERS_H = String.raw`/* pointers.h: provided by the level (read only). The functions you write in main.c. */
void swap(int *a, int *b);
void reverse(int *a, int n);
int *find_max(int *a, int n);
`;

export const POINTERS_HARNESS = String.raw`/* harness.c: provided by the level (read only). Input: a count, then that many numbers. */
#include <stdio.h>
#include "pointers.h"

${READ_INT}
int numbers[64];

void print_all(int *a, int n) {
    for (int i = 0; i < n; i++) {
        if (i > 0) putchar(' ');
        printf("%d", a[i]);
    }
    putchar('\n');
}

int main() {
    int n = read_int();
    for (int i = 0; i < n; i++) numbers[i] = read_int();
    int x = 1;
    int y = 2;
    swap(&x, &y);
    printf("swap: %d %d\n", x, y);
    reverse(numbers, n);
    printf("reversed: ");
    print_all(numbers, n);
    int *m = find_max(numbers, n);
    if (m == 0) {
        printf("no max\n");
        return 0;
    }
    printf("max: %d at index %d\n", *m, m - numbers);
    return m - numbers + 1;
}
`;

// -------------------------------------------------------------- structs

export const GEOM_H = String.raw`/* geom.h: provided by the level (read only). */

/* A point on a grid. */
struct point {
    int x;
    int y;
};

/* The cells with min.x <= x < max.x and min.y <= y < max.y. */
struct rect {
    struct point min;
    struct point max;
};

/* The functions you write in main.c. */
int width(struct rect *r);
int height(struct rect *r);
int area(struct rect *r);
int largest(struct rect *rs, int n);
int intersect(struct rect *a, struct rect *b, struct rect *out);
`;

export const STRUCTS_HARNESS = String.raw`/* harness.c: provided by the level (read only). Input: a count, then x0 y0 x1 y1 for each rectangle. */
#include <stdio.h>
#include "geom.h"

${READ_INT}
struct rect rects[16];

int main() {
    int n = read_int();
    for (int i = 0; i < n; i++) {
        rects[i].min.x = read_int();
        rects[i].min.y = read_int();
        rects[i].max.x = read_int();
        rects[i].max.y = read_int();
    }
    for (int i = 0; i < n; i++) {
        printf("rect %d: %d x %d = %d\n", i, width(&rects[i]), height(&rects[i]), area(&rects[i]));
    }
    printf("largest: %d\n", largest(rects, n));
    int overlaps = 0;
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            struct rect both;
            if (intersect(&rects[i], &rects[j], &both)) {
                printf("%d and %d overlap at (%d, %d)-(%d, %d)\n", i, j, both.min.x, both.min.y, both.max.x, both.max.y);
                overlaps++;
            }
        }
    }
    return overlaps;
}
`;

// -------------------------------------------------------------- strings

export const STRINGS_HARNESS = String.raw`/* harness.c: provided by the level (read only). Input: a count, then that many lines. */
#include <stdio.h>

void report(int number, char *line);

char line[128];

int main() {
    int count = 0;
    int c = getchar();
    while (c >= '0' && c <= '9') {
        count = count * 10 + (c - '0');
        c = getchar();
    }
    for (int number = 1; number <= count; number++) {
        int n = 0;
        c = getchar();
        while (c != '\n') {
            if (n < 127) {
                line[n] = c;
                n++;
            }
            c = getchar();
        }
        line[n] = 0;
        report(number, line);
    }
    return count;
}
`;

// ----------------------------------------------------------------- heap

export const LIST_H = String.raw`/* list.h: provided by the level (read only). */

/* One node of a singly linked list. */
struct node {
    int value;
    struct node *next;
};

/* The functions you write in main.c. */
struct node *push_front(struct node *head, int value);
struct node *reverse_list(struct node *head);
struct node *remove_all(struct node *head, int value);
void free_list(struct node *head);
`;

/** Rounds of the heap level's leak check. */
export const HEAP_ROUNDS = 20;

export const HEAP_HARNESS = String.raw`/* harness.c: provided by the level (read only). Input: a count, the numbers, then a number to remove. */
#include <stdio.h>
#include <stdlib.h>
#include "list.h"

${READ_INT}
int numbers[64];

void print_list(char *label, struct node *head) {
    printf("%s:", label);
    while (head != 0) {
        printf(" %d", head->value);
        head = head->next;
    }
    putchar('\n');
}

struct node *build(int n) {
    struct node *head = 0;
    for (int i = 0; i < n; i++) head = push_front(head, numbers[i]);
    return head;
}

/* How many nodes still fit in the heap: take them all, count, give them back. */
int capacity() {
    struct node *all = 0;
    int count = 0;
    struct node *p = malloc(sizeof(struct node));
    while (p != 0) {
        p->next = all;
        all = p;
        count++;
        p = malloc(sizeof(struct node));
    }
    while (all != 0) {
        p = all->next;
        free(all);
        all = p;
    }
    return count;
}

int main() {
    int n = read_int();
    for (int i = 0; i < n; i++) numbers[i] = read_int();
    int gone = read_int();
    int before = capacity();
    struct node *list = build(n);
    print_list("built", list);
    list = reverse_list(list);
    print_list("reversed", list);
    list = remove_all(list, gone);
    print_list("removed", list);
    free_list(list);
    /* Leak check: the same work ${HEAP_ROUNDS} more times, then count what still fits. */
    for (int round = 0; round < ${HEAP_ROUNDS}; round++) {
        list = build(n);
        list = remove_all(reverse_list(list), gone);
        free_list(list);
    }
    int after = capacity();
    if (after == before) {
        printf("no leaks\n");
        return 0;
    }
    printf("leaked %d nodes\n", before - after);
    return 1;
}
`;

// --------------------------------------------------------------- models

/** Output and exit code of the control-flow level (Collatz) for n. */
export function collatzModel(n: number): { uart: string; steps: number } {
  const seq = [n];
  while (n > 1) {
    n = n % 2 === 0 ? n / 2 : 3 * n + 1;
    seq.push(n);
  }
  return { uart: seq.join(' ') + '\n', steps: seq.length - 1 };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Output and exit code of the functions level for input "a b n". */
export function functionsModel(a: number, b: number, n: number): { uart: string; moves: number } {
  const lines: string[] = [];
  const hanoi = (k: number, from: string, to: string, via: string): number => {
    if (k === 0) return 0;
    const m = hanoi(k - 1, from, via, to);
    lines.push(`disk ${k}: ${from} -> ${to}\n`);
    return m + 1 + hanoi(k - 1, via, to, from);
  };
  const moves = hanoi(n, 'A', 'C', 'B');
  return { uart: `gcd(${a}, ${b}) = ${gcd(a, b)}\n` + lines.join('') + `${moves} moves\n`, moves };
}

/** Output and exit code of the pointers level for some numbers. */
export function pointersModel(nums: readonly number[]): { uart: string; exitCode: number } {
  const r = [...nums].reverse();
  let uart = `swap: 2 1\nreversed: ${r.join(' ')}\n`;
  if (r.length === 0) return { uart: uart + 'no max\n', exitCode: 0 };
  let best = 0;
  r.forEach((v, i) => {
    if (v > r[best]!) best = i;
  });
  uart += `max: ${r[best]} at index ${best}\n`;
  return { uart, exitCode: best + 1 };
}

export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

/** Output and exit code of the structs level for some rectangles. */
export function structsModel(rects: readonly Rect[]): { uart: string; overlaps: number } {
  const w = (r: Rect) => Math.max(r[2] - r[0], 0);
  const h = (r: Rect) => Math.max(r[3] - r[1], 0);
  let uart = rects.map((r, i) => `rect ${i}: ${w(r)} x ${h(r)} = ${w(r) * h(r)}\n`).join('');
  let best = -1;
  let bestArea = -1;
  rects.forEach((r, i) => {
    if (w(r) * h(r) > bestArea) [best, bestArea] = [i, w(r) * h(r)];
  });
  uart += `largest: ${best}\n`;
  let overlaps = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const [a, b] = [rects[i]!, rects[j]!];
      const o: Rect = [
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
        Math.min(a[2], b[2]),
        Math.min(a[3], b[3]),
      ];
      if (w(o) * h(o) > 0) {
        uart += `${i} and ${j} overlap at (${o[0]}, ${o[1]})-(${o[2]}, ${o[3]})\n`;
        overlaps++;
      }
    }
  return { uart, overlaps };
}

/** One line of the strings level's report. */
export function reportLine(number: number, line: string): string {
  const words = line.split(' ').filter((w) => w.length > 0).length;
  const sum = [...line].reduce((a, c) => a + c.charCodeAt(0), 0);
  const first = line.length > 0 ? `, first '${line[0]}'` : '';
  const rev = [...line].reverse().join('');
  return `${number}: "${line}" ${line.length} chars, ${words} words${first}, sum 0x${sum.toString(16)}, reversed "${rev}"\n`;
}

/** Input text for the heap level. */
export const heapInput = (nums: readonly number[], gone: number): string =>
  `${nums.length} ${nums.join(' ')}\n${gone}\n`;

/** Output of the heap level when the player's list code is right and frees everything. */
export function heapModel(nums: readonly number[], gone: number): string {
  const built = [...nums].reverse();
  const reversed = [...nums];
  const removed = reversed.filter((v) => v !== gone);
  const show = (label: string, xs: number[]) => `${label}:${xs.map((x) => ` ${x}`).join('')}\n`;
  return (
    show('built', built) + show('reversed', reversed) + show('removed', removed) + 'no leaks\n'
  );
}

/** The assembly the compiler level prints for an expression (its exact output). */
export function compileModel(expr: string): string {
  let i = 0;
  const out: string[] = ['calc:'];
  const peek = () => expr[i] ?? '\n';
  const spaces = () => {
    while (peek() === ' ') i++;
  };
  const op = (name: string) =>
    out.push(
      '    lw t1, 0(sp)',
      '    lw t0, 4(sp)',
      '    addi sp, sp, 4',
      `    ${name} t0, t0, t1`,
      '    sw t0, 0(sp)',
    );
  const factor = (): void => {
    spaces();
    if (peek() === '(') {
      i++;
      sum();
      spaces();
      i++;
    } else {
      let n = 0;
      while (/[0-9]/.test(peek())) n = (n * 10 + Number(expr[i++])) | 0;
      out.push(`    li t0, ${n}`, '    addi sp, sp, -4', '    sw t0, 0(sp)');
    }
    spaces();
  };
  const term = (): void => {
    factor();
    while ('*/%'.includes(peek())) {
      const c = expr[i++];
      factor();
      op(c === '*' ? 'mul' : c === '/' ? 'div' : 'rem');
    }
  };
  const sum = (): void => {
    term();
    while ('+-'.includes(peek())) {
      const c = expr[i++];
      term();
      op(c === '+' ? 'add' : 'sub');
    }
  };
  sum();
  out.push('    lw a0, 0(sp)', '    addi sp, sp, 4', '    ret');
  return out.join('\n') + '\n';
}

/** clamp_sum from the first level, as the C code defines it. */
export function clampSum(xs: readonly number[], lo: number, hi: number): number {
  let sum = 0;
  for (const v of xs) sum = (sum + Math.min(Math.max(v, lo), hi)) | 0;
  return sum;
}
