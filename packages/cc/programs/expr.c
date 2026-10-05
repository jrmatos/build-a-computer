#include "prelude.h"
static int calls;
static int f(int x) { calls++; return x; }
int main(void) {
  signed char sc = -128, sc2 = 127;
  unsigned char uc = 255;
  short s = -32768;
  unsigned short us = 65535;
  int i = -7, j = 3;
  unsigned u = 7, v = 0x80000000u;
  int *p, arr[5] = { 1, 2, 3, 4, 5 };
  /* promotions and conversions */
  show("sc+1", sc + 1);
  show("uc+1", uc + 1);
  show("us*us", (int)(us * us));
  show("s-1", s - 1);
  show("-uc", -uc);
  show("~uc", ~uc);
  showu("u-8", u - 8);
  show("i/j", i / j); show("i%j", i % j); show("-i/j", -i / j); show("i/-j", i / -j); show("i%-j", i % -j);
  showu("u/j", u / j);
  showu("i/u (unsigned)", (unsigned)i / u);
  show("i<u", i < (int)u);
  show("i<u unsigned", (unsigned)i < u);
  show("v>>31", (int)(v >> 31));
  show("(int)v>>31", (int)v >> 31);
  show("i>>1", i >> 1);
  show("i<<3", i << 3);
  show("shift var", 1 << j);
  showu("u<<31", u << 31);
  /* char arithmetic wraps */
  sc2++; show("sc2++", sc2);
  uc += 2; show("uc+=2", uc);
  sc = (signed char)200; show("(sc)200", sc);
  us = (unsigned short)-1; show("us", us);
  s = (short)70000; show("s", s);
  uc = 10; uc -= 20; show("uc-=20", uc);
  uc = 100; uc *= 3; show("uc*=3", uc);
  sc = 100; sc *= 3; show("sc*=3", sc);
  sc = -100; sc /= 3; show("sc/=3", sc);
  us = 1000; us <<= 7; show("us<<=7", us);
  s = -1000; s >>= 3; show("s>>=3", s);
  /* logic */
  show("&&", (i && j) + (i && 0) * 2 + (0 || j) * 4 + (0 || 0) * 8);
  calls = 0; (void)(f(0) && f(1)); (void)(f(1) || f(2)); (void)(f(1) && f(2)); show("calls", calls);
  show("!", !i + !0 * 2 + !!j * 4);
  show("cmp chain", (1 < 2) + (2 < 1) * 2 + (3 == 3) * 4 + (3 != 3) * 8 + (i <= -7) * 16 + (i >= -6) * 32);
  /* ternary and comma */
  show("?:", i > 0 ? 1 : i < -5 ? 2 : 3);
  show("comma", (i = 4, j = 5, i * j));
  show("?: mixed", (int)(sizeof(1 ? sc : s)));
  showu("?: unsigned", 1 ? -1 : 0u);
  /* pointers */
  p = arr;
  show("*p++", *p++); show("*++p", *++p); show("(*p)++", (*p)++); show("arr[2]", arr[2]);
  show("p[-1]", p[-1]); show("2[arr]", 2[arr]);
  show("p-arr", (int)(p - arr));
  show("*(arr+4)", *(arr + 4));
  p += 2; show("p+=2", *p);
  p -= 3; show("p-=3", *p);
  show("ptr cmp", (p < &arr[4]) + (p == arr + 1) * 2 + (p != 0) * 4);
  /* assignment values */
  i = j = 9; show("chain", i + j);
  i = 10; i += i *= 2; show("i+=i*=2", i);
  show("sizeof", (int)(sizeof(int) + sizeof(char) * 10 + sizeof arr * 100 + sizeof(arr[0]) * 1000));
  show("sizeof no eval", (int)sizeof(f(5)) + calls);
  {
    unsigned int big = 4000000000u;
    int neg = -1;
    long l = -5;
    unsigned long ul = 5;
    show("big > neg?", big > (unsigned)neg);
    show("l < ul", l < (long)ul);
    showu("mul overflow", big * 3u);
    showu("unsigned neg", -big);
    show("char compare", (char)200 > 100);
  }
  return 0;
}
