/* 028-multidim: 2-D and 3-D arrays, row-major layout, int (*)[N] params, 4x4 matmul */
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

#define N 4

static int grid[3][5];
static int cube[2][3][4];

static void matmul(int (*a)[N], int (*b)[N], int c[N][N]) {
  int i, j, k;
  for (i = 0; i < N; i++)
    for (j = 0; j < N; j++) {
      int s = 0;
      for (k = 0; k < N; k++) s += a[i][k] * b[k][j];
      c[i][j] = s;
    }
}

static int trace(int (*m)[N]) { int t = 0, i; for (i = 0; i < N; i++) t += m[i][i]; return t; }

static int row_sum(int (*g)[5], int r) { int s = 0, j; for (j = 0; j < 5; j++) s += g[r][j]; return s; }

static void print_mat(int m[N][N]) {
  int i, j;
  for (i = 0; i < N; i++) {
    for (j = 0; j < N; j++) { puti(m[i][j]); putch(' '); }
    nl();
  }
}

int main(void) {
  int a[N][N], b[N][N], c[N][N], id[N][N];
  int i, j, k, ok;
  int *flat;
  unsigned chk = 0;

  for (i = 0; i < 3; i++)
    for (j = 0; j < 5; j++) grid[i][j] = i * 10 + j;
  flat = &grid[0][0];
  ok = 1;
  for (i = 0; i < 15; i++) if (flat[i] != grid[i / 5][i % 5]) ok = 0;
  show("grid row-major", ok);
  show("&grid[2][0]-&grid[0][0]", (int)(&grid[2][0] - &grid[0][0]));
  show("sizeof grid", (int)sizeof grid);
  show("sizeof grid[0]", (int)sizeof grid[0]);
  for (i = 0; i < 3; i++) show("row_sum", row_sum(grid, i));

  for (i = 0; i < 2; i++)
    for (j = 0; j < 3; j++)
      for (k = 0; k < 4; k++) cube[i][j][k] = i * 100 + j * 10 + k;
  show("cube[1][2][3]", cube[1][2][3]);
  show("cube flat[17]", (&cube[0][0][0])[17]);
  show("&cube[1][0][0]-&cube[0][0][0]", (int)(&cube[1][0][0] - &cube[0][0][0]));
  show("sizeof cube[1]", (int)sizeof cube[1]);
  show("sizeof cube[1][2]", (int)sizeof cube[1][2]);
  {
    int (*plane)[4] = cube[1];
    show("plane[1][1]", plane[1][1]);
    plane++;
    show("plane++[1][3]", plane[1][3]);
  }

  for (i = 0; i < N; i++)
    for (j = 0; j < N; j++) {
      a[i][j] = i + 2 * j - 3;
      b[i][j] = (i * j) % 5 - 1;
      id[i][j] = (i == j);
    }
  matmul(a, b, c);
  puts_("a*b:"); nl();
  print_mat(c);
  show("trace(a*b)", trace(c));
  matmul(c, id, a);
  ok = 1;
  for (i = 0; i < N; i++) for (j = 0; j < N; j++) if (a[i][j] != c[i][j]) ok = 0;
  show("c*I==c", ok);
  matmul(c, c, b);
  puts_("c*c:"); nl();
  print_mat(b);
  for (i = 0; i < N; i++) for (j = 0; j < N; j++) chk = chk * 7u + (unsigned)b[i][j];
  showu("chk", chk);
  return (int)(chk % 251u);
}
