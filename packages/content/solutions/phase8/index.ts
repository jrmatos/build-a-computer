import type { Level } from '@build-a-computer/schema';

/**
 * Reference solutions for every Phase 8 level: the player's file (main.s for
 * the first level, main.c for the rest; library files come from the level).
 * Loaded by the game only on "Show solution" (ADR-007).
 */
export const PHASE8_SOLUTIONS: Record<string, string> = {
  'c-by-hand': `# int clamp_sum(int *a, int n, int lo, int hi)
# a0 = a, a1 = n, a2 = lo, a3 = hi. Returns the sum in a0.
    .globl clamp_sum
clamp_sum:
    li   t0, 0           # int sum = 0;
    li   t1, 0           # int i = 0;
loop:
    bge  t1, a1, done    # i < n, or leave the loop
    slli t2, t1, 2       # &a[i] = a + 4 * i
    add  t2, a0, t2
    lw   t3, 0(t2)       # int x = a[i];
    bge  t3, a2, not_low # if (x < lo)
    mv   t3, a2          #     x = lo;
    j    add_it
not_low:
    ble  t3, a3, add_it  # else if (x > hi)
    mv   t3, a3          #     x = hi;
add_it:
    add  t0, t0, t3      # sum += x;
    addi t1, t1, 1       # i++
    j    loop
done:
    mv   a0, t0          # return sum;
    ret
`,

  'c-control-flow': String.raw`#include <stdio.h>

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
    while (n > 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps++;
        printf(" %d", n);
    }
    printf("\n");
    return steps;
}
`,

  'c-functions': String.raw`#include <stdio.h>

/* Greatest common divisor, by Euclid: gcd(a, 0) = a, gcd(a, b) = gcd(b, a % b). */
int gcd(int a, int b) {
    if (b == 0) {
        return a;
    }
    return gcd(b, a % b);
}

/* Move n disks from peg from to peg to, using via; print each move; return how many. */
int hanoi(int n, char from, char to, char via) {
    if (n == 0) {
        return 0;
    }
    int moves = hanoi(n - 1, from, via, to);
    printf("disk %d: %c -> %c\n", n, from, to);
    moves = moves + 1;
    moves = moves + hanoi(n - 1, via, to, from);
    return moves;
}
`,

  'c-pointers': String.raw`#include "pointers.h"

/* Swap the ints that a and b point to. */
void swap(int *a, int *b) {
    int t = *a;
    *a = *b;
    *b = t;
}

/* Reverse the n ints starting at a, in place: swap the two ends, move both inwards. */
void reverse(int *a, int n) {
    int *lo = a;
    int *hi = a + n - 1;
    while (lo < hi) {
        swap(lo, hi);
        lo++;
        hi--;
    }
}

/* A pointer to the largest of the n ints at a (the first one on a tie), or 0 when n is 0. */
int *find_max(int *a, int n) {
    if (n == 0) {
        return 0;
    }
    int *best = a;
    for (int i = 1; i < n; i++) {
        if (a[i] > *best) {
            best = &a[i];
        }
    }
    return best;
}
`,

  'c-structs': String.raw`#include "geom.h"

int max(int a, int b) {
    if (a > b) return a;
    return b;
}

int min(int a, int b) {
    if (a < b) return a;
    return b;
}

/* Width and height are 0 when max is not past min. */
int width(struct rect *r) {
    return max(r->max.x - r->min.x, 0);
}

int height(struct rect *r) {
    return max(r->max.y - r->min.y, 0);
}

int area(struct rect *r) {
    return width(r) * height(r);
}

/* Index of the rectangle with the largest area (the first on a tie); -1 when n is 0. */
int largest(struct rect *rs, int n) {
    int best = -1;
    int best_area = -1;
    for (int i = 0; i < n; i++) {
        int a = area(&rs[i]);
        if (a > best_area) {
            best = i;
            best_area = a;
        }
    }
    return best;
}

/* The overlap of a and b, written to *out. Returns 1 when it has a nonzero area, else 0. */
int intersect(struct rect *a, struct rect *b, struct rect *out) {
    out->min.x = max(a->min.x, b->min.x);
    out->min.y = max(a->min.y, b->min.y);
    out->max.x = min(a->max.x, b->max.x);
    out->max.y = min(a->max.y, b->max.y);
    return area(out) > 0;
}
`,

  'c-strings': String.raw`#include <stdio.h>

/* The number of characters before the terminating 0. */
int str_len(char *s) {
    int n = 0;
    while (s[n] != 0) {
        n++;
    }
    return n;
}

/* Reverse s in place. */
void str_reverse(char *s) {
    int i = 0;
    int j = str_len(s) - 1;
    while (i < j) {
        char t = s[i];
        s[i] = s[j];
        s[j] = t;
        i++;
        j--;
    }
}

/* Words are runs of characters other than spaces. */
int word_count(char *s) {
    int words = 0;
    int in_word = 0;
    for (int i = 0; s[i] != 0; i++) {
        if (s[i] == ' ') {
            in_word = 0;
        } else if (!in_word) {
            in_word = 1;
            words++;
        }
    }
    return words;
}

/* One line of the report. */
void report(int number, char *line) {
    int len = str_len(line);
    int words = word_count(line);
    printf("%d: \"%s\" %d chars, %d words", number, line, len, words);
    if (len > 0) {
        printf(", first '%c'", line[0]);
    }
    int sum = 0;
    for (int i = 0; i < len; i++) {
        sum += line[i];
    }
    printf(", sum 0x%x", sum);
    str_reverse(line);
    printf(", reversed \"%s\"\n", line);
}
`,

  'c-heap': String.raw`#include <stdlib.h>
#include "list.h"

/* A new node holding value, in front of head. Returns the new head. */
struct node *push_front(struct node *head, int value) {
    struct node *n = malloc(sizeof(struct node));
    n->value = value;
    n->next = head;
    return n;
}

/* Reverse the list by turning every next pointer around. Returns the new head. */
struct node *reverse_list(struct node *head) {
    struct node *prev = 0;
    while (head != 0) {
        struct node *next = head->next;
        head->next = prev;
        prev = head;
        head = next;
    }
    return prev;
}

/* Unlink and free every node whose value is value. Returns the new head. */
struct node *remove_all(struct node *head, int value) {
    struct node *first = head;
    struct node *prev = 0;
    struct node *cur = head;
    while (cur != 0) {
        struct node *next = cur->next;
        if (cur->value == value) {
            if (prev == 0) {
                first = next;
            } else {
                prev->next = next;
            }
            free(cur);
        } else {
            prev = cur;
        }
        cur = next;
    }
    return first;
}

/* Free every node. Read next before freeing the node it lives in. */
void free_list(struct node *head) {
    while (head != 0) {
        struct node *next = head->next;
        free(head);
        head = next;
    }
}
`,

  'c-compiler': String.raw`#include <stdio.h>

/*
 * A one-pass compiler for arithmetic. Grammar:
 *   expr   = term   { ("+" | "-") term }
 *   term   = factor { ("*" | "/" | "%") factor }
 *   factor = number | "(" expr ")"
 * The code for each rule leaves its value on top of the stack at run time.
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

/* Pop two values, apply op, push the result. */
void emit_op(char *op) {
    printf("    lw t1, 0(sp)\n");
    printf("    lw t0, 4(sp)\n");
    printf("    addi sp, sp, 4\n");
    printf("    %s t0, t0, t1\n", op);
    printf("    sw t0, 0(sp)\n");
}

void expr();

void factor() {
    skip_spaces();
    if (look == '(') {
        next();
        expr();
        skip_spaces();
        next(); /* the ')' */
    } else {
        int n = 0;
        while (look >= '0' && look <= '9') {
            n = n * 10 + (look - '0');
            next();
        }
        push_number(n);
    }
    skip_spaces();
}

void term() {
    factor();
    while (look == '*' || look == '/' || look == '%') {
        int op = look;
        next();
        factor();
        if (op == '*') emit_op("mul");
        else if (op == '/') emit_op("div");
        else emit_op("rem");
    }
}

void expr() {
    term();
    while (look == '+' || look == '-') {
        int op = look;
        next();
        term();
        if (op == '+') emit_op("add");
        else emit_op("sub");
    }
}

int main() {
    next();
    printf("calc:\n");
    expr();
    printf("    lw a0, 0(sp)\n");
    printf("    addi sp, sp, 4\n");
    printf("    ret\n");
    return 0;
}
`,
};

export const phase8Source = (level: Level): string | undefined => PHASE8_SOLUTIONS[level.id];
