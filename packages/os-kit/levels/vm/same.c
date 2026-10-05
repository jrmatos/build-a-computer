/* Every copy of this program has `value` at the same virtual address. */
#include "user.h"

int value;

int main(void) {
  int i;
  value = getpid() * 100;
  print("pid ");
  printint(getpid());
  print(": value ");
  printint(value);
  print("\n");
  for (i = 0; i < 3; i++)
    yield();
  print("pid ");
  printint(getpid());
  print(": value still ");
  printint(value);
  print("\n");
  return 0;
}
