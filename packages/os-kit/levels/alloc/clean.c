#include "user.h"

int main(void) {
  char *p = sbrk(8 * 4096);
  int i;
  for (i = 0; i < 8 * 4096; i++)
    if (p[i] != 0)
      return 1;
  return 0;
}
