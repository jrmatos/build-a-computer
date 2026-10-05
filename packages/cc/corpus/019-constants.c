/* 019-constants: hex/octal/decimal literals, suffixes, character escapes, large unsigned constants */
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

#define INT_MIN_ (-2147483647 - 1)

static const char esc[] = "\a\b\t\n\v\f\r\\\'\"\?\x41\101\0z";
static const char mixed[] = "\x41\102C\0631\1772";

int main(void) {
  int i, s = 0;
  show("0x1F", 0x1F);
  show("0XaBc", 0XaBc);
  show("0777", 0777);
  show("010", 010);
  show("00", 00);
  show("1000000", 1000000);
  show("2147483647", 2147483647);
  show("INT_MIN", INT_MIN_);
  show("-0x7fffffff", -0x7fffffff);
  showu("0xffffffff", 0xffffffff);
  showu("4294967295u", 4294967295u);
  showu("0x80000000", 0x80000000);
  showu("-0x80000000", -0x80000000);
  showu("1000000U", 1000000U);
  showu("0XABCDu", 0XABCDu);
  showu("037777777777", 037777777777);
  show("100L", (int)100L);
  show("0x10l", (int)0x10l);
  show("5ul", (int)5ul);
  show("0xffffffff > 0", 0xffffffff > 0);
  show("-1 == 0xffffffff", (unsigned)-1 == 0xffffffff);
  show("sizeof 0xffffffff", (int)sizeof 0xffffffff);
  show("sizeof 2147483647", (int)sizeof 2147483647);
  show("'\\n'", '\n');
  show("'\\0'", '\0');
  show("'\\x41'", '\x41');
  show("'\\101'", '\101');
  show("'\\t'", '\t');
  show("'\\\\'", '\\');
  show("'\\''", '\'');
  show("'\"'", '"');
  show("'\\a'", '\a');
  show("'\\b'", '\b');
  show("'\\f'", '\f');
  show("'\\v'", '\v');
  show("'\\r'", '\r');
  show("'\\x7f'", '\x7f');
  show("'\\xff'", '\xff');
  show("'\\200'", '\200');
  show("'\\7'", '\7');
  show("'0'", '0');
  show("'z'-'a'", 'z' - 'a');
  show("sizeof esc", (int)sizeof esc);
  for (i = 0; i < (int)sizeof esc; i++) {
    puti(esc[i]); putch(' ');
    s = s * 7 + esc[i];
    s &= 0xfffff;
  }
  nl();
  show("sizeof mixed", (int)sizeof mixed);
  for (i = 0; i < (int)sizeof mixed; i++) {
    puti(mixed[i]); putch(' ');
    s = s * 5 + mixed[i];
    s &= 0xfffff;
  }
  nl();
  puts_("str: \x48\151!\n");
  show("s", s);
  return (s >> 2) & 0xff;
}
