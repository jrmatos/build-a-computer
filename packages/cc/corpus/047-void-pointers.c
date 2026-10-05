/* 047-void-pointers: generic swap via unsigned char*, void* round trips, generic insertion sort with compare callback */
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

struct item { short weight; char code; int score; };

static void gswap(void *a, void *b, unsigned size) {
  unsigned char *x = (unsigned char *)a, *y = (unsigned char *)b, t;
  while (size--) { t = *x; *x++ = *y; *y++ = t; }
}

static void isort(void *base, int n, unsigned size, int (*cmp)(const void *, const void *)) {
  unsigned char *b = (unsigned char *)base;
  int i, j;
  for (i = 1; i < n; i++)
    for (j = i; j > 0 && cmp(b + (unsigned)(j - 1) * size, b + (unsigned)j * size) > 0; j--)
      gswap(b + (unsigned)(j - 1) * size, b + (unsigned)j * size, size);
}

static int cmp_int(const void *a, const void *b) {
  int x = *(const int *)a, y = *(const int *)b;
  return (x > y) - (x < y);
}
static int cmp_uchar_desc(const void *a, const void *b) {
  return (int)*(const unsigned char *)b - (int)*(const unsigned char *)a;
}
static int cmp_item(const void *a, const void *b) {
  const struct item *p = (const struct item *)a, *q = (const struct item *)b;
  if (p->score != q->score) return p->score < q->score ? -1 : 1;
  return p->code - q->code;
}

static void *identity(void *p) { return p; }
static unsigned bytesum(const void *p, unsigned n) {
  const unsigned char *c = (const unsigned char *)p;
  unsigned s = 0;
  while (n--) s = s * 3u + *c++;
  return s;
}

int main(void) {
  int nums[9] = { 42, -7, 19, 0, 88, -42, 5, 19, 3 };
  unsigned char bytes[7] = { 9, 200, 3, 77, 255, 0, 128 };
  struct item items[5];
  int i, x = 1234, y = -99;
  void *vp;
  int *ip;
  unsigned chk = 0;

  gswap(&x, &y, sizeof x);
  show("x", x); show("y", y);
  vp = &x;
  ip = (int *)vp;
  *ip += 1;
  show("x via void*", x);
  show("roundtrip eq", (int *)identity(vp) == &x);
  show("char diff", (int)((char *)identity(&nums[5]) - (char *)nums));
  showu("bytesum x", bytesum(&x, sizeof x));

  isort(nums, 9, sizeof nums[0], cmp_int);
  for (i = 0; i < 9; i++) { puti(nums[i]); putch(' '); chk = chk * 7u + (unsigned)nums[i]; }
  nl();
  isort(bytes, 7, 1, cmp_uchar_desc);
  for (i = 0; i < 7; i++) { putu(bytes[i]); putch(' '); chk = chk * 7u + bytes[i]; }
  nl();

  for (i = 0; i < 5; i++) {
    items[i].weight = (short)(100 - i * 13);
    items[i].code = (char)('e' - i);
    items[i].score = (i * 3) % 4;
  }
  isort(items, 5, sizeof items[0], cmp_item);
  for (i = 0; i < 5; i++) {
    putch(items[i].code); putch(':'); puti(items[i].score); putch(':'); puti(items[i].weight); putch(' ');
    chk = chk * 7u + (unsigned)items[i].weight;
  }
  nl();
  gswap(&items[0], &items[4], sizeof(struct item));
  putch(items[0].code); putch(items[4].code); nl();
  gswap(nums, nums + 5, 4 * sizeof(int));
  for (i = 0; i < 9; i++) { puti(nums[i]); putch(' '); }
  nl();
  showu("chk", chk);
  return (int)(chk & 0xff);
}
