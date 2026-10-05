/*
 * kalloc.c: the page frame allocator.
 *
 * Free memory is cut into 4096-byte pages. Each free page holds, in its
 * first word, a pointer to the next free page: the free list costs no extra
 * memory. kalloc pops a page off the list; kfree pushes one back.
 */
#include "kernel.h"

struct run {
  struct run *next;
};

static struct run *freelist;
static uint nfree;
static uint mem_start;           /* the range kinit handed out */
static uint mem_end;

/* Put every whole page in [start, end) on the free list. */
void kinit(uint start, uint end) {
  uint pa;
  start = (start + PGSIZE - 1) & ~(PGSIZE - 1);
  mem_start = start;
  mem_end = end;
  freelist = 0;
  nfree = 0;
  for (pa = start; pa + PGSIZE <= end; pa = pa + PGSIZE)
    kfree((void *)pa);
}

/* Return a page to the free list. */
void kfree(void *pa) {
  struct run *r = pa;
  uint a = (uint)pa;
  if ((a & (PGSIZE - 1)) != 0 || a < mem_start || a >= mem_end)
    panic("kfree: not a page from kalloc");
  r->next = freelist;
  freelist = r;
  nfree++;
}

/* A zeroed page, or 0 when memory is full. */
void *kalloc(void) {
  struct run *r = freelist;
  if (r == 0)
    return 0;
  freelist = r->next;
  nfree--;
  kmemset(r, 0, PGSIZE);
  return r;
}

/* How many pages are free. */
uint kfree_count(void) {
  return nfree;
}
