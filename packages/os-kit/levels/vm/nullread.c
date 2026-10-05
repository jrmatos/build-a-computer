#include "user.h"

int main(void) {
  int *p = 0;
  print("reading address 0...\n");
  printint(*p);
  print("survived!\n");
  return 0;
}
