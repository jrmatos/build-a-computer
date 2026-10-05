/*
 * vm.c: Sv32 page tables. Yours to write.
 *
 * A virtual address is VPN[1] (bits 31-22), VPN[0] (bits 21-12) and a page
 * offset (bits 11-0). The root table (1024 entries, one page) is indexed by
 * VPN[1]; a valid entry there points to a leaf table indexed by VPN[0]; the
 * leaf entry maps the page. kernel.h has PTE_V, PTE_R, ..., VPN1, VPN0,
 * PA2PTE and PTE2PA.
 */
#include "kernel.h"

/*
 * The address of the leaf entry for va. When the root entry is not valid:
 * with alloc, take a zeroed page from kalloc() for the leaf table and point
 * the root entry at it (PA2PTE(table) | PTE_V); without alloc (or when
 * kalloc fails), return 0.
 */
uint *walk(uint *pagetable, uint va, int alloc) {
  /* TODO */
  return 0;
}

/*
 * Map the page at va to physical page pa with permissions perm. Returns -1
 * when walk fails or va is already mapped. Set PTE_V, and PTE_A | PTE_D too.
 */
int map_page(uint *pagetable, uint va, uint pa, uint perm) {
  /* TODO */
  return -1;
}

/* The physical address for user address va, or 0 if it is not mapped with PTE_U. */
uint va2pa(uint *pagetable, uint va) {
  /* TODO */
  return 0;
}
