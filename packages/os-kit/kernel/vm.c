/*
 * vm.c: Sv32 page tables.
 *
 * A 32-bit virtual address splits into VPN[1] (10 bits), VPN[0] (10 bits)
 * and a 12-bit offset. The root table (one page, 1024 entries) is indexed
 * by VPN[1]; its entry points to a leaf table indexed by VPN[0]; the leaf
 * entry holds the physical page number and the permission bits.
 *
 * The kernel runs in machine mode, which ignores satp: only user mode sees
 * these tables. So a program's table maps just the program.
 */
#include "kernel.h"

/*
 * The address of the leaf entry for va in pagetable. When the leaf table is
 * missing: with alloc, make one (a zeroed page from kalloc); without, return 0.
 */
uint *walk(uint *pagetable, uint va, int alloc) {
  uint *pte = &pagetable[VPN1(va)];
  uint *table;
  if (*pte & PTE_V) {
    table = (uint *)PTE2PA(*pte);
  } else {
    if (!alloc)
      return 0;
    table = kalloc();
    if (table == 0)
      return 0;
    *pte = PA2PTE((uint)table) | PTE_V;   /* V alone: points to the next level */
  }
  return &table[VPN0(va)];
}

/*
 * Map the page at va to the physical page pa with permissions perm
 * (PTE_R, PTE_W, PTE_X, PTE_U, ...). Returns -1 when out of memory or when
 * va is already mapped.
 */
int map_page(uint *pagetable, uint va, uint pa, uint perm) {
  uint *pte = walk(pagetable, va, 1);
  if (pte == 0)
    return -1;
  if (*pte & PTE_V)
    return -1;
  /* A and D set up front: the CPU need not write them back on first use. */
  *pte = PA2PTE(pa) | perm | PTE_V | PTE_A | PTE_D;
  return 0;
}

/*
 * The physical address that user virtual address va maps to, or 0 when va
 * is not mapped or not a user page.
 */
uint va2pa(uint *pagetable, uint va) {
  uint *pte = walk(pagetable, va, 0);
  if (pte == 0)
    return 0;
  if ((*pte & PTE_V) == 0 || (*pte & PTE_U) == 0)
    return 0;
  return PTE2PA(*pte) | (va & (PGSIZE - 1));
}
