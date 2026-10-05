/* 004-unsigned-wrap: unsigned overflow/underflow wraparound in add, sub, mul, negate, narrow types */
/* Corpus prelude: paste at the top of every freestanding program (no libc). */
#define UART ((volatile unsigned char *)0x10000000)

static void putch(int c) { *UART = (unsigned char)c; }
static void puts_(const char *s) { while (*s) putch(*s++); }
static void putu(unsigned v) {
  char buf[12];
  int i = 0;
  do { buf[i++] = (char)('0' + v % 10); v /= 10; } while (v);
  while (i > 0) putch(buf[--i]);
}
static void puti(int v) {
  if (v < 0) { putch('-'); putu(0u - (unsigned)v); }
  else putu((unsigned)v);
}
static void putx(unsigned v) {
  int i;
  for (i = 28; i >= 0; i -= 4) putch("0123456789abcdef"[(v >> i) & 15]);
}
static void nl(void) { putch('\n'); }
static void show(const char *label, int v) { puts_(label); puts_(" = "); puti(v); nl(); }
static void showu(const char *label, unsigned v) { puts_(label); puts_(" = "); putu(v); puts_(" 0x"); putx(v); nl(); }
/* end prelude */

#define UMAX 0xffffffffu

static volatile unsigned vzero = 0;

int main(void) {
  unsigned a = vzero, b, x, acc = 0;
  unsigned char uc = 250;
  unsigned short us = 65530;
  int i;
  b = a - 1u;
  showu("0u-1", b);
  showu("UMAX+1", b + 1u);
  showu("UMAX+UMAX", b + b);
  showu("UMAX*UMAX", b * b);
  showu("0x10000*0x10000", (a + 0x10000u) * 0x10000u);
  showu("0x10000*0x10001", (a + 0x10000u) * 0x10001u);
  showu("0x7fffffff+1", (a + 0x7fffffffu) + 1u);
  showu("0x80000000*2", (a + 0x80000000u) * 2u);
  showu("3-5", (a + 3u) - 5u);
  showu("-(5u)", -(a + 5u));
  showu("~0u", ~a);
  showu("123456789*987654321", (a + 123456789u) * 987654321u);
  showu("UMAX/2+UMAX/2+2", b / 2u + b / 2u + 2u);
  x = 1;
  for (i = 0; i < 40; i++) {
    x = x * 1664525u + 1013904223u;
    acc ^= x;
    if (i % 8 == 7) showu("lcg", x);
  }
  showu("lcg acc", acc);
  x = 1;
  for (i = 0; i < 35; i++) x *= 3u;
  showu("3^35 mod 2^32", x);
  x = 0;
  for (i = 0; i < 10; i++) x -= 0x20000000u;
  showu("0 - 10*2^29", x);
  for (i = 0; i < 3; i++) {
    uc = (unsigned char)(uc + 3);
    show("uc+=3", uc);
  }
  uc = 0;
  uc = (unsigned char)(uc - 1);
  show("uc 0-1", uc);
  for (i = 0; i < 3; i++) {
    us = (unsigned short)(us + 4);
    show("us+=4", us);
  }
  us = 0;
  us--;
  show("us 0--", us);
  us = 300;
  us = (unsigned short)(us * us);
  show("us 300*300", us);
  return (int)((acc + x + uc + us) & 0xff);
}
