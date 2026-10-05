/* 034-nested-aggregates: structs with arrays, arrays of structs with arrays, nested brace initializers */
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

struct vec3 { int c[3]; };
struct tri { struct vec3 v[3]; char label[4]; };
struct mesh { int ntri; struct tri t[2]; int flags[2][2]; };
struct cfg { const char *name; int dims[2]; struct { int lo, hi; } range; };

static struct mesh gm = {
  2,
  { { { { { 0, 0, 0 } }, { { 1, 0, 0 } }, { { 0, 1, 0 } } }, "t0" },
    { { { { 2, 3, 4 } }, { { -1, 5, 2 } }, { { 7, -2, 1 } } }, "t1" } },
  { { 1, 2 }, { 3, 4 } }
};

static struct cfg cfgs[3] = {
  { "small", { 4, 4 }, { -1, 1 } },
  { "wide", { 16, 2 }, { 0, 100 } },
  { "partial", { 9 }, { 5, 0 } }
};

static int dot(const struct vec3 *a, const struct vec3 *b) {
  return a->c[0] * b->c[0] + a->c[1] * b->c[1] + a->c[2] * b->c[2];
}

static int tri_sum(const struct tri *t) {
  int s = 0, i, j;
  for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) s += t->v[i].c[j] * (i + 1);
  return s;
}

int main(void) {
  struct mesh m2;
  struct tri lt = { { { { 1, 2, 3 } }, { { 4, 5, 6 } } }, "lt" };
  int arr2[2][3] = { { 1, 2, 3 }, { 4 } };
  int i, j, s = 0;

  show("gm.ntri", gm.ntri);
  for (i = 0; i < gm.ntri; i++) {
    puts_(gm.t[i].label); puts_(" sum = "); puti(tri_sum(&gm.t[i])); nl();
  }
  show("dot t1.v0 t1.v1", dot(&gm.t[1].v[0], &gm.t[1].v[1]));
  show("flags[1][0]", gm.flags[1][0]);
  show("lt.v[2].c[1] (zero-init)", lt.v[2].c[1]);
  show("lt.v[1].c[2]", lt.v[1].c[2]);
  show("tri_sum lt", tri_sum(&lt));
  show("lt.label[2]", lt.label[2]);
  show("arr2[1][0]", arr2[1][0]);
  show("arr2[1][2]", arr2[1][2]);

  for (i = 0; i < 3; i++) {
    puts_(cfgs[i].name); putch(' ');
    puti(cfgs[i].dims[0]); putch('x'); puti(cfgs[i].dims[1]);
    puts_(" ["); puti(cfgs[i].range.lo); putch(','); puti(cfgs[i].range.hi); putch(']'); nl();
  }

  m2 = gm;
  m2.t[0].v[2].c[2] = 9;
  m2.t[1] = lt;
  m2.flags[0][1] = 77;
  show("gm.t[0].v[2].c[2]", gm.t[0].v[2].c[2]);
  show("m2.t[0].v[2].c[2]", m2.t[0].v[2].c[2]);
  show("tri_sum m2.t[1]", tri_sum(&m2.t[1]));
  puts_(m2.t[1].label); nl();
  show("gm.flags[0][1]", gm.flags[0][1]);
  for (i = 0; i < 2; i++) for (j = 0; j < 2; j++) s += m2.flags[i][j] * (i * 2 + j + 1);
  show("flag weight", s);
  show("sizeof(struct tri)", (int)sizeof(struct tri));
  show("sizeof(struct mesh)", (int)sizeof(struct mesh));
  s += tri_sum(&gm.t[1]) + dot(&lt.v[0], &lt.v[1]);
  show("final", s);
  return s & 0xff;
}
