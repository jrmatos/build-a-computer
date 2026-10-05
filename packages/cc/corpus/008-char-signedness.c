/* 008-char-signedness: plain char is unsigned on RISC-V; signed char vs unsigned char conversions */
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

static const char hi[] = "\xff\x80\x7f\x01" "A";

static char ident(char c) { return c; }
static int as_int(char c) { return c; }
static int scmp(const char *a, const char *b) {
  while (*a && *a == *b) { a++; b++; }
  return *a - *b;
}

int main(void) {
  char c = (char)200, d;
  signed char sc = (signed char)200;
  unsigned char uc = 200;
  int i, n = 0, sum = 0, ssum = 0;
  show("(int)c", c);
  show("c>0", c > 0);
  show("sc", sc);
  show("sc<0", sc < 0);
  show("uc", uc);
  show("(char)-1", (char)-1);
  show("c==uc", c == uc);
  show("sc==uc", sc == uc);
  show("(unsigned char)sc", (unsigned char)sc);
  show("(signed char)c", (signed char)c);
  show("(char)sc", (char)sc);
  show("(int)(char)sc", (int)(char)sc);
  show("ident(-1)", ident(-1));
  show("as_int(255)", as_int((char)255));
  show("as_int(sc)", as_int(sc));
  show("c+1", c + 1);
  show("sc+1", sc + 1);
  show("c*2", c * 2);
  show("sc*2", sc * 2);
  show("c-256", c - 256);
  d = c;
  d += 100;
  show("c+=100", d);
  d = 0;
  d--;
  show("0--", d);
  for (i = 0; hi[i]; i++) {
    sum += hi[i];
    ssum += (signed char)hi[i];
    if (hi[i] > 127) n++;
  }
  show("sum plain", sum);
  show("sum signed", ssum);
  show("count >127", n);
  show("sizeof hi", (int)sizeof hi);
  show("scmp(\"\\xff\",\"a\")", scmp("\xff", "a"));
  show("scmp(\"abc\",\"abd\")", scmp("abc", "abd"));
  show("scmp(\"\\x80z\",\"\\x7fz\")", scmp("\x80z", "\x7fz"));
  show("'\\377'", '\377');
  show("(char)'\\377'", (char)'\377');
  show("(signed char)'\\377'", (signed char)'\377');
  return (sum + ssum + n) & 0xff;
}
