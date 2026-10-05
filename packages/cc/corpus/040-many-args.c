/* 040-many-args: functions with 8, 9, 10, 12 args (stack-passed args), mixing chars and structs */
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

struct sm { int a, b; };
struct lg { int v[5]; };

static int f8(int a, int b, int c, int d, int e, int f, int g, int h) {
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h;
}
static int f9(int a, int b, int c, int d, int e, int f, int g, int h, int i) {
  return f8(a, b, c, d, e, f, g, h) * 10 + i;
}
static int f10(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j) {
  return (a - b) * (c - d) + (e - f) * (g - h) + i * j;
}
static unsigned f12(unsigned a, unsigned b, unsigned c, unsigned d, unsigned e, unsigned f,
                    unsigned g, unsigned h, unsigned i, unsigned j, unsigned k, unsigned l) {
  return ((((((((((a * 3u + b) * 3u + c) * 3u + d) * 3u + e) * 3u + f) * 3u + g) * 3u + h) * 3u + i) * 3u + j) * 3u + k) * 3u + l;
}
static int chars(char a, signed char b, unsigned char c, int d, char e, short f, unsigned short g,
                 signed char h, int i, char j) {
  return a + b + c + d + e + f + g + h + i + j;
}
static int mixs(int x, struct sm s, char c, struct lg l, int y, int z, struct sm t, int w, int v) {
  int r = x + s.a * s.b + c + y + z + t.a - t.b + w * v;
  int k;
  for (k = 0; k < 5; k++) r += l.v[k] * (k + 1);
  l.v[0] = 999; s.a = 0;
  return r;
}
static int last_arg(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j, int k, int l) {
  (void)a; (void)b; (void)c; (void)d; (void)e; (void)f; (void)g; (void)h;
  return i * 1000 + j * 100 + k * 10 + l;
}
static int fwd(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j) {
  return f10(j, i, h, g, f, e, d, c, b, a) + f9(a, b, c, d, e, f, g, h, i + j);
}

int main(void) {
  struct sm s1, s2;
  struct lg big;
  int k, r;
  unsigned chk = 0;

  s1.a = 3; s1.b = -4; s2.a = 50; s2.b = 7;
  for (k = 0; k < 5; k++) big.v[k] = k * k - 2;

  r = f8(1, 2, 3, 4, 5, 6, 7, 8); show("f8", r); chk = chk * 31u + (unsigned)r;
  r = f8(-1, -2, -3, -4, -5, -6, -7, -8); show("f8 neg", r); chk = chk * 31u + (unsigned)r;
  r = f9(1, 1, 1, 1, 1, 1, 1, 1, 9); show("f9", r); chk = chk * 31u + (unsigned)r;
  r = f10(10, 3, 8, 2, 7, 1, 6, 0, 5, -4); show("f10", r); chk = chk * 31u + (unsigned)r;
  chk = chk * 31u + f12(1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0);
  showu("f12", f12(1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0));
  showu("f12 big", f12(0xffffffffu, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11));
  r = chars('A', -5, 250, 1000, 'z', -300, 60000, -128, 7, '\x80'); show("chars", r); chk = chk * 31u + (unsigned)r;
  r = mixs(1, s1, 'c', big, 20, 30, s2, -6, 9); show("mixs", r); chk = chk * 31u + (unsigned)r;
  show("big.v[0] unchanged", big.v[0]);
  show("s1.a unchanged", s1.a);
  r = last_arg(0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 2, 1); show("last_arg", r); chk = chk * 31u + (unsigned)r;
  r = fwd(1, 2, 3, 4, 5, 6, 7, 8, 9, 10); show("fwd", r); chk = chk * 31u + (unsigned)r;
  r = f9(f8(1, 0, 0, 0, 0, 0, 0, 1), 2, 3, 4, 5, 6, 7, 8, f10(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  show("nested", r); chk = chk * 31u + (unsigned)r;
  showu("chk", chk);
  return (int)(chk & 0xff);
}
