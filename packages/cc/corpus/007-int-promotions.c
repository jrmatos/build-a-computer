/* 007-int-promotions: small types promote to int, usual arithmetic conversions, signed vs unsigned compares */
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

static unsigned char ua = 200, ub = 100;
static unsigned short us = 65535;
static short ss = -1;
static signed char sc = -100;
static char pc = 200;

int main(void) {
  int i = -5, r = 0;
  unsigned u = 3, uz = 0;
  long l = -1;
  unsigned char z = 0;
  show("ua+ub", ua + ub);
  show("(unsigned char)(ua+ub)", (unsigned char)(ua + ub));
  show("ua*ub", ua * ub);
  show("ub-ua", ub - ua);
  show("-ua", -ua);
  show("~ua", ~ua);
  show("-ua/2", -ua / 2);
  show("us+1", us + 1);
  show("us*2", us * 2);
  show("-us", -us);
  show("~us", ~us);
  show("ss+sc", ss + sc);
  show("sc*sc", sc * sc);
  show("pc+pc", pc + pc);
  show("pc>sc", pc > sc);
  show("z-1", z - 1);
  show("z-1<0", z - 1 < 0);
  show("uz-1>0", uz - 1 > 0);
  show("-1+0u<1u", -1 + 0u < 1u);
  show("-1<1", -1 < 1);
  show("ss+0u<1u", ss + 0u < 1u);
  show("sc<ua", sc < ua);
  show("l+0u<1u (ilp32: unsigned long)", l + 0u < 1u);
  show("(unsigned char)255==-1", (unsigned char)255 == -1);
  show("(signed char)-1==-1", (signed char)-1 == -1);
  show("i<u", i < (int)u);
  show("(unsigned)i>u", (unsigned)i > u);
  showu("i/u", i / u);
  showu("i%u", i % u);
  showu("i+u", i + u);
  showu("i*u", i * u);
  showu("-u/2", -u / 2);
  show("ternary 1?ua:-1", 1 ? ua : -1);
  showu("ternary 0?ua:-1+0u", 0 ? ua : -1 + 0u);
  show("sizeof(ua+ub)", (int)sizeof(ua + ub));
  show("sizeof(+sc)", (int)sizeof(+sc));
  show("sizeof(ua)", (int)sizeof(ua));
  if (ua + ub > 255) r += 1;
  if ((unsigned char)(ua + ub) < 50) r += 2;
  if (-1 < (int)u) r += 4;
  if (-1 + 0u > u) r += 8;
  if (sc < 0) r += 16;
  if (pc > 0) r += 32;
  show("flags", r);
  return r + 7;
}
