/*
 * kalloc.c: the page frame allocator. Yours to write.
 *
 * Keep the free pages on a linked list threaded through the pages
 * themselves: a free page's first word points to the next free page.
 */
#include "kernel.h"

struct run {
  struct run *next;
};

static struct run *freelist;
static uint nfree;
static uint mem_start;
static uint mem_end;

/* Round start up to a page boundary, remember the range, and kfree every
   whole page in [start, end). */
void kinit(uint start, uint end) {
  /* TODO */
}

/* Push a page on the free list. panic() if it is not page-aligned or not
   inside the kinit range. */
void kfree(void *pa) {
  /* TODO */
}

/* Pop a page, fill it with zeros, return it; 0 when no page is free. */
void *kalloc(void) {
  /* TODO */
  return 0;
}

uint kfree_count(void) {
  return nfree;
}
