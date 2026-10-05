/*
 * stdlib.c: the heap (malloc and free), numbers and random numbers.
 *
 * The heap
 * --------
 * The heap starts at _end, the first byte after the program's globals, and
 * grows up toward the stack, which grows down from the top of RAM:
 *
 *   0x80000000 [ code | data | bss ][ heap -> ...     ... <- stack ] top of RAM
 *                                   ^_end      ^heap_end    ^sp
 *
 * Every block starts with a header that holds its size. A block is either in
 * use (handed out by malloc) or free. Free blocks are chained into a list
 * sorted by address, so neighbours are easy to find and merge.
 *
 * malloc(n) walks the free list and takes the first block that is big enough
 * ("first fit"), splitting off the rest when it is large. When no free block
 * fits, it takes fresh memory from the top of the heap, as long as that stays
 * HEAP_GUARD bytes below the stack pointer. Out of room means NULL.
 *
 * free(p) puts the block back in the list at its address and merges it with
 * the free block right after it and right before it ("coalescing"), so
 * freed memory does not stay chopped into small pieces.
 */
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

/* Room always kept free between the heap and the stack pointer. */
#define HEAP_GUARD 4096
/* Every block (and so every pointer malloc returns) is aligned to 8 bytes. */
#define ALIGN 8

typedef struct Block {
    size_t size;        /* bytes after the header that the block owns */
    struct Block *next; /* next free block (only used while the block is free) */
} Block;

extern char _end[];          /* from end.s: where the heap begins */
static char *heap_end;       /* first byte the heap has not used yet */
static Block *free_list;     /* free blocks, lowest address first */

/* Address just past a block's bytes. */
static char *block_end(Block *b)
{
    return (char *)(b + 1) + b->size;
}

/* Take size bytes from the top of the heap, or NULL if the stack is too close. */
static Block *grow_heap(size_t size)
{
    char here; /* a local variable lives on the stack, so &here is about sp */
    size_t limit = (size_t)&here - HEAP_GUARD;
    size_t top;
    Block *b;

    if (heap_end == NULL)
        heap_end = (char *)(((size_t)_end + ALIGN - 1) & ~(size_t)(ALIGN - 1));
    top = (size_t)heap_end;
    if (top > limit || limit - top < sizeof(Block) + size)
        return NULL;
    b = (Block *)heap_end;
    b->size = size;
    heap_end = block_end(b);
    return b;
}

void *malloc(size_t size)
{
    Block *prev = NULL;
    Block *b = free_list;

    if (size == 0)
        return NULL;
    if (size > 0x7ffffff0)
        return NULL;
    size = (size + ALIGN - 1) & ~(size_t)(ALIGN - 1);

    /* First fit: the first free block that is big enough. */
    while (b != NULL && b->size < size) {
        prev = b;
        b = b->next;
    }

    if (b == NULL) {
        b = grow_heap(size);
        if (b == NULL)
            return NULL;
        return b + 1;
    }

    /* Split when the leftover can hold a header and a few bytes of its own. */
    if (b->size >= size + sizeof(Block) + ALIGN) {
        Block *rest = (Block *)((char *)(b + 1) + size);
        rest->size = b->size - size - sizeof(Block);
        rest->next = b->next;
        b->size = size;
        b->next = rest;
    }

    /* Unlink b from the free list. */
    if (prev == NULL)
        free_list = b->next;
    else
        prev->next = b->next;
    return b + 1; /* the caller's memory starts after the header */
}

void free(void *ptr)
{
    Block *b;
    Block *prev = NULL;
    Block *next = free_list;

    if (ptr == NULL)
        return;
    b = (Block *)ptr - 1;

    /* Find b's place in the address-sorted list: between prev and next. */
    while (next != NULL && next < b) {
        prev = next;
        next = next->next;
    }

    /* Merge with the block after it, if they touch. */
    if (next != NULL && block_end(b) == (char *)next) {
        b->size = b->size + sizeof(Block) + next->size;
        b->next = next->next;
    } else {
        b->next = next;
    }

    /* Merge with the block before it, if they touch. */
    if (prev != NULL && block_end(prev) == (char *)b) {
        prev->size = prev->size + sizeof(Block) + b->size;
        prev->next = b->next;
    } else if (prev != NULL) {
        prev->next = b;
    } else {
        free_list = b;
    }
}

void *calloc(size_t count, size_t size)
{
    size_t total;
    void *p;
    if (size != 0 && count > 0xffffffff / size)
        return NULL; /* count * size does not fit in 32 bits */
    total = count * size;
    p = malloc(total);
    if (p != NULL)
        memset(p, 0, total);
    return p;
}

/* Resize: keep the block when it is already big enough, else move the bytes. */
void *realloc(void *ptr, size_t size)
{
    Block *b;
    void *bigger;
    if (ptr == NULL)
        return malloc(size);
    if (size == 0) {
        free(ptr);
        return NULL;
    }
    b = (Block *)ptr - 1;
    if (b->size >= size)
        return ptr;
    bigger = malloc(size);
    if (bigger == NULL)
        return NULL;
    memcpy(bigger, ptr, b->size);
    free(ptr);
    return bigger;
}

/* Skip spaces, read an optional sign and decimal digits. */
int atoi(const char *s)
{
    int negative = 0;
    int n = 0;
    while (*s == ' ' || (*s >= '\t' && *s <= '\r'))
        s++;
    if (*s == '-' || *s == '+') {
        negative = *s == '-';
        s++;
    }
    while (*s >= '0' && *s <= '9') {
        n = n * 10 + (*s - '0');
        s++;
    }
    return negative ? -n : n;
}

int abs(int x)
{
    return x < 0 ? -x : x;
}

/*
 * A linear congruential generator: next = next * 1103515245 + 12345.
 * The low bits of an LCG repeat quickly, so rand returns bits 16 to 30.
 */
static unsigned int rand_next = 1;

int rand(void)
{
    rand_next = rand_next * 1103515245 + 12345;
    return (int)((rand_next >> 16) & RAND_MAX);
}

void srand(unsigned int seed)
{
    rand_next = seed;
}

/* exit is in crt0.s: it is one ecall. abort exits with 134, like SIGABRT. */
void abort(void)
{
    exit(134);
}

void __assert_fail(const char *expr, const char *file, int line)
{
    printf("%s:%d: assertion failed: %s\n", file, line, expr);
    abort();
}
