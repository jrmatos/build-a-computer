/* 003-div-mod-neg: truncating division and modulo for all sign combinations, INT_MIN edges */
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

#define INT_MAX_ 2147483647
#define INT_MIN_ (-2147483647 - 1)

static int nums[6] = {7, -7, 13, -13, 1, -1};
static int dens[6] = {3, -3, 2, -2, 5, -5};
static volatile int vmin = INT_MIN_;
static volatile int vmax = INT_MAX_;

int main(void) {
  int i, j, bad = 0;
  unsigned h = 5381;
  int m, x;
  for (i = 0; i < 6; i++) {
    for (j = 0; j < 6; j++) {
      int a = nums[i], b = dens[j];
      int q = a / b, r = a % b;
      puti(a); puts_(" / "); puti(b); puts_(" = "); puti(q);
      puts_(" rem "); puti(r); nl();
      if (q * b + r != a) bad++;
      h = h * 33u + (unsigned)q * 7u + (unsigned)r;
    }
  }
  m = vmin;
  show("INT_MIN/1", m / 1);
  show("INT_MIN%1", m % 1);
  show("INT_MIN/2", m / 2);
  show("INT_MIN/-2", m / -2);
  show("INT_MIN%3", m % 3);
  show("INT_MIN%-3", m % -3);
  show("INT_MIN/-3", m / -3);
  show("INT_MIN/7", m / 7);
  show("INT_MIN%7", m % 7);
  show("INT_MIN/INT_MIN", m / m);
  show("INT_MIN%INT_MIN", m % m);
  show("INT_MIN/INT_MAX", m / vmax);
  show("INT_MIN%INT_MAX", m % vmax);
  x = vmax;
  show("INT_MAX/-1", x / -1);
  show("INT_MAX%-1", x % -1);
  show("INT_MAX/INT_MIN", x / m);
  show("INT_MAX%INT_MIN", x % m);
  show("INT_MAX%-10", x % -10);
  show("-INT_MAX/10", -x / 10);
  show("-INT_MAX%10", -x % 10);
  show("0/-5", 0 / dens[5]);
  show("0%-5", 0 % dens[5]);
  show("-1/2", nums[5] / dens[2]);
  show("-1%2", nums[5] % dens[2]);
  show("bad", bad);
  showu("hash", h);
  return (int)((h ^ (h >> 8)) & 0xff);
}
