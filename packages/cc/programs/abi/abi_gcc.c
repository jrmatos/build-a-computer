#include "abi.h"
struct c3 g_c3(struct c3 x, int k) { x.a += k; x.c -= k; return x; }
struct i2 g_i2(int a, struct i2 x, int b) { struct i2 r = { x.a * a, x.b * b }; return r; }
struct i3 g_i3(struct i3 x) { struct i3 r = { x.c, x.b, x.a }; return r; }
struct big g_big(struct big x, int k) { int i; for (i = 0; i < 10; i++) x.v[i] += k * i; return x; }
long long g_ll(int a, long long b, int c, long long d, int e, long long f, int g, long long h) { return a + b * 3 + c + d * 5 + e + f * 7 + g + h * 11; }
int g_many(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j, struct i2 s) { return a + 2*b + 3*c + 4*d + 5*e + 6*f + 7*g + 8*h + 9*i + 10*j + s.a * 100 + s.b * 1000; }
int g_sum(int n, ...) { va_list ap; int s = 0; va_start(ap, n); while (n--) s += va_arg(ap, int); va_end(ap); return s; }
long long g_sumll(int n, ...) { va_list ap; long long s = 0; va_start(ap, n); while (n--) s += va_arg(ap, long long); va_end(ap); return s; }
int g_call(cb_t f, int x) { struct i2 s = { x, x + 1 }; return f(x * 2, s) + 1; }
struct mixed g_mixed(struct mixed m) { m.c++; m.x <<= 1; return m; }
unsigned char g_uchar(unsigned char a, signed char b, short c, unsigned short d) { return (unsigned char)(a + b + c + d); }
/* the other direction: gcc code calling our functions */
int g_back(void) {
  struct c3 a = { 1, 2, 3 };
  struct i2 b = { 4, 5 };
  struct big c;
  struct mixed m = { 'x', 0x123456789LL };
  int i, r = 0;
  for (i = 0; i < 10; i++) c.v[i] = i;
  a = o_c3(a, 2); r += a.a + a.b + a.c;
  b = o_i2(3, b, 4); r += b.a + b.b;
  c = o_big(c, 2); r += c.v[9];
  r += (int)(o_ll(1, 2, 3, 4, 5, 6, 7, 8) & 0xffff);
  r += o_many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, b);
  r += o_sum(5, 1, 2, 3, 4, 5);
  m = o_mixed(m); r += m.c + (int)(m.x >> 4);
  return r;
}
