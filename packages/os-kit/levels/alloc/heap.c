/* sbrk grows the heap a page at a time. */
#include "user.h"

int main(void) {
  int f0 = freemem();
  char *a = sbrk(3 * 4096);
  char *b = sbrk(0);
  print("sbrk(12288) used ");
  printint(f0 - freemem());
  print(" pages and moved the end by ");
  printint(b - a);
  print("\n");
  a[0] = 1;
  a[3 * 4096 - 1] = 2;
  print("first and last byte: ");
  printint(a[0] + a[3 * 4096 - 1]);
  print("\nsbrk(-1): ");
  printint((int)sbrk(-1));
  print("\n");
  return 0;
}
