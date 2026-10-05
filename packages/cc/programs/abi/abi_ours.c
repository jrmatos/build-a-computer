#include "abi.h"
#define UART ((volatile unsigned char *)0x10000000)
static void puts_(const char *s) { while (*s) *UART = *s++; }
static void puti(long long v) { char b[24]; int i = 0; unsigned long long u = v < 0 ? -(unsigned long long)v : v; if (v < 0) *UART = '-'; do { b[i++] = '0' + u % 10; u /= 10; } while (u); while (i) *UART = b[--i]; }
static void show(const char *l, long long v) { puts_(l); puts_(" = "); puti(v); puts_("\n"); }
struct c3 o_c3(struct c3 x, int k) { x.a += k; x.c -= k; return x; }
struct i2 o_i2(int a, struct i2 x, int b) { struct i2 r = { x.a * a, x.b * b }; return r; }
struct big o_big(struct big x, int k) { int i; for (i = 0; i < 10; i++) x.v[i] += k * i; return x; }
long long o_ll(int a, long long b, int c, long long d, int e, long long f, int g, long long h) { return a + b * 3 + c + d * 5 + e + f * 7 + g + h * 11; }
int o_many(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j, struct i2 s) { return a + 2*b + 3*c + 4*d + 5*e + 6*f + 7*g + 8*h + 9*i + 10*j + s.a * 100 + s.b * 1000; }
int o_sum(int n, ...) { va_list ap; int s = 0; va_start(ap, n); while (n--) s += va_arg(ap, int); va_end(ap); return s; }
struct mixed o_mixed(struct mixed m) { m.c++; m.x <<= 1; return m; }
static int cb(int x, struct i2 s) { return x + s.a * 10 + s.b * 100; }
int main(void) {
  struct c3 a = { 10, 20, 30 };
  struct i2 b = { 6, 7 };
  struct i3 c = { 1, 2, 3 };
  struct big d;
  struct mixed m = { 'a', -5 };
  int i;
  for (i = 0; i < 10; i++) d.v[i] = 100 + i;
  a = g_c3(a, 5); show("c3", a.a * 10000 + a.b * 100 + a.c);
  b = g_i2(2, b, 3); show("i2", b.a * 100 + b.b);
  c = g_i3(c); show("i3", c.a * 100 + c.b * 10 + c.c);
  d = g_big(d, 3); show("big", d.v[0] + d.v[9]);
  show("ll", g_ll(1, 0x100000000LL, 3, -4, 5, 6, 7, 8));
  show("many", g_many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, b));
  show("sum", g_sum(6, 1, 2, 3, 4, 5, 6));
  show("sumll", g_sumll(3, 1LL << 40, 2LL, -3LL));
  show("call", g_call(cb, 4));
  m = g_mixed(m); show("mixed", m.c * 1000 + m.x);
  show("uchar", g_uchar(250, -3, 1000, 65535));
  show("back", g_back());
  return 0;
}
