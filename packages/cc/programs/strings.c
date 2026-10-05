#include "prelude.h"
static int slen(const char *s) { const char *p = s; while (*p) p++; return (int)(p - s); }
static int scmp(const char *a, const char *b) { while (*a && *a == *b) a++, b++; return (unsigned char)*a - (unsigned char)*b; }
static char *scpy(char *d, const char *s) { char *r = d; while ((*d++ = *s++)) ; return r; }
static void rev(char *s) { int i = 0, j = slen(s) - 1; while (i < j) { char t = s[i]; s[i++] = s[j]; s[j--] = t; } }
static char *itoa_(int v, char *buf) { char *p = buf; unsigned u = v < 0 ? -(unsigned)v : (unsigned)v; do *p++ = '0' + u % 10; while (u /= 10); if (v < 0) *p++ = '-'; *p = 0; rev(buf); return buf; }
struct named { char name[8]; int id; };
int main(void) {
  char buf[64];
  char esc[] = "tab\there\\back\"quote\'\x41\102\0hidden";
  struct named n[2] = { { "alpha", 1 }, { "beta", 2 } };
  int i;
  show("slen", slen("hello, world"));
  show("sizeof esc", (int)sizeof esc);
  puts_(esc); nl();
  show("hidden", esc[sizeof esc - 2]);
  show("scmp", scmp("abc", "abd") + scmp("b", "a") * 10 + scmp("same", "same") * 100);
  scpy(buf, "copied"); puts_(buf); nl();
  rev(buf); puts_(buf); nl();
  puts_(itoa_(-12345, buf)); nl();
  puts_(itoa_(0, buf)); nl();
  puts_(itoa_(-2147483647 - 1, buf)); nl();
  for (i = 0; i < 2; i++) { puts_(n[i].name); show(" id", n[i].id); }
  show("name size", (int)sizeof n[0].name);
  {
    const char *p = "\x7f\x80\xff";
    show("high chars", p[0] + p[1] + p[2]);
    show("signed view", (signed char)p[2]);
  }
  {
    char grid[3][4] = { "abc", "de", "f" };
    for (i = 0; i < 3; i++) { puts_(grid[i]); nl(); }
  }
  show("char lits", 'a' + '\n' + '\0' + '\\' + '\'' + '\x7f');
  show("str index", "xyz"[1]);
  show("concat", (int)sizeof("ab" "cd" "ef"));
  return slen(esc);
}
