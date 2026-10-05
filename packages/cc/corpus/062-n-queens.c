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

static unsigned nodes;

static int solve_bits(int n, unsigned cols, unsigned d1, unsigned d2) {
  unsigned all = (1u << n) - 1u;
  unsigned avail;
  int count = 0;
  nodes++;
  if (cols == all) return 1;
  avail = all & ~(cols | d1 | d2);
  while (avail) {
    unsigned bit = avail & (0u - avail);
    avail ^= bit;
    count += solve_bits(n, cols | bit, ((d1 | bit) << 1) & all, (d2 | bit) >> 1);
  }
  return count;
}

/* classic array-based solver for cross-checking */
static int pos[8];
static int first[8];
static int have_first;

static int safe(int row, int col) {
  int r;
  for (r = 0; r < row; r++) {
    int d = pos[r] - col;
    if (d == 0 || d == row - r || d == r - row) return 0;
  }
  return 1;
}
static int solve_array(int n, int row) {
  int col, count = 0;
  if (row == n) {
    if (!have_first) { int i; for (i = 0; i < n; i++) first[i] = pos[i]; have_first = 1; }
    return 1;
  }
  for (col = 0; col < n; col++) {
    if (safe(row, col)) { pos[row] = col; count += solve_array(n, row + 1); }
  }
  return count;
}

int main(void) {
  int n, total = 0, agree = 1;
  for (n = 1; n <= 8; n++) {
    int a, b;
    nodes = 0;
    a = solve_bits(n, 0u, 0u, 0u);
    have_first = 0;
    b = solve_array(n, 0);
    puts_("n="); puti(n); puts_(" solutions="); puti(a); puts_(" nodes="); putu(nodes);
    if (a != b) { puts_(" MISMATCH "); puti(b); agree = 0; }
    nl();
    total += a;
  }
  puts_("first 8-queens:");
  for (n = 0; n < 8; n++) { putch(' '); puti(first[n]); }
  nl();
  for (n = 0; n < 8; n++) {
    int c;
    for (c = 0; c < 8; c++) putch(first[n] == c ? 'Q' : '.');
    nl();
  }
  show("agree", agree);
  show("total", total);
  return total;
}
