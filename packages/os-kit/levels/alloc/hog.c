#include "user.h"

int main(void) {
  int pages = 0;
  while ((int)sbrk(4096) != -1)
    pages++;
  if (pages > 100)
    print("got over 100 pages, then sbrk failed\n");
  else
    print("sbrk failed early\n");
  print("free pages now: ");
  if (freemem() < 2)
    print("almost none\n");
  else
    print("plenty?\n");
  print("spawn now: ");
  printint(spawn("child", 0));
  print("\n");
  return 3;
}
