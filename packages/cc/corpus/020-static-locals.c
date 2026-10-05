/* 020-static-locals: static locals persist across calls, static arrays/pointers in functions, memoization */
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

static int counter(void) { static int n; return ++n; }
static int counter2(void) { static int n = 100; n += 10; return n; }

static unsigned next_rand(void) {
  static unsigned state = 12345u;
  state = state * 1103515245u + 12345u;
  return (state >> 16) & 0x7fffu;
}

static int fib(int n) {
  static int memo[40];
  static int hits = 0;
  if (n < 0) return hits;
  if (n < 2) return n;
  if (memo[n]) { hits++; return memo[n]; }
  memo[n] = fib(n - 1) + fib(n - 2);
  return memo[n];
}

static const char *cycle(void) {
  static const char *words[3] = {"alpha", "beta", "gamma"};
  static int idx = 2;
  idx = (idx + 1) % 3;
  return words[idx];
}

static int depth_max(int d) {
  static int deepest = 0;
  if (d > deepest) deepest = d;
  if (d < 6) depth_max(d + 2);
  return deepest;
}

static int *buffer_push(int v) {
  static int buf[8];
  static int *top = buf;
  if (top < buf + 8) *top++ = v;
  return buf;
}

int main(void) {
  int i, s = 0;
  int *b = 0;
  for (i = 0; i < 5; i++) s += counter();
  show("counter sum", s);
  show("counter now", counter());
  show("counter2 a", counter2());
  show("counter2 b", counter2());
  for (i = 0; i < 6; i++) { unsigned r = next_rand(); puts_("rand "); putu(r); nl(); s += (int)(r & 0xff); }
  show("fib(30)", fib(30));
  show("fib(25) again", fib(25));
  show("fib(35)", fib(35));
  show("memo hits", fib(-1));
  for (i = 0; i < 5; i++) { puts_(cycle()); nl(); }
  show("depth_max(1)", depth_max(1));
  show("depth_max(0)", depth_max(0));
  for (i = 0; i < 10; i++) b = buffer_push(i * i);
  for (i = 0; i < 8; i++) { s += b[i]; puti(b[i]); putch(' '); }
  nl();
  show("s", s);
  return (s + counter()) & 0xff;
}
