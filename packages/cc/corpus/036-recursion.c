/* 036-recursion: factorial, fibonacci, ackermann(2,3), gcd, hanoi move count, mutual recursion */
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

static unsigned fact(unsigned n) { return n <= 1 ? 1u : n * fact(n - 1); }
static int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
static int ack(int m, int n) {
  if (m == 0) return n + 1;
  if (n == 0) return ack(m - 1, 1);
  return ack(m - 1, ack(m, n - 1));
}
static int gcd(int a, int b) { return b == 0 ? a : gcd(b, a % b); }

static int moves;
static void hanoi(int n, int from, int to, int via) {
  if (n == 0) return;
  hanoi(n - 1, from, via, to);
  moves++;
  hanoi(n - 1, via, to, from);
}
static unsigned hanoi_count(int n) { return n == 0 ? 0u : 2u * hanoi_count(n - 1) + 1u; }

static int is_odd(unsigned n);
static int is_even(unsigned n) { return n == 0 ? 1 : is_odd(n - 1); }
static int is_odd(unsigned n) { return n == 0 ? 0 : is_even(n - 1); }

static int sum_digits(unsigned n) { return n < 10 ? (int)n : (int)(n % 10) + sum_digits(n / 10); }
static int binsearch(const int *a, int lo, int hi, int key) {
  int mid;
  if (lo > hi) return -1;
  mid = lo + (hi - lo) / 2;
  if (a[mid] == key) return mid;
  return a[mid] < key ? binsearch(a, mid + 1, hi, key) : binsearch(a, lo, mid - 1, key);
}
static unsigned power(unsigned b, unsigned e) {
  unsigned h;
  if (e == 0) return 1;
  h = power(b, e / 2);
  return (e & 1) ? h * h * b : h * h;
}

int main(void) {
  int sorted[10] = { 2, 3, 5, 7, 11, 13, 17, 19, 23, 29 };
  int i;
  unsigned chk = 0;

  for (i = 0; i <= 12; i += 3) { puts_("fact "); puti(i); puts_(" = "); putu(fact((unsigned)i)); nl(); }
  showu("fact 13 (wraps)", fact(13));
  for (i = 0; i <= 20; i += 5) { puts_("fib "); puti(i); puts_(" = "); puti(fib(i)); nl(); }
  show("ack(2,3)", ack(2, 3));
  show("ack(1,5)", ack(1, 5));
  show("ack(3,2)", ack(3, 2));
  show("gcd(1071,462)", gcd(1071, 462));
  show("gcd(17,5)", gcd(17, 5));
  show("gcd(-48,18)", gcd(-48, 18));
  moves = 0;
  hanoi(10, 1, 3, 2);
  show("hanoi(10) moves", moves);
  showu("hanoi_count(20)", hanoi_count(20));
  show("is_even(10)", is_even(10));
  show("is_odd(10)", is_odd(10));
  show("is_odd(77)", is_odd(77));
  show("sum_digits(987654321)", sum_digits(987654321u));
  for (i = 0; i < 4; i++) show("binsearch", binsearch(sorted, 0, 9, i * 9 + 2));
  showu("3^19", power(3, 19));
  showu("7^23 (wraps)", power(7, 23));
  chk = fact(10) + (unsigned)fib(20) + (unsigned)ack(2, 3) + (unsigned)moves + power(3, 19);
  showu("chk", chk);
  return (int)(chk & 0xff);
}
