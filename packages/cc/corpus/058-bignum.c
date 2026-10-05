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

#define MAXD 200

/* little-endian decimal digit arrays */
typedef struct { int len; unsigned char d[MAXD]; } big;

static void big_set(big *b, unsigned v) {
  b->len = 0;
  do { b->d[b->len++] = (unsigned char)(v % 10u); v /= 10u; } while (v);
}
static void big_mul_small(big *b, unsigned m) {
  unsigned carry = 0;
  int i;
  for (i = 0; i < b->len; i++) {
    unsigned t = (unsigned)b->d[i] * m + carry;
    b->d[i] = (unsigned char)(t % 10u);
    carry = t / 10u;
  }
  while (carry && b->len < MAXD) { b->d[b->len++] = (unsigned char)(carry % 10u); carry /= 10u; }
}
static void big_add(big *r, const big *a, const big *b) {
  int i, n = a->len > b->len ? a->len : b->len;
  unsigned carry = 0;
  for (i = 0; i < n; i++) {
    unsigned t = carry;
    if (i < a->len) t += a->d[i];
    if (i < b->len) t += b->d[i];
    r->d[i] = (unsigned char)(t % 10u);
    carry = t / 10u;
  }
  r->len = n;
  if (carry) r->d[r->len++] = (unsigned char)carry;
}
static void big_print(const char *label, const big *b) {
  int i;
  puts_(label); puts_(" = ");
  for (i = b->len - 1; i >= 0; i--) putch('0' + b->d[i]);
  puts_(" ("); puti(b->len); puts_(" digits)"); nl();
}
static unsigned digit_sum(const big *b) {
  unsigned s = 0;
  int i;
  for (i = 0; i < b->len; i++) s += b->d[i];
  return s;
}

int main(void) {
  static big a, b, c;
  big *x = &a, *y = &b, *z = &c, *tmp;
  int i;
  unsigned s = 0;
  big_set(&a, 1u);
  for (i = 0; i < 100; i++) big_mul_small(&a, 2u);
  big_print("2^100", &a);
  s += digit_sum(&a);
  big_set(&a, 1u);
  for (i = 2; i <= 30; i++) big_mul_small(&a, (unsigned)i);
  big_print("30!", &a);
  s += digit_sum(&a);
  big_set(&a, 1u);
  for (i = 2; i <= 50; i++) big_mul_small(&a, (unsigned)i);
  big_print("50!", &a);
  s += digit_sum(&a);
  /* fib(200) by repeated addition */
  big_set(x, 0u);
  big_set(y, 1u);
  for (i = 0; i < 200; i++) {
    big_add(z, x, y);
    tmp = x; x = y; y = z; z = tmp;
  }
  big_print("fib(200)", x);
  s += digit_sum(x);
  big_set(&a, 4294967295u);
  big_mul_small(&a, 4294967u);
  big_print("4294967295*4294967", &a);
  showu("digit sums", s);
  return (int)(s & 0xff);
}
