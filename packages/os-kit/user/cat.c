/* cat: print files. */
#include "user.h"

int main(int argc, char **argv) {
  char buf[128];
  int i;
  int fd;
  int n;
  int status = 0;
  for (i = 1; i < argc; i++) {
    fd = open(argv[i]);
    if (fd < 0) {
      print("cat: cannot open ");
      print(argv[i]);
      print("\n");
      status = 1;
      continue;
    }
    while ((n = read(fd, buf, 128)) > 0)
      write(1, buf, n);
    close(fd);
  }
  return status;
}
