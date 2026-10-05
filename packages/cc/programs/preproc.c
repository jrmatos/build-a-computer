#include "prelude.h"
#define SQ(x) ((x) * (x))
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define STR(x) #x
#define XSTR(x) STR(x)
#define CAT(a, b) a##b
#define XCAT(a, b) CAT(a, b)
#define VERSION 3
#define LOG(fmt, ...) log_(fmt, ##__VA_ARGS__)
#define COUNT(...) count_(0, ##__VA_ARGS__, -1)
#define EMPTY
#define F(x) G(x)
#define G(x) x * 2
#define NEG -
#if VERSION >= 3 && defined(VERSION) && !defined(NOPE)
#define OK 1
#elif VERSION == 2
#define OK 2
#else
#define OK 3
#endif
#ifdef NOPE
#error not reached
#endif
#if (1 << 4) == 16 && 0x10 == 020 && 'A' == 65 && (-1 < 0) && (5 / 2 == 2) && (7 % 3 == 1) && (~0 == -1)
#define ARITH 1
#else
#define ARITH 0
#endif
#if !defined NOPE2 || NOPE2
#define DEF2 1
#endif
#undef VERSION
#ifndef VERSION
#define VERSION 4
#endif
static int log_(const char *f, ...) { puts_(f); nl(); return 1; }
static int count_(int z, ...) { return z; }
static int CAT(fu, nc)(void) { return 42; }
int main(void) {
  int selfv = 1;
#define selfv (selfv + 10)
  int xy = 5;
  show("SQ", SQ(3 + 1));
  show("MAX", MAX(4, 9));
  puts_(STR(hello world)); nl();
  puts_(XSTR(VERSION)); nl();
  puts_(STR("quoted\n" 'c')); nl();
  show("CAT", CAT(x, y));
  show("XCAT", XCAT(fu, nc)());
  LOG("no args");
  LOG("args %d", 1, 2);
  show("COUNT", COUNT());
  show("SELF", selfv);
  show("F", F(3 + 1));
  show("NEG", NEG NEG 5);
  show("OK", OK);
  show("ARITH", ARITH);
  show("DEF2", DEF2);
  show("VERSION", VERSION);
  show("LINE", __LINE__);
  puts_(__FILE__); nl();
  EMPTY show("EMPTY", 1 EMPTY);
#define LOCAL 77
  show("LOCAL", LOCAL);
#undef LOCAL
#define MULTI(a) \
  (a + \
   1)
  show("MULTI", MULTI(1));
  return 0;
}
