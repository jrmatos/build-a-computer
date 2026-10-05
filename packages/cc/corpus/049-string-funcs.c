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

static int my_strlen(const char *s) { int n = 0; while (s[n]) n++; return n; }
static char *my_strcpy(char *d, const char *s) { char *r = d; while ((*d++ = *s++) != 0) {} return r; }
static char *my_strcat(char *d, const char *s) { my_strcpy(d + my_strlen(d), s); return d; }
static int my_strcmp(const char *a, const char *b) {
  while (*a && *a == *b) { a++; b++; }
  return (int)(unsigned char)*a - (int)(unsigned char)*b;
}
static int my_strncmp(const char *a, const char *b, int n) {
  while (n > 0 && *a && *a == *b) { a++; b++; n--; }
  if (n == 0) return 0;
  return (int)(unsigned char)*a - (int)(unsigned char)*b;
}
static const char *my_strchr(const char *s, int c) {
  for (;; s++) {
    if (*s == (char)c) return s;
    if (!*s) return 0;
  }
}
static void my_strrev(char *s) {
  int i = 0, j = my_strlen(s) - 1;
  while (i < j) { char t = s[i]; s[i] = s[j]; s[j] = t; i++; j--; }
}
static int my_atoi(const char *s) {
  unsigned v = 0;
  int neg = 0;
  while (*s == ' ') s++;
  if (*s == '-') { neg = 1; s++; } else if (*s == '+') s++;
  while (*s >= '0' && *s <= '9') { v = v * 10u + (unsigned)(*s - '0'); s++; }
  return neg ? (int)(0u - v) : (int)v;
}
static char *my_itoa(int v, char *buf, int base) {
  unsigned u;
  int i = 0, neg = 0;
  if (v < 0 && base == 10) { neg = 1; u = 0u - (unsigned)v; } else u = (unsigned)v;
  do { buf[i++] = "0123456789abcdefghijklmnopqrstuvwxyz"[u % (unsigned)base]; u /= (unsigned)base; } while (u);
  if (neg) buf[i++] = '-';
  buf[i] = 0;
  my_strrev(buf);
  return buf;
}
static int sgn(int x) { return x < 0 ? -1 : (x > 0 ? 1 : 0); }

int main(void) {
  char buf[64];
  char num[40];
  const char *p;
  unsigned check = 0;
  int i;
  static const char *words[] = { "apple", "banana", "apricot", "", "app", "zebra", "\xe9t\xe9" };
  static const char *nums[] = { "0", "42", "-17", "  +123", "2147483647", "-2147483648", "99abc" };
  static const int ivals[] = { 0, 7, -7, 255, -1000000, 2147483647, -2147483647 - 1 };

  my_strcpy(buf, "Hello");
  my_strcat(buf, ", ");
  my_strcat(buf, "world!");
  puts_(buf); nl();
  show("len", my_strlen(buf));
  for (i = 0; i < 7; i++) {
    int j;
    for (j = 0; j < 7; j++) {
      int c = sgn(my_strcmp(words[i], words[j]));
      check = check * 3u + (unsigned)(c + 1);
    }
  }
  showu("cmp matrix", check);
  show("strncmp app/apple 3", my_strncmp("app", "apple", 3));
  show("strncmp app/apple 4", sgn(my_strncmp("app", "apple", 4)));
  show("strncmp apricot/apple 2", my_strncmp("apricot", "apple", 2));
  show("high char cmp", sgn(my_strcmp("\xe9", "z")));
  p = my_strchr(buf, 'w');
  puts_("strchr w: "); puts_(p ? p : "(null)"); nl();
  p = my_strchr(buf, 'q');
  show("strchr q found", p != 0);
  p = my_strchr(buf, 0);
  show("strchr nul offset", (int)(p - buf));
  my_strcpy(buf, "racecar level stressed");
  my_strrev(buf);
  puts_(buf); nl();
  for (i = 0; i < 7; i++) {
    int v = my_atoi(nums[i]);
    puts_("atoi \""); puts_(nums[i]); puts_("\" -> "); puti(v); nl();
    check += (unsigned)v;
  }
  for (i = 0; i < 7; i++) {
    puts_(my_itoa(ivals[i], num, 10)); putch(' ');
    puts_(my_itoa(ivals[i], num, 16)); putch(' ');
    puts_(my_itoa(ivals[i], num, 2)); nl();
    check += (unsigned)my_strlen(num);
  }
  puts_(my_itoa(123456789, num, 36)); nl();
  showu("check", check);
  return (int)(check & 0xff);
}
