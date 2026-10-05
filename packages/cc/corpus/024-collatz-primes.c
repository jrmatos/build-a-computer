/* 024-collatz-primes: sieve of Eratosthenes up to 1000 and longest Collatz chain below 1000 */
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

#define N 1000

static char composite[N + 1];

static int collatz_steps(unsigned n, unsigned *peak) {
  int steps = 0;
  *peak = n;
  while (n != 1u) {
    if (n & 1u) n = 3u * n + 1u;
    else n >>= 1;
    if (n > *peak) *peak = n;
    steps++;
  }
  return steps;
}

int main(void) {
  int i, j, count = 0, last = 0, best_n = 1, best = 0, twins = 0;
  unsigned sum = 0, peak, best_peak = 0, peak_n = 1, total = 0;
  composite[0] = composite[1] = 1;
  for (i = 2; i * i <= N; i++)
    if (!composite[i])
      for (j = i * i; j <= N; j += i) composite[j] = 1;
  for (i = 2; i <= N; i++) {
    if (!composite[i]) {
      count++;
      sum += (unsigned)i;
      if (i - last == 2) twins++;
      last = i;
      if (count % 25 == 0) { puts_("prime #"); puti(count); puts_(" = "); puti(i); nl(); }
    }
  }
  show("prime count", count);
  showu("prime sum", sum);
  show("largest prime", last);
  show("twin pairs", twins);
  for (i = 1; i < N; i++) {
    int st = collatz_steps((unsigned)i, &peak);
    total += (unsigned)st;
    if (st > best) { best = st; best_n = i; }
    if (peak > best_peak) { best_peak = peak; peak_n = (unsigned)i; }
    if (i % 100 == 0) { puts_("collatz("); puti(i); puts_(") = "); puti(st); nl(); }
  }
  show("collatz best n", best_n);
  show("collatz best steps", best);
  showu("collatz highest peak", best_peak);
  showu("peak start", peak_n);
  showu("total steps", total);
  return (count + best) & 0xff;
}
