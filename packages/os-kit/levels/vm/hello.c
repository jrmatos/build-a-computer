#include "user.h"

int main(int argc, char **argv) {
  print("hello from pid ");
  printint(getpid());
  print(", argv[0] = ");
  print(argv[0]);
  print("\n");
  return 0;
}
