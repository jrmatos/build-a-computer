/* init for the "run" test: start programs from the disk. */
#include "user.h"

int main(void) {
  char *argv[4];
  int status;
  int pid;
  argv[0] = "hello";
  argv[1] = "from";
  argv[2] = "disk";
  argv[3] = 0;
  pid = spawn("hello", argv);
  wait(&status);
  print("hello was pid ");
  printint(pid);
  print(", exit ");
  printint(status);
  print("\n");
  print("nosuch: ");
  printint(spawn("nosuch", 0));
  print("\nreadme.txt: ");
  printint(spawn("readme.txt", 0));
  print("\n");
  return 0;
}
