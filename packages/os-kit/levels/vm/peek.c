/* Kernel memory is not mapped in a program's page table. */
#include "user.h"

int main(void) {
  int *kernel = (int *)0x80000000;
  print("peeking at the kernel...\n");
  printint(*kernel);
  print("survived!\n");
  return 0;
}
