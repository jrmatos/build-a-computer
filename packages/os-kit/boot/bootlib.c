/* bootlib.c: printing for the bootloader (provided). */
#include "boot.h"

static void boot_putc(int c) {
  *(volatile uchar *)0x10000000 = c;
}

void boot_print(char *s) {
  while (*s) {
    boot_putc(*s);
    s++;
  }
}

void boot_print_dec(uint n) {
  char buf[12];
  int i = 0;
  do {
    buf[i] = '0' + n % 10;
    i++;
    n = n / 10;
  } while (n != 0);
  while (i > 0) {
    i--;
    boot_putc(buf[i]);
  }
}

void boot_print_hex(uint n) {
  int shift;
  boot_print("0x");
  for (shift = 28; shift >= 0; shift = shift - 4)
    boot_putc("0123456789abcdef"[(n >> shift) & 15]);
}
