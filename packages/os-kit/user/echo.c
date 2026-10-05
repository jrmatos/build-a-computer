/* echo: print the arguments, separated by spaces. */
#include "user.h"

int main(int argc, char **argv) {
  int i;
  for (i = 1; i < argc; i++) {
    if (i > 1)
      putchar(' ');
    print(argv[i]);
  }
  print("\n");
  return 0;
}
