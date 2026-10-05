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

#define NBITS 200
#define NWORDS ((NBITS + 31) / 32)

static unsigned bits[NWORDS];

static void bset(int i) { bits[i >> 5] |= 1u << (i & 31); }
static void bclr(int i) { bits[i >> 5] &= ~(1u << (i & 31)); }
static int btest(int i) { return (int)((bits[i >> 5] >> (i & 31)) & 1u); }
static void bflip(int i) { bits[i >> 5] ^= 1u << (i & 31); }

static int popcount(unsigned x) {
  int c = 0;
  while (x) { x &= x - 1u; c++; }
  return c;
}
static int count_range(int lo, int hi) {
  int i, c = 0;
  for (i = lo; i < hi; i++) c += btest(i);
  return c;
}
static unsigned gray(unsigned x) { return x ^ (x >> 1); }
static unsigned gray_inv(unsigned g) {
  unsigned x = g;
  int s;
  for (s = 1; s < 32; s <<= 1) x ^= x >> s;
  return x;
}
static int parity(unsigned x) {
  x ^= x >> 16; x ^= x >> 8; x ^= x >> 4; x ^= x >> 2; x ^= x >> 1;
  return (int)(x & 1u);
}
static unsigned rev_bits(unsigned x, int n) {
  unsigned r = 0;
  int i;
  for (i = 0; i < n; i++) { r = (r << 1) | (x & 1u); x >>= 1; }
  return r;
}
static unsigned rev32(unsigned x) {
  x = ((x >> 1) & 0x55555555u) | ((x & 0x55555555u) << 1);
  x = ((x >> 2) & 0x33333333u) | ((x & 0x33333333u) << 2);
  x = ((x >> 4) & 0x0f0f0f0fu) | ((x & 0x0f0f0f0fu) << 4);
  x = ((x >> 8) & 0x00ff00ffu) | ((x & 0x00ff00ffu) << 8);
  return (x >> 16) | (x << 16);
}
static int ctz(unsigned x) { int n = 0; if (!x) return 32; while (!(x & 1u)) { x >>= 1; n++; } return n; }
static int clz(unsigned x) { int n = 0; if (!x) return 32; while (!(x & 0x80000000u)) { x <<= 1; n++; } return n; }
static unsigned rotl(unsigned x, int r) { r &= 31; return r ? (x << r) | (x >> (32 - r)) : x; }

int main(void) {
  int i;
  unsigned h = 0;
  int perm[16];
  for (i = 0; i < NBITS; i += 3) bset(i);
  for (i = 0; i < NBITS; i += 5) bclr(i);
  for (i = 0; i < NBITS; i += 7) bflip(i);
  for (i = 0; i < NWORDS; i++) { putx(bits[i]); putch(i == NWORDS - 1 ? '\n' : ' '); }
  show("count all", count_range(0, NBITS));
  show("count 10..90", count_range(10, 90));
  show("count 150..200", count_range(150, NBITS));
  {
    int c = 0;
    for (i = 0; i < NWORDS; i++) c += popcount(bits[i]);
    show("popcount sum", c);
  }
  puts_("gray:");
  for (i = 0; i < 16; i++) { putch(' '); putu(gray((unsigned)i)); }
  nl();
  for (i = 0; i < 1000; i += 37) h += gray_inv(gray((unsigned)i * 2654435761u)) == (unsigned)i * 2654435761u;
  show("gray roundtrip", (int)h);
  puts_("parity:");
  for (i = 0; i < 16; i++) putch((char)('0' + parity((unsigned)i * 0x01010101u + 3u)));
  nl();
  puts_("bitrev16:");
  for (i = 0; i < 16; i++) { perm[i] = (int)rev_bits((unsigned)i, 4); putch(' '); puti(perm[i]); }
  nl();
  {
    int ok = 1;
    for (i = 0; i < 16; i++) if (perm[perm[i]] != i) ok = 0;
    show("involution", ok);
  }
  showu("rev32(1)", rev32(1u));
  showu("rev32(0x12345678)", rev32(0x12345678u));
  show("ctz(0x80)", ctz(0x80u));
  show("clz(0x80)", clz(0x80u));
  show("ctz(0)", ctz(0u));
  showu("rotl", rotl(0x80000001u, 4));
  showu("rotl0", rotl(0xdeadbeefu, 32));
  showu("lowest set", 0x5a0u & (0u - 0x5a0u));
  for (i = 0; i < NWORDS; i++) h = rotl(h, 5) ^ bits[i];
  showu("h", h);
  return (int)(h & 0xff);
}
