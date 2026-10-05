/* 032-array-of-structs: table of records, linear search, sort by field (insertion sort) */
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

struct emp { int id; char name[8]; int salary; unsigned char dept; };

static struct emp table[8] = {
  { 17, "ada", 5200, 2 }, { 3, "bob", 4100, 1 }, { 42, "cyd", 6100, 3 }, { 8, "dee", 4100, 2 },
  { 25, "eve", 7300, 1 }, { 11, "fay", 3900, 3 }, { 30, "gus", 5200, 1 }, { 5, "hal", 4800, 2 }
};
#define NEMP 8

static void print_tab(void) {
  int i;
  for (i = 0; i < NEMP; i++) {
    puti(table[i].id); putch(':'); puts_(table[i].name); putch(':');
    puti(table[i].salary); putch(':'); putu(table[i].dept); putch(' ');
  }
  nl();
}

static struct emp *find_id(int id) {
  int i;
  for (i = 0; i < NEMP; i++) if (table[i].id == id) return &table[i];
  return 0;
}

static int find_name(const char *n) {
  int i, j;
  for (i = 0; i < NEMP; i++) {
    for (j = 0; n[j] && table[i].name[j] == n[j]; j++) ;
    if (n[j] == 0 && table[i].name[j] == 0) return i;
  }
  return -1;
}

/* sort by salary desc, ties by id asc (stable insertion sort) */
static int before(const struct emp *a, const struct emp *b) {
  if (a->salary != b->salary) return a->salary > b->salary;
  return a->id < b->id;
}
static void sort_tab(void) {
  int i, j;
  for (i = 1; i < NEMP; i++) {
    struct emp key = table[i];
    j = i - 1;
    while (j >= 0 && before(&key, &table[j])) { table[j + 1] = table[j]; j--; }
    table[j + 1] = key;
  }
}
static void sort_by_id(struct emp *t, int n) {
  int i, j;
  for (i = 1; i < n; i++)
    for (j = i; j > 0 && t[j - 1].id > t[j].id; j--) {
      struct emp tmp = t[j]; t[j] = t[j - 1]; t[j - 1] = tmp;
    }
}

int main(void) {
  struct emp *e;
  int i, dsum[4] = { 0, 0, 0, 0 };
  unsigned chk = 0;

  print_tab();
  e = find_id(42);
  show("find 42 idx", e ? (int)(e - table) : -1);
  show("find 99", find_id(99) != 0);
  show("find_name eve", find_name("eve"));
  show("find_name ev", find_name("ev"));
  show("find_name hal", find_name("hal"));
  e = find_id(8);
  e->salary += 1000;
  for (i = 0; i < NEMP; i++) dsum[table[i].dept] += table[i].salary;
  for (i = 1; i < 4; i++) show("dept sum", dsum[i]);

  sort_tab();
  print_tab();
  for (i = 0; i < NEMP; i++) chk = chk * 131u + (unsigned)table[i].id;
  showu("order chk", chk);
  show("top id", table[0].id);
  show("eve now at", find_name("eve"));

  sort_by_id(table + 2, 5);
  print_tab();
  sort_by_id(table, NEMP);
  print_tab();
  for (i = 0; i < NEMP; i++) chk = chk * 131u + (unsigned)table[i].id;
  showu("final chk", chk);
  return (int)(chk & 0xff);
}
