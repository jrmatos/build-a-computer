/* 006-shifts: logical vs arithmetic right shift, all shift counts 0..31, promoted small types */
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

static int sample[8] = {0, 1, 4, 7, 8, 16, 24, 31};
static volatile int vneg = -123456789;

int main(void) {
  int i, k;
  unsigned h = 0;
  unsigned u = 0x80000000u, pat = 0x12345678u;
  int sn = (int)0x80000000u, m1 = -1, n = vneg;
  unsigned char uc = 0x80;
  signed char sc = -128;
  unsigned short us = 0xf00f;
  for (i = 0; i < 32; i++) {
    h = h * 31u + (1u << i);
    h = h * 31u + (u >> i);
    h = h * 31u + (unsigned)(sn >> i);
    h = h * 31u + (unsigned)(m1 >> i);
    h = h * 31u + (pat >> i) + (pat << i);
    h = h * 31u + (unsigned)(n >> i);
    h = h * 31u + ((unsigned)n >> i);
  }
  for (k = 0; k < 8; k++) {
    i = sample[k];
    puts_("s="); puti(i);
    puts_(" 1u<<s="); putx(1u << i);
    puts_(" u>>s="); putx(u >> i);
    puts_(" sn>>s="); puti(sn >> i);
    puts_(" n>>s="); puti(n >> i);
    puts_(" (u)n>>s="); putu((unsigned)n >> i);
    puts_(" pat<<s="); putx(pat << i);
    nl();
  }
  show("-1>>31", m1 >> 31);
  show("-1>>0", m1 >> 0);
  show("-2>>1", -2 >> 1);
  show("-3>>1", -3 >> 1);
  show("-5>>2", -5 >> 2);
  show("100>>3", 100 >> 3);
  show("1<<30", 1 << 30);
  showu("1u<<31", 1u << 31);
  show("3<<29", 3 << 29);
  show("uc<<1", uc << 1);
  show("uc<<24 (int, fits)", (uc & 0x7f) << 24);
  show("uc>>1", uc >> 1);
  show("~uc", ~uc);
  show("(unsigned char)(uc<<1)", (unsigned char)(uc << 1));
  show("sc>>1", sc >> 1);
  show("sc>>7", sc >> 7);
  show("us<<4", us << 4);
  show("us>>4", us >> 4);
  show("(unsigned short)(us<<4)", (unsigned short)(us << 4));
  k = 3;
  show("x<<=k chain", ((5 << k) >> 1) << 2);
  showu("rot-ish", (pat << 8) | (pat >> 24));
  showu("hash", h);
  return (int)(h & 0xff);
}
