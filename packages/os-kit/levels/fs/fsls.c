/* init for the "ls" test: list the root directory. */
#include "user.h"

int main(void) {
  struct ustat st;
  int i;
  for (i = 0; readdir(i, &st) == 0; i++) {
    print(st.name);
    print(" ");
    printint(st.size);
    print("\n");
  }
  print(".\n");
  return i;
}
