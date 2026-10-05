/* ls: list the files in the root directory with their sizes. */
#include "user.h"

int main(void) {
  struct ustat st;
  int i;
  int pad;
  for (i = 0; readdir(i, &st) == 0; i++) {
    print(st.name);
    for (pad = strlen(st.name); pad < 14; pad++)
      putchar(' ');
    printint(st.size);
    print("\n");
  }
  return 0;
}
