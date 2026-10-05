/* hello: greet, and show the arguments. */
#include "user.h"

int main(int argc, char **argv) {
  int i;
  print("Hello from pid ");
  printint(getpid());
  print("!\n");
  for (i = 0; i < argc; i++) {
    print("  argv[");
    printint(i);
    print("] = ");
    print(argv[i]);
    print("\n");
  }
  return 0;
}
