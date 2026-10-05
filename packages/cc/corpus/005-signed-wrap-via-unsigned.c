/* 005-signed-wrap-via-unsigned: two's complement wraparound through unsigned arithmetic and conversions */
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

#define INT_MAX_ 2147483647
#define INT_MIN_ (-2147483647 - 1)

static int wadd(int a, int b) { return (int)((unsigned)a + (unsigned)b); }
static int wsub(int a, int b) { return (int)((unsigned)a - (unsigned)b); }
static int wmul(int a, int b) { return (int)((unsigned)a * (unsigned)b); }
static int wneg(int a) { return (int)(0u - (unsigned)a); }

int main(void) {
  int i, f0 = 0, f1 = 1, t, h;
  unsigned big = 3000000000u;
  show("INT_MAX+1", wadd(INT_MAX_, 1));
  show("INT_MIN-1", wsub(INT_MIN_, 1));
  show("INT_MAX+INT_MAX", wadd(INT_MAX_, INT_MAX_));
  show("INT_MIN+INT_MIN", wadd(INT_MIN_, INT_MIN_));
  show("-INT_MIN", wneg(INT_MIN_));
  show("INT_MAX*2", wmul(INT_MAX_, 2));
  show("65536*65536", wmul(65536, 65536));
  show("46341*46341", wmul(46341, 46341));
  show("-46341*46341", wmul(-46341, 46341));
  show("100000*-100000", wmul(100000, -100000));
  show("(int)0x80000000u", (int)0x80000000u);
  show("(int)0xffffffffu", (int)0xffffffffu);
  show("(int)3000000000u", (int)big);
  show("(int)(big+big)", (int)(big + big));
  show("(int)0xfffffffeu", (int)0xfffffffeu);
  showu("(unsigned)-1", (unsigned)-1);
  showu("(unsigned)INT_MIN", (unsigned)INT_MIN_);
  showu("(unsigned)-12345", (unsigned)-12345);
  show("(signed char)200", (signed char)200);
  show("(signed char)0x17f", (signed char)0x17f);
  show("(short)40000", (short)40000);
  show("(short)-40000", (short)-40000);
  show("(short)0xffff8000u", (short)0xffff8000u);
  for (i = 2; i <= 60; i++) {
    t = wadd(f0, f1);
    f0 = f1;
    f1 = t;
    if (i % 6 == 0) { puts_("fib "); puti(i); puts_(" = "); puti(f1); nl(); }
  }
  h = 0;
  for (i = 0; i < 50; i++) h = wadd(wmul(h, 31), i * 7 - 100);
  show("signed hash", h);
  show("hash>>3 (arith)", h >> 3);
  show("wsub(0,hash)", wsub(0, h));
  return (int)((unsigned)(h ^ f1) & 0xff);
}
