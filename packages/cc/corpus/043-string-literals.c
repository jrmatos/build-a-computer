/* 043-string-literals: literal indexing, sizeof("abc"), adjacent concatenation, arrays of string ptrs, escapes */
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

static const char *names[] = { "zero", "one", "two", "three", "four", "" };
static const char greeting[] = "Hello, " "world" "!";
static char mutable_buf[] = "mutable";

static int slen(const char *s) { const char *p = s; while (*p) p++; return (int)(p - s); }
static unsigned hash(const char *s) { unsigned h = 2166136261u; while (*s) { h ^= (unsigned char)*s++; h *= 16777619u; } return h; }

int main(void) {
  int i, total = 0;
  const char *p;
  const char *esc = "tab\there\nq\"uote\\ \x41\101\0hidden";
  char local[] = "local";

  show("sizeof(\"abc\")", (int)sizeof("abc"));
  show("sizeof(\"\")", (int)sizeof(""));
  show("sizeof greeting", (int)sizeof greeting);
  show("slen greeting", slen(greeting));
  puts_(greeting); nl();
  show("\"xyz\"[1]", "xyz"[1]);
  show("*\"Q\"", *"Q");
  putch("0123456789"[7]); nl();
  show("sizeof(\"ab\" \"cd\")", (int)sizeof("ab" "cd"));
  puts_("con" "cat" "en" "ation"); nl();

  for (i = 0; i < 6; i++) {
    puti(i); putch(':'); puts_(names[i]); putch('('); puti(slen(names[i])); putch(')'); putch(' ');
    total += slen(names[i]);
  }
  nl();
  show("total len", total);
  show("names count", (int)(sizeof names / sizeof names[0]));
  show("names[3][2]", names[3][2]);

  puts_(esc);
  nl();
  show("slen esc", slen(esc));
  show("esc after nul", esc[slen(esc) + 1]);
  show("sizeof esc literal", (int)sizeof("tab\there\nq\"uote\\ \x41\101\0hidden"));
  show("'\\n'", '\n'); show("'\\t'", '\t'); show("'\\\\'", '\\'); show("'\\''", '\'');
  show("'\\0'", '\0'); show("'\\x7f'", '\x7f'); show("'\\177'", '\177'); show("'\\a'", '\a');
  show("\"\\xff\"[0]", "\xff"[0]);
  show("\"\\377\"[0]", "\377"[0]);

  show("sizeof local", (int)sizeof local);
  local[0] = 'L';
  puts_(local); nl();
  mutable_buf[0] = 'M';
  mutable_buf[6] = 'E';
  puts_(mutable_buf); nl();

  for (p = "walk"; *p; p++) { putch(*p); putch('.'); }
  nl();
  showu("hash greeting", hash(greeting));
  showu("hash esc", hash(esc));
  showu("hash literal", hash("The quick brown fox " "jumps over the lazy dog"));
  return (int)((hash(greeting) + (unsigned)total) & 0xff);
}
