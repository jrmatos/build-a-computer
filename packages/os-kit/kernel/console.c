/*
 * console.c: the kernel's own printing (straight to the UART) and the small
 * string helpers every file uses. Kernel helpers start with k so they never
 * clash with a program's strlen or memcpy.
 */
#include "kernel.h"

void kputc(int c) {
  *(volatile uchar *)UART = c;
}

void kputs(char *s) {
  while (*s) {
    kputc(*s);
    s++;
  }
}

void kputu(uint n) {
  char buf[12];
  int i = 0;
  do {
    buf[i] = '0' + n % 10;
    i++;
    n = n / 10;
  } while (n != 0);
  while (i > 0) {
    i--;
    kputc(buf[i]);
  }
}

void kputi(int n) {
  if (n < 0) {
    kputc('-');
    kputu(0 - (uint)n);
  } else {
    kputu(n);
  }
}

void kputx(uint n) {
  int shift;
  kputs("0x");
  for (shift = 28; shift >= 0; shift = shift - 4)
    kputc("0123456789abcdef"[(n >> shift) & 15]);
}

/* The next byte from the UART, or -1 when nothing is waiting. */
int kgetc(void) {
  if ((*(volatile uchar *)(UART + 5) & 1) == 0)
    return -1;
  return *(volatile uchar *)UART;
}

void panic(char *msg) {
  kputs("panic: ");
  kputs(msg);
  kputc('\n');
  halt(255);
}

uint kstrlen(char *s) {
  uint n = 0;
  while (s[n])
    n++;
  return n;
}

int kstreq(char *a, char *b) {
  while (*a && *a == *b) {
    a++;
    b++;
  }
  return *a == *b;
}

void kmemcpy(void *dst, void *src, uint n) {
  uchar *d = dst;
  uchar *s = src;
  if ((((uint)d | (uint)s | n) & 3) == 0) {  /* whole words: 4 times faster */
    uint *dw = dst;
    uint *sw = src;
    while (n > 0) {
      *dw = *sw;
      dw++;
      sw++;
      n = n - 4;
    }
    return;
  }
  while (n > 0) {
    *d = *s;
    d++;
    s++;
    n--;
  }
}

void kmemset(void *dst, int c, uint n) {
  uchar *d = dst;
  if (c == 0 && (((uint)d | n) & 3) == 0) {
    uint *dw = dst;
    while (n > 0) {
      *dw = 0;
      dw++;
      n = n - 4;
    }
    return;
  }
  while (n > 0) {
    *d = c;
    d++;
    n--;
  }
}
