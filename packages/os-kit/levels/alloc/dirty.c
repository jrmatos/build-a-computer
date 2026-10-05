#include "user.h"

int main(void) {
  char *p = sbrk(8 * 4096);
  memset(p, 0xab, 8 * 4096);
  return 0;
}
