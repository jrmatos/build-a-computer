/* init for the "edges" test: offsets, end of file, bad descriptors. */
#include "user.h"

int main(void) {
  char buf[8];
  int fd = open("readme.txt");
  int fd2 = open("readme.txt");
  int n;
  print("fds ");
  printint(fd);
  print(" ");
  printint(fd2);
  print("\n");
  n = read(fd, buf, 5);
  write(1, buf, n);
  n = read(fd2, buf, 3);
  write(1, buf, n);
  n = read(fd, buf, 5);
  write(1, buf, n);
  print("\n");
  while (read(fd, buf, 8) > 0) {
  }
  print("at the end: ");
  printint(read(fd, buf, 8));
  print("\nmissing file: ");
  printint(open("missing"));
  print("\nclose: ");
  printint(close(fd));
  print(" then ");
  printint(close(fd));
  print("\nread closed fd: ");
  printint(read(fd, buf, 1));
  print("\nempty file: ");
  fd = open("empty");
  printint(read(fd, buf, 8));
  print("\nprefix of a name: ");
  printint(open("readme"));
  print("\n12-character name: ");
  if (open("twelve_chars") >= 0)
    print("found\n");
  else
    print("missing\n");
  return 0;
}
