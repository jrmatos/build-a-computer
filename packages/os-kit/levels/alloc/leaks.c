/* Spawn and reap ten children: every page they used must come back. */
#include "user.h"

int main(void) {
  char num[12];
  char *argv[3];
  int f0 = freemem();
  int i;
  int n = f0;
  int k = 11;
  num[k] = 0;
  do {
    k--;
    num[k] = '0' + n % 10;
    n = n / 10;
  } while (n);
  for (i = 0; i < 10; i++) {
    argv[0] = "child";
    argv[1] = 0;
    if (i == 0)
      argv[1] = num + k;
    argv[2] = 0;
    if (spawn("child", argv) < 0) {
      print("spawn failed\n");
      return 1;
    }
    wait(0);
  }
  print("after 10 children: ");
  printint(f0 - freemem());
  print(" pages lost\n");
  return 0;
}
