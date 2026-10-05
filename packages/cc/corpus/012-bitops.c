/* 012-bitops: & | ^ ~, popcount, bit reverse, rotates, lowest set bit, power-of-two tests */
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

static unsigned vals[8] = {0u, 1u, 0x80000000u, 0xffffffffu, 0x12345678u, 0xdeadbeefu, 64u, 0x00f0f000u};

static int popcount(unsigned x) { int n = 0; while (x) { x &= x - 1u; n++; } return n; }
static unsigned rev(unsigned x) {
  unsigned r = 0;
  int i;
  for (i = 0; i < 32; i++) { r = (r << 1) | (x & 1u); x >>= 1; }
  return r;
}
static unsigned rotl(unsigned x, int r) { r &= 31; return (x << r) | (x >> ((32 - r) & 31)); }
static unsigned rotr(unsigned x, int r) { r &= 31; return (x >> r) | (x << ((32 - r) & 31)); }
static int ctz(unsigned x) { int n = 0; if (!x) return 32; while (!(x & 1u)) { x >>= 1; n++; } return n; }
static int clz(unsigned x) { int n = 0; if (!x) return 32; while (!(x & 0x80000000u)) { x <<= 1; n++; } return n; }
static int is_pow2(unsigned x) { return x && !(x & (x - 1u)); }
static int parity(unsigned x) { x ^= x >> 16; x ^= x >> 8; x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return (int)(x & 1u); }

int main(void) {
  int i;
  unsigned h = 0, a = 0xf0f0f0f0u, b = 0x0ff00ff0u, s1 = 123, s2 = 456;
  showu("a&b", a & b);
  showu("a|b", a | b);
  showu("a^b", a ^ b);
  showu("~a", ~a);
  showu("a&~b", a & ~b);
  show("~0", ~0);
  show("~-1", ~-1);
  show("5&-2", 5 & -2);
  show("-8|3", -8 | 3);
  show("-1^5", -1 ^ 5);
  for (i = 0; i < 8; i++) {
    unsigned v = vals[i];
    puts_("v="); putx(v);
    puts_(" pop="); puti(popcount(v));
    puts_(" rev="); putx(rev(v));
    puts_(" rotl7="); putx(rotl(v, 7));
    puts_(" rotr13="); putx(rotr(v, 13));
    puts_(" low="); putx(v & (0u - v));
    puts_(" clrlow="); putx(v & (v - 1u));
    puts_(" ctz="); puti(ctz(v));
    puts_(" clz="); puti(clz(v));
    puts_(" p2="); puti(is_pow2(v));
    puts_(" par="); puti(parity(v));
    puts_(" gray="); putx(v ^ (v >> 1));
    nl();
    h = h * 33u + (unsigned)popcount(v) + rev(v) + rotl(v, i * 5) + (unsigned)(ctz(v) * clz(v));
  }
  showu("rotl(x,0)", rotl(0x12345678u, 0));
  showu("rotl(x,32)", rotl(0x12345678u, 32));
  s1 ^= s2; s2 ^= s1; s1 ^= s2;
  show("xor swap s1", (int)s1);
  show("xor swap s2", (int)s2);
  showu("hash", h);
  return (int)((h >> 3) & 0xff);
}
