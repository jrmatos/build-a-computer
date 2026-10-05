/* A page a process frees must not show its old contents to the next one. */
#include "user.h"

int main(void) {
  int status;
  spawn("dirty", 0);
  wait(&status);
  spawn("clean", 0);
  wait(&status);
  if (status == 0)
    print("fresh pages are zero: yes\n");
  else
    print("fresh pages are zero: no\n");
  return 0;
}
