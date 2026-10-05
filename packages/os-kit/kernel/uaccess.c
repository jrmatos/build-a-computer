/*
 * uaccess.c: moving bytes between the kernel and a program's memory.
 *
 * A program hands the kernel addresses in *its* address space. Before the
 * kernel touches one, it must check that the program really owns it, or a
 * program could make the kernel read or overwrite anything.
 */
#include "kernel.h"

#ifndef CONFIG_VM
/*
 * No paging yet: a user address is a physical address. The only check is
 * that the whole range [uva, uva + n) lies in RAM (and does not wrap).
 */
static int user_range_ok(uint uva, uint n) {
  if (uva < RAM_BASE || uva >= RAM_END)
    return 0;
  if (n > RAM_END - uva)
    return 0;
  return 1;
}

int copyin(void *dst, uint uva, uint n) {
  if (!user_range_ok(uva, n))
    return -1;
  kmemcpy(dst, (void *)uva, n);
  return 0;
}

int copyout(uint uva, void *src, uint n) {
  if (!user_range_ok(uva, n))
    return -1;
  kmemcpy((void *)uva, src, n);
  return 0;
}
#endif

#ifdef CONFIG_VM
/*
 * With paging, translate one page at a time through the program's page
 * table: va2pa refuses addresses the program has not mapped (or that are
 * not marked user).
 */
int copyin_pt(uint *pagetable, void *dst, uint uva, uint n) {
  uchar *d = dst;
  uint pa;
  uint k;
  while (n > 0) {
    pa = va2pa(pagetable, uva);
    if (pa == 0)
      return -1;
    k = PGSIZE - (uva & (PGSIZE - 1));
    if (k > n)
      k = n;
    kmemcpy(d, (void *)pa, k);
    d = d + k;
    uva = uva + k;
    n = n - k;
  }
  return 0;
}

/* Like copyin_pt, but the pages must also be writable. */
int copyout_pt(uint *pagetable, uint uva, void *src, uint n) {
  uchar *s = src;
  uint *pte;
  uint pa;
  uint k;
  while (n > 0) {
    pa = va2pa(pagetable, uva);
    if (pa == 0)
      return -1;
    pte = walk(pagetable, uva, 0);
    if ((*pte & PTE_W) == 0)
      return -1;
    k = PGSIZE - (uva & (PGSIZE - 1));
    if (k > n)
      k = n;
    kmemcpy((void *)pa, s, k);
    s = s + k;
    uva = uva + k;
    n = n - k;
  }
  return 0;
}

int copyin(void *dst, uint uva, uint n) {
  return copyin_pt(current->pagetable, dst, uva, n);
}

int copyout(uint uva, void *src, uint n) {
  return copyout_pt(current->pagetable, uva, src, n);
}
#endif

/* Copy a 0-terminated string of at most max bytes (terminator included). */
int copyinstr(char *dst, uint uva, uint max) {
  uint i;
  for (i = 0; i < max; i++) {
    if (copyin(dst + i, uva + i, 1) < 0)
      return -1;
    if (dst[i] == 0)
      return i;
  }
  return -1;
}
