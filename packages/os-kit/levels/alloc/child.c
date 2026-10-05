#include "user.h"

int main(int argc, char **argv) {
  if (argc > 1) {
    print("a child uses ");
    printint(atoi(argv[1]) - freemem());
    print(" pages\n");
  }
  return 0;
}
