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

#define MAXN 5

typedef struct { int n; int m[MAXN][MAXN]; } matrix;

static void minor_of(const matrix *a, int row, int col, matrix *out) {
  int i, j, r = 0, c;
  out->n = a->n - 1;
  for (i = 0; i < a->n; i++) {
    if (i == row) continue;
    c = 0;
    for (j = 0; j < a->n; j++) {
      if (j == col) continue;
      out->m[r][c++] = a->m[i][j];
    }
    r++;
  }
}
static int det(const matrix *a) {
  matrix sub;
  int j, sign = 1, d = 0;
  if (a->n == 1) return a->m[0][0];
  if (a->n == 2) return a->m[0][0] * a->m[1][1] - a->m[0][1] * a->m[1][0];
  for (j = 0; j < a->n; j++) {
    minor_of(a, 0, j, &sub);
    d += sign * a->m[0][j] * det(&sub);
    sign = -sign;
  }
  return d;
}
static void transpose(const matrix *a, matrix *t) {
  int i, j;
  t->n = a->n;
  for (i = 0; i < a->n; i++) for (j = 0; j < a->n; j++) t->m[j][i] = a->m[i][j];
}
static void mul(const matrix *a, const matrix *b, matrix *c) {
  int i, j, k;
  c->n = a->n;
  for (i = 0; i < a->n; i++)
    for (j = 0; j < a->n; j++) {
      int s = 0;
      for (k = 0; k < a->n; k++) s += a->m[i][k] * b->m[k][j];
      c->m[i][j] = s;
    }
}
static int is_identity(const matrix *a) {
  int i, j;
  for (i = 0; i < a->n; i++) for (j = 0; j < a->n; j++) if (a->m[i][j] != (i == j)) return 0;
  return 1;
}
static void print_m(const char *name, const matrix *a) {
  int i, j;
  puts_(name); nl();
  for (i = 0; i < a->n; i++) {
    for (j = 0; j < a->n; j++) { putch(' '); puti(a->m[i][j]); }
    nl();
  }
}

static const int A4[4][4] = { { 3, -2, 0, 5 }, { 1, 4, -3, 2 }, { 7, 0, 1, -1 }, { -2, 6, 2, 3 } };
/* unimodular matrix and its inverse */
static const int U3[3][3] = { { 2, 3, 1 }, { 1, 2, 1 }, { 1, 1, 1 } };
static const int U3i[3][3] = { { 1, -2, 1 }, { 0, 1, -1 }, { -1, 1, 1 } };

int main(void) {
  matrix a, t, b, c, u, ui, h;
  int i, j, d1, d2;
  a.n = 4;
  for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) a.m[i][j] = A4[i][j];
  print_m("A", &a);
  d1 = det(&a);
  show("det A", d1);
  transpose(&a, &t);
  print_m("A^T", &t);
  d2 = det(&t);
  show("det A^T", d2);
  show("equal", d1 == d2);
  mul(&a, &t, &b);
  print_m("A*A^T", &b);
  show("det A*A^T", det(&b));
  show("A*A^T identity", is_identity(&b));
  u.n = 3; ui.n = 3;
  for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) { u.m[i][j] = U3[i][j]; ui.m[i][j] = U3i[i][j]; }
  mul(&u, &ui, &c);
  print_m("U*Uinv", &c);
  show("identity", is_identity(&c));
  show("det U", det(&u));
  h.n = 5;
  for (i = 0; i < 5; i++) for (j = 0; j < 5; j++) h.m[i][j] = (i + 1) * (j + 2) % 7 - 3 + (i == j) * 4;
  print_m("H", &h);
  d2 = det(&h);
  show("det H", d2);
  return (d1 + d2) & 0xff;
}
