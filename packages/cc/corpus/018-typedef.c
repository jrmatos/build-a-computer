/* 018-typedef: typedefs of integer, pointer, array, struct, self-referential struct, function pointer types */
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

typedef int i32;
typedef unsigned u32;
typedef unsigned char u8;
typedef i32 *i32p;
typedef int vec3[3];
typedef struct point { i32 x, y; } Point;
typedef Point *PointP;
typedef struct node Node;
struct node { int v; Node *next; };
typedef i32 (*binop)(i32, i32);
typedef binop optable[4];
typedef const char *cstr;

static i32 add(i32 a, i32 b) { return a + b; }
static i32 sub(i32 a, i32 b) { return a - b; }
static i32 mul(i32 a, i32 b) { return a * b; }
static i32 mx(i32 a, i32 b) { return a > b ? a : b; }

static optable ops = {add, sub, mul, mx};
static cstr opnames[4] = {"add", "sub", "mul", "max"};

static i32 dot(const vec3 a, const vec3 b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
static void move(PointP p, i32 dx, i32 dy) { p->x += dx; p->y += dy; }
static i32 fold(binop f, const i32 *v, int n) {
  i32 acc = v[0];
  int i;
  for (i = 1; i < n; i++) acc = f(acc, v[i]);
  return acc;
}

int main(void) {
  vec3 a = {1, 2, 3}, b = {4, -5, 6};
  Point pt = {10, 20};
  PointP pp = &pt;
  Node nodes[5];
  Node *head = 0, *it;
  i32 data[5] = {3, 1, 4, 1, 5};
  i32p ip = &data[2];
  u8 small = (u8)300;
  u32 big = (u32)-1;
  binop f;
  int i, s = 0;
  show("dot", dot(a, b));
  show("sizeof(vec3)", (int)sizeof(vec3));
  show("sizeof(Point)", (int)sizeof(Point));
  show("sizeof(optable)", (int)sizeof(optable));
  move(pp, 5, -25);
  show("pt.x", pt.x);
  show("pt.y", pt.y);
  show("*ip", *ip);
  show("small", small);
  showu("big", big);
  for (i = 0; i < 4; i++) {
    i32 r = ops[i](12, 5);
    puts_(opnames[i]); puts_("(12,5) = "); puti(r);
    puts_(" fold = "); puti(fold(ops[i], data, 5)); nl();
    s += r;
  }
  f = ops[3];
  show("f(-1,-2)", f(-1, -2));
  for (i = 0; i < 5; i++) {
    nodes[i].v = data[i] * (i + 1);
    nodes[i].next = head;
    head = &nodes[i];
  }
  for (it = head; it; it = it->next) {
    puts_("node "); puti(it->v); nl();
    s = s * 3 + it->v;
  }
  show("s", s);
  return s & 0xff;
}
