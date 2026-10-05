/* 038-goto: forward/backward goto, breaking out of nested loops, goto-based state machine */
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

static int find_pair(int target, int *oi, int *oj) {
  int i, j;
  for (i = 0; i < 20; i++)
    for (j = i; j < 20; j++)
      if (i * j == target) goto found;
  return 0;
found:
  *oi = i; *oj = j;
  return 1;
}

static int count_down(int n) {
  int steps = 0;
again:
  if (n <= 0) goto done;
  n -= 3;
  steps++;
  goto again;
done:
  return steps * 100 + n;
}

/* state machine: parse signed decimal numbers separated by commas, sum them */
static int parse_sum(const char *s, int *count) {
  int total = 0, cur = 0, sign = 1;
  *count = 0;
start:
  if (*s == 0) goto end;
  if (*s == '-') { sign = -1; s++; goto digits; }
  if (*s >= '0' && *s <= '9') goto digits;
  s++;
  goto start;
digits:
  if (*s >= '0' && *s <= '9') { cur = cur * 10 + (*s - '0'); s++; goto digits; }
  total += sign * cur;
  (*count)++;
  cur = 0; sign = 1;
  goto start;
end:
  return total;
}

static int cleanup_style(int x) {
  int r = 0;
  if (x < 0) goto fail1;
  r += 1;
  if (x > 100) goto fail2;
  r += 10;
  if (x % 2) goto fail3;
  return r + 1000;
fail3:
  r += 300;
fail2:
  r += 20000;
fail1:
  r += 500000;
  return r;
}

int main(void) {
  int i = -1, j = -1, n, r;
  unsigned chk = 0;

  r = find_pair(91, &i, &j);
  show("find 91", r); show("i", i); show("j", j);
  r = find_pair(323, &i, &j);
  show("find 323", r); show("i", i); show("j", j);
  r = find_pair(397, &i, &j);
  show("find 397", r);

  show("count_down(10)", count_down(10));
  show("count_down(0)", count_down(0));
  show("count_down(31)", count_down(31));

  r = parse_sum("12,-7,,300 x 5,-40", &n);
  show("parse_sum", r); show("count", n);
  r = parse_sum("", &n);
  show("parse empty", r); show("count", n);

  show("cleanup(-1)", cleanup_style(-1));
  show("cleanup(150)", cleanup_style(150));
  show("cleanup(7)", cleanup_style(7));
  show("cleanup(8)", cleanup_style(8));

  /* backward goto loop building a checksum */
  i = 0;
loop:
  chk = chk * 33u + (unsigned)(i * i);
  if (++i < 25) goto loop;
  showu("chk", chk);
  return (int)(chk & 0xff);
}
