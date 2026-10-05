/* 035-function-pointers: arrays of fn ptrs, callbacks, returning fn ptrs via typedef, struct members */
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

typedef int (*binop)(int, int);
typedef void (*visitor)(int *, int);

static int add(int a, int b) { return a + b; }
static int sub(int a, int b) { return a - b; }
static int mul(int a, int b) { return a * b; }
static int maxi(int a, int b) { return a > b ? a : b; }
static int lhs(int a, int b) { (void)b; return a; }

static binop table[5] = { add, sub, mul, maxi, lhs };

static binop choose(char op) {
  switch (op) {
  case '+': return add;
  case '-': return sub;
  case '*': return &mul;
  default: return maxi;
  }
}

static int fold(const int *a, int n, int init, binop f) {
  int i, acc = init;
  for (i = 0; i < n; i++) acc = f(acc, a[i]);
  return acc;
}

static void dbl(int *x, int i) { *x = *x * 2 + i; }
static void neg(int *x, int i) { (void)i; *x = -*x; }
static void each(int *a, int n, visitor v) { int i; for (i = 0; i < n; i++) (*v)(&a[i], i); }

struct op { const char *name; binop fn; int unit; };
static struct op ops[3] = { { "sum", add, 0 }, { "prod", mul, 1 }, { "max", maxi, -1000 } };

struct machine { int acc; int (*step)(int, int); void (*report)(struct machine *); };
static void rep(struct machine *m) { show("machine acc", m->acc); }

static int apply_twice(int (*f)(int, int), int x, int y) { return f(f(x, y), y); }

int main(void) {
  int data[6] = { 3, -1, 4, 1, -5, 9 };
  int i, r;
  unsigned chk = 0;
  struct machine mc;
  binop f;
  int (*arr2[2])(int, int);

  for (i = 0; i < 5; i++) {
    r = table[i](7, 3);
    show("table(7,3)", r);
    chk = chk * 17u + (unsigned)r;
  }
  show("choose + ", choose('+')(10, 4));
  show("choose - ", choose('-')(10, 4));
  show("choose * ", (*choose('*'))(10, 4));
  show("choose ? ", choose('?')(10, 4));
  f = choose('*');
  show("f==mul", f == mul);
  show("f==add", f == add);

  for (i = 0; i < 3; i++) {
    r = fold(data, 6, ops[i].unit, ops[i].fn);
    puts_(ops[i].name); puts_(" = "); puti(r); nl();
    chk = chk * 17u + (unsigned)r;
  }
  each(data, 6, dbl);
  for (i = 0; i < 6; i++) { puti(data[i]); putch(' '); }
  nl();
  each(data + 2, 3, neg);
  for (i = 0; i < 6; i++) { puti(data[i]); putch(' '); }
  nl();

  mc.acc = 1; mc.step = mul; mc.report = rep;
  for (i = 2; i <= 6; i++) mc.acc = mc.step(mc.acc, i);
  mc.report(&mc);
  mc.step = sub;
  mc.acc = mc.step(mc.acc, 700);
  (*mc.report)(&mc);

  arr2[0] = sub; arr2[1] = table[2];
  show("apply_twice sub", apply_twice(arr2[0], 50, 8));
  show("apply_twice mul", apply_twice(arr2[1], 3, 4));
  chk = chk * 17u + (unsigned)mc.acc;
  showu("chk", chk);
  return (int)(chk & 0xff);
}
