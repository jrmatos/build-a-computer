/* The program's own code is mapped read-only (and executable). */
#include "user.h"

int main(void) {
  int *code = (int *)0x10000;
  print("writing over my own code...\n");
  *code = 0;
  print("survived!\n");
  return 0;
}
