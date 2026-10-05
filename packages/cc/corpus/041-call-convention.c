/* 041-call-convention: deep call chains, many live locals across calls (callee-saved regs), recursion with locals */
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

static int noise(int x) {
  /* clobber lots of temporaries */
  int a = x * 3, b = x ^ 0x55, c = x + 7, d = x - 9, e = x * x, f = x & 0xf0, g = x | 3;
  return (a + b + c + d + e + f + g) & 0xffff;
}

static int chain5(int x) { return noise(x) + 5; }
static int chain4(int x) { int y = x * 2; int r = chain5(y); return r + y; }
static int chain3(int x) { int y = x + 1; int r = chain4(y); return r - y; }
static int chain2(int x) { int y = x ^ 3; int r = chain3(y); return r * 2 + y; }
static int chain1(int x) { int y = x - 4; int r = chain2(y); return r + y + x; }

static int many_live(int seed) {
  int a = seed + 1, b = seed + 2, c = seed * 3, d = seed - 4, e = seed ^ 5, f = seed * 6;
  int g = seed + 7, h = seed - 8, i = seed * 9, j = seed + 10, k = seed - 11, l = seed * 12;
  int m = seed + 13, n = seed ^ 14;
  int t = noise(a);
  t += noise(b) + a;
  t += noise(c) + b;
  t += noise(d) + c + d + e;
  t += noise(e) + f + g + h;
  t += noise(f) + i + j + k + l + m + n;
  t += a * b - c * d + e * f - g * h + i * j - k * l + m * n;
  return t;
}

static int depth_sum(int n, int acc) {
  int l0 = n * 2, l1 = n + 100, l2 = acc ^ n, l3 = n * n;
  int arr[4];
  int r;
  arr[0] = l0; arr[1] = l1; arr[2] = l2; arr[3] = l3;
  if (n == 0) return acc;
  r = depth_sum(n - 1, acc + n);
  return r + arr[0] - l0 + arr[1] - l1 + arr[2] - l2 + arr[3] - l3 + (n & 1);
}

static unsigned tree(int depth, unsigned salt) {
  unsigned left, right, mine = salt * 2654435761u;
  if (depth == 0) return mine >> 7;
  left = tree(depth - 1, salt * 2u + 1u);
  right = tree(depth - 1, salt * 2u + 2u);
  return (left ^ (right << 1)) + mine;
}

static int ping(int n);
static int pong(int n) { int k = n * 3; return n <= 0 ? 0 : ping(n - 1) + k; }
static int ping(int n) { int k = n + 1; return n <= 0 ? 1 : pong(n - 2) * 2 + k; }

int main(void) {
  int i, r;
  unsigned chk = 0, t;
  int keep1 = 111, keep2 = 222, keep3 = 333, keep4 = 444, keep5 = 555, keep6 = 666;

  for (i = 0; i < 5; i++) {
    r = chain1(i * 17);
    show("chain1", r);
    chk = chk * 31u + (unsigned)r;
  }
  for (i = -2; i <= 2; i++) {
    r = many_live(i * 11);
    show("many_live", r);
    chk = chk * 31u + (unsigned)r;
  }
  r = depth_sum(200, 0);
  show("depth_sum(200)", r);
  chk = chk * 31u + (unsigned)r;
  t = tree(8, 1);
  showu("tree(8,1)", t);
  chk = chk * 31u + t;
  show("ping(20)", ping(20));
  show("pong(15)", pong(15));
  chk = chk * 31u + (unsigned)ping(20);
  show("keeps", keep1 + keep2 + keep3 + keep4 + keep5 + keep6);
  show("keep3*keep4", keep3 * keep4);
  showu("chk", chk);
  return (int)((chk ^ (unsigned)keep6) & 0xff);
}
