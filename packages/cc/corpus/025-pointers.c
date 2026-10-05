/* 025-pointers: address-of, deref, pointer to pointer, swap via pointers, pointer comparison */
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

static int g = 42;
static int *gp = &g;

static void swap(int *a, int *b) { int t = *a; *a = *b; *b = t; }

static void set_via_pp(int **pp, int *target) { *pp = target; }

static void bump(int *p, int n) { while (n-- > 0) (*p)++; }

static int count_less(int *base, int n, int *mark) {
  int c = 0, i;
  for (i = 0; i < n; i++)
    if (base + i < mark) c++;
  return c;
}

int main(void) {
  int a = 5, b = 9;
  int *p = &a;
  int **pp = &p;
  int arr[6];
  int *lo, *hi, *q;
  int i, sum = 0;

  show("a", a);
  show("*p", *p);
  show("**pp", **pp);
  *p = 11;
  show("a after *p=11", a);
  **pp = 13;
  show("a after **pp=13", a);
  set_via_pp(pp, &b);
  show("*p now b", *p);
  show("p==&b", p == &b);
  show("p!=&a", p != &a);

  swap(&a, &b);
  show("swap a", a);
  show("swap b", b);

  bump(&a, 7);
  show("bump a", a);

  show("*gp", *gp);
  *gp += 8;
  show("g", g);

  for (i = 0; i < 6; i++) arr[i] = i * i + 1;
  lo = &arr[1];
  hi = &arr[4];
  show("lo<hi", lo < hi);
  show("hi>lo", hi > lo);
  show("&arr[1]<=lo", &arr[1] <= lo);
  show("hi>=lo", hi >= lo);
  show("hi<lo", hi < lo);
  show("count_less(arr,6,&arr[3])", count_less(arr, 6, &arr[3]));
  for (q = lo; q <= hi; q++) sum += *q;
  show("sum arr[1..4]", sum);
  swap(lo, hi);
  for (i = 0; i < 6; i++) { puti(arr[i]); putch(' '); }
  nl();

  /* pointer to pointer walking */
  {
    int *ptrs[3];
    int **w;
    int t = 0;
    ptrs[0] = &arr[0]; ptrs[1] = &arr[2]; ptrs[2] = &arr[5];
    for (w = ptrs; w < ptrs + 3; w++) t += **w;
    show("sum via int**", t);
    **(ptrs + 1) = 100;
    show("arr[2]", arr[2]);
    show("ptrs[2]-ptrs[0]", (int)(ptrs[2] - ptrs[0]));
  }

  return (a + b + sum + g) & 0xff;
}
