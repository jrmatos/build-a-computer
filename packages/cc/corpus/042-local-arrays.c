/* 042-local-arrays: 4 KiB local arrays on the stack, nested scopes with shadowing, block-scoped arrays */
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

static unsigned fill_and_hash(int seed) {
  int big[1024];   /* 4 KiB */
  int i;
  unsigned h = 0;
  for (i = 0; i < 1024; i++) big[i] = seed * i + (i >> 3);
  for (i = 1023; i >= 0; i -= 7) h = h * 31u + (unsigned)big[i];
  return h;
}

static int nested_frames(int depth) {
  unsigned char buf[4096];
  int i, s = 0;
  for (i = 0; i < 4096; i++) buf[i] = (unsigned char)(i * 7 + depth);
  if (depth > 0) s = nested_frames(depth - 1);
  for (i = 0; i < 4096; i += 512) s += buf[i];
  return s;
}

int main(void) {
  int x = 1;
  int arr[1024];
  int i;
  unsigned h;

  for (i = 0; i < 1024; i++) arr[i] = 1024 - i;
  show("x outer", x);
  {
    int x = 2;
    show("x block", x);
    {
      int x = 3;
      show("x innermost", x);
      x += 10;
      show("x innermost+10", x);
    }
    {
      int arr[16];
      for (i = 0; i < 16; i++) arr[i] = i * x;
      show("inner arr[15]", arr[15]);
      show("sizeof inner arr", (int)sizeof arr);
    }
    show("x block again", x);
  }
  show("outer arr[0]", arr[0]);
  show("sizeof outer arr", (int)sizeof arr);

  for (i = 0; i < 3; i++) {
    int tmp[256];
    int j, s = 0;
    for (j = 0; j < 256; j++) tmp[j] = j + i;
    for (j = 0; j < 256; j += 32) s += tmp[j];
    show("loop block sum", s);
  }

  h = fill_and_hash(3);
  showu("fill_and_hash(3)", h);
  h ^= fill_and_hash(-5);
  showu("xor fill_and_hash(-5)", h);
  show("nested_frames(4)", nested_frames(4));

  {
    char a[4096];
    char b[100];
    int k;
    for (k = 0; k < 4096; k++) a[k] = (char)('a' + k % 26);
    for (k = 0; k < 99; k++) b[k] = a[k * 41];
    b[99] = 0;
    puts_(b); nl();
    show("a[4095]", a[4095]);
  }
  show("arr[1023]", arr[1023]);
  show("x end", x);
  return (int)(h & 0xff);
}
