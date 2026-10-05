/* 023-mul-div-edge: wrapping unsigned multiply, signed div by powers of two vs shifts, big unsigned division */
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

static int negs[8] = {-1, -2, -7, -8, -9, -15, -16, -1000001};
static unsigned bigs[6] = {0xffffffffu, 0x80000000u, 4000000000u, 0xdeadbeefu, 3u, 0x7fffffffu};
static unsigned divs[5] = {1u, 3u, 7u, 0x10000u, 1000000u};

int main(void) {
  int i, j, x;
  unsigned h = 1, a = 0xdeadbeefu;
  showu("0xdeadbeef*0x12345679", a * 0x12345679u);
  showu("65537*65537", 65537u * 65537u);
  showu("0xffffffff*0xffffffff", 0xffffffffu * 0xffffffffu);
  showu("0x80000000*3", 0x80000000u * 3u);
  show("-46341*46340", -46341 * 46340);
  show("46340*46340", 46340 * 46340);
  show("-32768*65536", -32768 * 65536);
  for (i = 0; i < 8; i++) {
    x = negs[i];
    puti(x);
    puts_(": /2="); puti(x / 2); puts_(" >>1="); puti(x >> 1);
    puts_(" /4="); puti(x / 4); puts_(" >>2="); puti(x >> 2);
    puts_(" %4="); puti(x % 4); puts_(" &3="); puti(x & 3);
    puts_(" /16="); puti(x / 16); puts_(" >>4="); puti(x >> 4);
    puts_(" /1="); puti(x / 1); puts_(" %1="); puti(x % 1);
    nl();
    h = h * 131u + (unsigned)(x / 2) + (unsigned)(x >> 1) + (unsigned)(x % 16);
  }
  for (i = 0; i < 6; i++) {
    for (j = 0; j < 5; j++) {
      unsigned q = bigs[i] / divs[j], r = bigs[i] % divs[j];
      putx(bigs[i]); puts_(" / "); putu(divs[j]); puts_(" = "); putu(q);
      puts_(" r "); putu(r);
      if (q * divs[j] + r != bigs[i]) puts_(" BAD");
      nl();
      h = h * 31u + q + r;
    }
  }
  showu("big/small>big", 5u / 0xffffffffu);
  showu("0xffffffff%0x80000000", 0xffffffffu % 0x80000000u);
  show("(unsigned)-7/2 as int", (int)((unsigned)-7 / 2u));
  show("-7/(int)2u", -7 / (int)2u);
  showu("-7/2u (unsigned)", -7 / 2u);
  show("12345%1", 12345 % 1);
  show("-12345%-1", -12345 % -1);
  showu("hash", h);
  return (int)(h & 0xff);
}
