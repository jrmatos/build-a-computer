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

static unsigned crc32_bitwise(const unsigned char *p, int n) {
  unsigned crc = 0xffffffffu;
  int i, k;
  for (i = 0; i < n; i++) {
    crc ^= p[i];
    for (k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

static unsigned table[256];
static void make_table(void) {
  unsigned i, c;
  int k;
  for (i = 0; i < 256; i++) {
    c = i;
    for (k = 0; k < 8; k++) c = (c & 1u) ? 0xedb88320u ^ (c >> 1) : c >> 1;
    table[i] = c;
  }
}
static unsigned crc32_table(const unsigned char *p, int n) {
  unsigned crc = 0xffffffffu;
  while (n-- > 0) crc = table[(crc ^ *p++) & 0xffu] ^ (crc >> 8);
  return crc ^ 0xffffffffu;
}
static unsigned adler32(const unsigned char *p, int n) {
  unsigned a = 1, b = 0;
  int i;
  for (i = 0; i < n; i++) {
    a = (a + p[i]) % 65521u;
    b = (b + a) % 65521u;
  }
  return (b << 16) | a;
}
static int my_strlen(const char *s) { int n = 0; while (s[n]) n++; return n; }

static const char *inputs[] = {
  "",
  "a",
  "abc",
  "123456789",
  "The quick brown fox jumps over the lazy dog",
  "Wikipedia",
  "\xff\xfe\x80\x01 high bytes",
};

int main(void) {
  static unsigned char big[1000];
  unsigned acc = 0, c1, c2;
  int i, mismatches = 0;
  make_table();
  for (i = 0; i < (int)(sizeof(inputs) / sizeof(inputs[0])); i++) {
    const unsigned char *p = (const unsigned char *)inputs[i];
    int n = my_strlen(inputs[i]);
    c1 = crc32_bitwise(p, n);
    c2 = crc32_table(p, n);
    if (c1 != c2) mismatches++;
    puts_("\""); puts_(inputs[i]); puts_("\" crc32=");
    putx(c1);
    puts_(" adler32=");
    putx(adler32(p, n));
    nl();
    acc ^= c1 + adler32(p, n);
  }
  for (i = 0; i < 1000; i++) big[i] = (unsigned char)(i * 7 + (i >> 3));
  c1 = crc32_bitwise(big, 1000);
  c2 = crc32_table(big, 1000);
  showu("big crc", c1);
  show("big match", c1 == c2);
  showu("big adler", adler32(big, 1000));
  show("mismatches", mismatches);
  showu("table[1]", table[1]);
  showu("table[255]", table[255]);
  acc ^= c1;
  showu("acc", acc);
  return (int)(acc >> 24);
}
