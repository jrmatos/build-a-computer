/* Run memory out, then check that every page comes back. */
#include "user.h"

int main(void) {
  int f0 = freemem();
  int status;
  spawn("hog", 0);
  wait(&status);
  print("hog exited with ");
  printint(status);
  print("\nall pages back: ");
  if (freemem() == f0)
    print("yes\n");
  else
    print("no\n");
  return 0;
}
