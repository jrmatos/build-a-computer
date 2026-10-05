/* 045-pointer-to-array: int (*p)[3], arrays of pointers vs pointers to arrays, fn returning pointer */
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

static int m[4][3] = { { 1, 2, 3 }, { 4, 5, 6 }, { 7, 8, 9 }, { 10, 11, 12 } };
static int pool[8] = { 5, 10, 15, 20, 25, 30, 35, 40 };

static int *nth(int *base, int n) { return base + n; }
static int *biggest(int *a, int n) { int *b = a, i; for (i = 1; i < n; i++) if (a[i] > *b) b = &a[i]; return b; }
static int (*row_of(int r))[3] { return &m[r]; }

typedef int *(*picker)(int *, int);

static int row_total(int (*row)[3]) { return (*row)[0] + (*row)[1] + (*row)[2]; }

int main(void) {
  int (*p)[3] = m;
  int *ap[4];
  int (*whole)[4][3] = &m;
  int (*rp)[3];
  int *(*fp)(int *, int) = nth;
  picker pk = biggest;
  int i, s = 0;
  int *q;

  show("sizeof *p", (int)sizeof *p);
  show("sizeof p[0][0]", (int)sizeof p[0][0]);
  show("sizeof ap", (int)sizeof ap / (int)sizeof ap[0]);
  show("sizeof *whole", (int)sizeof *whole);
  show("p[2][1]", p[2][1]);
  show("(*(p+3))[2]", (*(p + 3))[2]);
  show("*(*(p+1)+2)", *(*(p + 1) + 2));
  p++;
  show("(*p)[0] after p++", (*p)[0]);
  show("p - m", (int)(p - m));
  show("bytes p - m", (int)((char *)p - (char *)m));
  show("(*whole)[3][0]", (*whole)[3][0]);

  for (i = 0; i < 4; i++) ap[i] = m[3 - i];
  show("ap[0][2]", ap[0][2]);
  show("ap[3][0]", ap[3][0]);
  ap[1] = &pool[6];
  show("ap[1][1]", ap[1][1]);
  show("ap[1]-pool", (int)(ap[1] - pool));

  for (rp = m; rp < m + 4; rp++) s += row_total(rp);
  show("sum rows", s);
  rp = row_of(2);
  show("row_of(2)[0][1]", (*rp)[1]);
  show("row_total(row_of(3))", row_total(row_of(3)));
  (*row_of(0))[0] = 100;
  show("m[0][0]", m[0][0]);

  q = fp(pool, 3);
  show("*nth(pool,3)", *q);
  show("nth-pool", (int)(q - pool));
  q = pk(pool, 8);
  show("*biggest", *q);
  show("biggest idx", (int)(q - pool));
  *pk(&m[0][0], 12) = -1;
  show("m[0][0] after biggest=-1", m[0][0]);
  q = pk(&m[0][0], 12);
  show("new biggest", *q);
  show("new biggest idx", (int)(q - &m[0][0]));
  *fp(pool, 7) += 2;
  show("pool[7]", pool[7]);
  return (s + *q + pool[7]) & 0xff;
}
