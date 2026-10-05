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

#define CAP 64

enum slot_state { EMPTY, USED, DELETED };

struct entry { const char *key; int value; enum slot_state state; };
static struct entry table[CAP];
static int count;
static unsigned probes;

static unsigned fnv1a(const char *s) {
  unsigned h = 2166136261u;
  while (*s) { h ^= (unsigned char)*s++; h *= 16777619u; }
  return h;
}
static int str_eq(const char *a, const char *b) {
  while (*a && *a == *b) { a++; b++; }
  return *a == *b;
}
static int find_slot(const char *key) {
  unsigned i = fnv1a(key) & (CAP - 1);
  int n;
  for (n = 0; n < CAP; n++) {
    probes++;
    if (table[i].state == EMPTY) return -1;
    if (table[i].state == USED && str_eq(table[i].key, key)) return (int)i;
    i = (i + 1u) & (CAP - 1);
  }
  return -1;
}
static int insert(const char *key, int value) {
  unsigned i;
  int n, first_del = -1, s = find_slot(key);
  if (s >= 0) { table[s].value = value; return 0; }
  i = fnv1a(key) & (CAP - 1);
  for (n = 0; n < CAP; n++) {
    if (table[i].state == DELETED && first_del < 0) first_del = (int)i;
    if (table[i].state == EMPTY) break;
    i = (i + 1u) & (CAP - 1);
  }
  if (first_del >= 0) i = (unsigned)first_del;
  else if (n == CAP) return -1;
  table[i].key = key; table[i].value = value; table[i].state = USED;
  count++;
  return 1;
}
static int lookup(const char *key, int *out) {
  int s = find_slot(key);
  if (s < 0) return 0;
  *out = table[s].value;
  return 1;
}
static int erase(const char *key) {
  int s = find_slot(key);
  if (s < 0) return 0;
  table[s].state = DELETED;
  count--;
  return 1;
}

static const char *keys[] = {
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
  "lambda", "mu", "nu", "xi", "omicron", "pi", "rho", "sigma", "tau", "upsilon",
  "phi", "chi", "psi", "omega", "", "a", "ab", "abc", "abcd", "abcde",
};
#define NKEYS ((int)(sizeof(keys) / sizeof(keys[0])))

int main(void) {
  int i, v, found = 0;
  unsigned sum = 0;
  showu("fnv(\"\")", fnv1a(""));
  showu("fnv(\"a\")", fnv1a("a"));
  showu("fnv(\"foobar\")", fnv1a("foobar"));
  for (i = 0; i < NKEYS; i++) insert(keys[i], i * i);
  show("count", count);
  show("update", insert("pi", 314));
  for (i = 0; i < NKEYS; i += 2) erase(keys[i]);
  show("after erase", count);
  show("erase missing", erase("nope"));
  for (i = 0; i < NKEYS; i++) {
    if (lookup(keys[i], &v)) { found++; sum = sum * 7u + (unsigned)v; puts_(keys[i]); putch('='); puti(v); putch(' '); }
  }
  nl();
  show("found", found);
  for (i = 0; i < NKEYS; i += 4) insert(keys[i], -i);
  show("reinserted count", count);
  for (i = 0; i < CAP; i++) putch(table[i].state == USED ? '#' : table[i].state == DELETED ? 'x' : '.');
  nl();
  for (i = 0; i < NKEYS; i++) if (lookup(keys[i], &v)) sum += (unsigned)v;
  showu("sum", sum);
  showu("probes", probes);
  return (int)((sum + probes) & 0xff);
}
