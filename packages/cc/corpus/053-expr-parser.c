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

static const char *src;
static int err;

static void skip(void) { while (*src == ' ' || *src == '\t') src++; }

static int expr(void);

static int primary(void) {
  int v;
  skip();
  if (*src == '(') {
    src++;
    v = expr();
    skip();
    if (*src == ')') src++; else err = 1;
    return v;
  }
  if (*src == '-') { src++; return (int)(0u - (unsigned)primary()); }
  if (*src == '+') { src++; return primary(); }
  if (*src >= '0' && *src <= '9') {
    unsigned u = 0;
    while (*src >= '0' && *src <= '9') { u = u * 10u + (unsigned)(*src - '0'); src++; }
    return (int)u;
  }
  err = 2;
  return 0;
}

static int term(void) {
  int v = primary();
  for (;;) {
    char op;
    int r;
    skip();
    op = *src;
    if (op != '*' && op != '/' && op != '%') return v;
    src++;
    r = primary();
    if (op == '*') v = (int)((unsigned)v * (unsigned)r);
    else if (r == 0) { err = 3; v = 0; }
    else if (r == -1) v = (op == '/') ? (int)(0u - (unsigned)v) : 0;
    else if (op == '/') v = v / r;
    else v = v % r;
  }
}

static int expr(void) {
  int v = term();
  for (;;) {
    char op;
    int r;
    skip();
    op = *src;
    if (op != '+' && op != '-') return v;
    src++;
    r = term();
    if (op == '+') v = (int)((unsigned)v + (unsigned)r);
    else v = (int)((unsigned)v - (unsigned)r);
  }
}

static int eval(const char *s, int *ok) {
  int v;
  src = s;
  err = 0;
  v = expr();
  skip();
  if (*src) err = err ? err : 4;
  *ok = err;
  return v;
}

static const char *tests[] = {
  "1 + 2 * 3",
  "(1 + 2) * 3",
  "-(4 - 10) * -2",
  "100 / 7 % 4",
  "-7 / 2",
  "-7 % 2",
  "7 % -3",
  "2 * (3 + (4 - 1) * (5 + -6)) - --8",
  "((((((42))))))",
  "1 - 2 - 3 - 4",
  "65536 * 65536 + 5",
  "2147483647 + 1",
  "12 / (3 - 3)",
  "(1 + 2",
  "3 + * 4",
  "10 20",
  "  +5 * +5  ",
  "-2147483647 - 1",
  "1000000 * 3 / 7 % 1000",
};

int main(void) {
  unsigned h = 0;
  int i, nerr = 0;
  for (i = 0; i < (int)(sizeof(tests) / sizeof(tests[0])); i++) {
    int e;
    int v = eval(tests[i], &e);
    puts_(tests[i]);
    puts_(" => ");
    if (e) { puts_("error "); puti(e); nerr++; }
    else puti(v);
    nl();
    h = h * 131u + (unsigned)v + (unsigned)e;
  }
  show("errors", nerr);
  showu("hash", h);
  return (int)(h & 0xff);
}
