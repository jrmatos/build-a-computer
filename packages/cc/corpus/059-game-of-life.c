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

#define W 16
#define H 16

static unsigned char grid[2][H][W];

static int neighbors(int g, int y, int x) {
  int dy, dx, n = 0;
  for (dy = -1; dy <= 1; dy++)
    for (dx = -1; dx <= 1; dx++) {
      if (dy == 0 && dx == 0) continue;
      n += grid[g][(y + dy + H) % H][(x + dx + W) % W];
    }
  return n;
}
static void step(int from) {
  int y, x, to = 1 - from;
  for (y = 0; y < H; y++)
    for (x = 0; x < W; x++) {
      int n = neighbors(from, y, x);
      grid[to][y][x] = (unsigned char)(n == 3 || (n == 2 && grid[from][y][x]));
    }
}
static int population(int g) {
  int y, x, p = 0;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) p += grid[g][y][x];
  return p;
}
static void print_grid(int g) {
  int y, x;
  for (y = 0; y < H; y++) {
    for (x = 0; x < W; x++) putch(grid[g][y][x] ? '#' : '.');
    nl();
  }
}
static unsigned grid_hash(int g) {
  unsigned h = 5381;
  int y, x;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) h = h * 33u + grid[g][y][x];
  return h;
}

static const char *glider[] = { ".#.", "..#", "###" };

int main(void) {
  int i, y, x, cur = 0;
  unsigned h;
  for (y = 0; y < 3; y++)
    for (x = 0; x < 3; x++) grid[0][1 + y][1 + x] = glider[y][x] == '#';
  /* blinker */
  grid[0][10][9] = 1; grid[0][10][10] = 1; grid[0][10][11] = 1;
  /* block */
  grid[0][3][12] = 1; grid[0][3][13] = 1; grid[0][4][12] = 1; grid[0][4][13] = 1;
  print_grid(0);
  show("pop0", population(0));
  for (i = 0; i < 20; i++) {
    step(cur);
    cur = 1 - cur;
    if (i % 5 == 4) { puts_("gen "); puti(i + 1); puts_(" pop "); puti(population(cur)); nl(); }
  }
  nl();
  print_grid(cur);
  h = grid_hash(cur);
  showu("hash", h);
  return (int)(h & 0xff);
}
