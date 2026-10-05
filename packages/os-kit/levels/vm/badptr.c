/* System calls given addresses the program does not own must fail cleanly. */
#include "user.h"

int main(void) {
  print("kernel address: ");
  printint(write(1, (void *)0x80000000, 4));
  print("\nunmapped: ");
  printint(write(1, (void *)0x00400000, 4));
  print("\nnull: ");
  printint(write(1, (void *)0, 1));
  print("\nstack guard page: ");
  printint(write(1, (void *)0x00ffd000, 4));
  print("\nread-only page: ");
  printint(read(0, (void *)0x10000, 4));
  print("\nmy own string: ");
  printint(write(1, "ok", 2));
  print("\n");
  return 0;
}
