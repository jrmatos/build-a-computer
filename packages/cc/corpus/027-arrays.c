/* 027-arrays: 1-D arrays, sum/min/max, arrays passed to functions, char arrays */
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

static int data[12] = { 34, -7, 19, 0, 88, -42, 5, 61, 13, -1, 27, 9 };
static int zeros[5];

static int sum(const int *a, int n) { int s = 0, i; for (i = 0; i < n; i++) s += a[i]; return s; }
static int amin(int a[], int n) { int m = a[0], i; for (i = 1; i < n; i++) if (a[i] < m) m = a[i]; return m; }
static int amax(int a[], int n) { int m = a[0], i; for (i = 1; i < n; i++) if (a[i] > m) m = a[i]; return m; }
static void reverse(int *a, int n) {
  int i, t;
  for (i = 0; i < n / 2; i++) { t = a[i]; a[i] = a[n - 1 - i]; a[n - 1 - i] = t; }
}
static void scale(int a[], int n, int k) { int i; for (i = 0; i < n; i++) a[i] *= k; }
static int slen(const char s[]) { int n = 0; while (s[n]) n++; return n; }
static void upcase(char *s) { for (; *s; s++) if (*s >= 'a' && *s <= 'z') *s = (char)(*s - 32); }

int main(void) {
  int local[8];
  char word[16];
  char copy[16];
  int i, s;
  unsigned h = 5381;

  show("sum", sum(data, 12));
  show("min", amin(data, 12));
  show("max", amax(data, 12));
  show("sum first 4", sum(data, 4));
  show("sizeof data", (int)sizeof data);
  show("count", (int)(sizeof data / sizeof data[0]));
  show("zeros sum", sum(zeros, 5));

  for (i = 0; i < 8; i++) local[i] = (i + 1) * (i % 3 == 0 ? -2 : 3);
  for (i = 0; i < 8; i++) { puti(local[i]); putch(' '); }
  nl();
  reverse(local, 8);
  for (i = 0; i < 8; i++) { puti(local[i]); putch(' '); }
  nl();
  scale(local + 2, 4, 5);
  for (i = 0; i < 8; i++) { puti(local[i]); putch(' '); }
  nl();
  show("local min", amin(local, 8));
  show("local max", amax(local, 8));
  reverse(data + 3, 5);
  for (i = 0; i < 12; i++) { puti(data[i]); putch(','); }
  nl();

  word[0] = 'h'; word[1] = 'e'; word[2] = 'l'; word[3] = 'l'; word[4] = 'o';
  word[5] = '-'; word[6] = 'a'; word[7] = 'r'; word[8] = 'r'; word[9] = 0;
  show("slen", slen(word));
  for (i = 0; i <= slen(word); i++) copy[i] = word[i];
  upcase(copy);
  puts_(word); putch(' '); puts_(copy); nl();
  for (i = 0; copy[i]; i++) h = h * 33u + (unsigned char)copy[i];
  showu("hash", h);
  {
    char digits[11];
    for (i = 0; i < 10; i++) digits[i] = (char)('9' - i);
    digits[10] = 0;
    puts_(digits); nl();
    show("digits[3]-'0'", digits[3] - '0');
  }
  s = sum(data, 12) + amax(local, 8);
  show("final", s);
  return (int)((h ^ (unsigned)s) & 0xff);
}
