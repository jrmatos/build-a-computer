/* init for the "cat" test: print a small file, then summarize a big one. */
#include "user.h"

int main(void) {
  char buf[100];
  int fd = open("readme.txt");
  int n;
  uint total = 0;
  uint sum = 0;
  int i;
  if (fd < 0) {
    print("no readme.txt\n");
    return 1;
  }
  while ((n = read(fd, buf, 100)) > 0)
    write(1, buf, n);
  close(fd);
  fd = open("big.txt");
  if (fd < 0) {
    print("no big.txt\n");
    return 1;
  }
  while ((n = read(fd, buf, 100)) > 0) {
    for (i = 0; i < n; i++)
      sum = sum * 31 + (unsigned char)buf[i];
    total = total + n;
  }
  print("big.txt: ");
  printint(total);
  print(" bytes, checksum ");
  printhex(sum);
  print("\n");
  return 0;
}
