#include "prelude.h"
static int f2(int a, int b) { return a * 3 + b; }
static int f10(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j) {
  return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10;
}
int main(void) {
  int a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8;
  int r = ((a + b) * (c + d) - (e + f) * (g + h)) * (((a * b) + (c * d)) - ((e * f) + (g * h))) +
          (a + (b + (c + (d + (e + (f + (g + (h + (a + (b + (c + (d + (e + (f + (g + h)))))))))))))));
  show("deep expr", r);
  r = f10(f2(a, b), f2(c, d), f10(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), f2(f2(e, f), f2(g, h)), a, b, c, d,
          f10(a, b, c, d, e, f, g, h, f2(1, 1), f2(2, 2)), f2(3, 3));
  show("nested calls", r);
  r = f2(a, b) + f2(c, d) * f2(e, f) - f2(g, h) / f2(1, 0) + (f2(2, 3) ? f2(4, 5) : f2(6, 7));
  show("call expr", r);
  return r & 0xff;
}
