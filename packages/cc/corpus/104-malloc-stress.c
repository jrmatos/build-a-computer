#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SLOTS 40

static unsigned char *ptrs[SLOTS];
static unsigned sizes[SLOTS];
static unsigned seed = 12345u;

static unsigned rnd(void) { seed = seed * 1664525u + 1013904223u; return seed >> 8; }

static int verify(int i) {
  unsigned k;
  unsigned char pat = (unsigned char)(i * 37 + 1);
  for (k = 0; k < sizes[i]; k++) if (ptrs[i][k] != pat) return 0;
  return 1;
}
static int alloc_slot(int i, unsigned size) {
  ptrs[i] = (unsigned char *)malloc(size);
  if (!ptrs[i]) return 0;
  sizes[i] = size;
  memset(ptrs[i], i * 37 + 1, size);
  return 1;
}
static void free_slot(int i) { free(ptrs[i]); ptrs[i] = 0; sizes[i] = 0; }

int main(void) {
  int i, round, bad = 0, allocs = 0, fails = 0;
  unsigned live, total_bytes = 0, check = 0;
  for (round = 0; round < 6; round++) {
    for (i = 0; i < SLOTS; i++) {
      if (!ptrs[i]) {
        unsigned size = 1u + rnd() % (round % 2 ? 2000u : 300u);
        if (alloc_slot(i, size)) { allocs++; total_bytes += size; } else fails++;
      }
    }
    live = 0;
    for (i = 0; i < SLOTS; i++) {
      if (ptrs[i]) { live += sizes[i]; if (!verify(i)) bad++; }
    }
    printf("round %d: live bytes %u bad %d\n", round, live, bad);
    check = check * 7u + live;
    /* free in different orders */
    if (round % 3 == 0) { for (i = 0; i < SLOTS; i += 2) free_slot(i); }
    else if (round % 3 == 1) { for (i = SLOTS - 1; i >= 0; i -= 3) if (ptrs[i]) free_slot(i); }
    else { for (i = 0; i < SLOTS; i++) if (rnd() % 2u && ptrs[i]) free_slot(i); }
    for (i = 0; i < SLOTS; i++) if (ptrs[i] && !verify(i)) bad++;
  }
  /* grow pattern: many small allocations, freed then large allocation reuses */
  for (i = 0; i < SLOTS; i++) if (ptrs[i]) free_slot(i);
  for (i = 0; i < SLOTS; i++) { if (alloc_slot(i, 16u)) allocs++; }
  for (i = 0; i < SLOTS; i++) if (!verify(i)) bad++;
  for (i = SLOTS - 1; i >= 0; i--) free_slot(i);
  if (alloc_slot(0, 50000u)) {
    allocs++;
    if (!verify(0)) bad++;
    ptrs[0][49999] = 7;
    check += ptrs[0][49999] + ptrs[0][0];
    free_slot(0);
  }
  printf("allocs %d fails %d bad %d total %u\n", allocs, fails, bad, total_bytes);
  printf("check %u\n", check);
  return bad ? 200 : (int)(check & 0x7f);
}
