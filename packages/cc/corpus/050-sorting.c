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

#define N 64

static unsigned seed;
static unsigned lcg(void) { seed = seed * 1103515245u + 12345u; return (seed >> 16) & 0x7fff; }

static int orig[N];
static int a[N];
static int tmp[N];

static void fill(void) {
  int i;
  seed = 2024u;
  for (i = 0; i < N; i++) orig[i] = (int)(lcg() % 2000u) - 1000;
}
static void reset(void) { int i; for (i = 0; i < N; i++) a[i] = orig[i]; }
static void swap(int *x, int *y) { int t = *x; *x = *y; *y = t; }

static void bubble(int *v, int n) {
  int i, j, swapped;
  for (i = 0; i < n - 1; i++) {
    swapped = 0;
    for (j = 0; j < n - 1 - i; j++)
      if (v[j] > v[j + 1]) { swap(&v[j], &v[j + 1]); swapped = 1; }
    if (!swapped) break;
  }
}
static void insertion(int *v, int n) {
  int i, j, k;
  for (i = 1; i < n; i++) {
    k = v[i];
    for (j = i - 1; j >= 0 && v[j] > k; j--) v[j + 1] = v[j];
    v[j + 1] = k;
  }
}
static void selection(int *v, int n) {
  int i, j, m;
  for (i = 0; i < n - 1; i++) {
    m = i;
    for (j = i + 1; j < n; j++) if (v[j] < v[m]) m = j;
    if (m != i) swap(&v[i], &v[m]);
  }
}
static void quick(int *v, int lo, int hi) {
  int p, i, j;
  if (lo >= hi) return;
  p = v[lo + (hi - lo) / 2];
  i = lo; j = hi;
  while (i <= j) {
    while (v[i] < p) i++;
    while (v[j] > p) j--;
    if (i <= j) { swap(&v[i], &v[j]); i++; j--; }
  }
  quick(v, lo, j);
  quick(v, i, hi);
}
static void merge_sort(int *v, int lo, int hi) {
  int mid, i, j, k;
  if (hi - lo < 2) return;
  mid = lo + (hi - lo) / 2;
  merge_sort(v, lo, mid);
  merge_sort(v, mid, hi);
  i = lo; j = mid; k = lo;
  while (i < mid && j < hi) tmp[k++] = (v[i] <= v[j]) ? v[i++] : v[j++];
  while (i < mid) tmp[k++] = v[i++];
  while (j < hi) tmp[k++] = v[j++];
  for (k = lo; k < hi; k++) v[k] = tmp[k];
}

static int sorted(const int *v, int n) {
  int i;
  for (i = 1; i < n; i++) if (v[i - 1] > v[i]) return 0;
  return 1;
}
static unsigned checksum(const int *v, int n) {
  unsigned h = 0;
  int i;
  for (i = 0; i < n; i++) h = h * 31u + (unsigned)v[i];
  return h;
}
static void report(const char *name) {
  puts_(name); puts_(": sorted="); puti(sorted(a, N));
  puts_(" sum=0x"); putx(checksum(a, N));
  puts_(" min="); puti(a[0]); puts_(" max="); puti(a[N - 1]); nl();
}

int main(void) {
  unsigned total = 0;
  int i;
  fill();
  reset();
  showu("orig", checksum(a, N));
  show("orig sorted", sorted(a, N));
  reset(); bubble(a, N); report("bubble"); total ^= checksum(a, N);
  reset(); insertion(a, N); report("insertion"); total += checksum(a, N);
  reset(); selection(a, N); report("selection"); total ^= checksum(a, N);
  reset(); quick(a, 0, N - 1); report("quick"); total += checksum(a, N);
  reset(); merge_sort(a, 0, N); report("merge"); total ^= checksum(a, N);
  for (i = 0; i < N; i += 8) { puti(a[i]); putch(' '); }
  nl();
  /* already-sorted and reversed inputs */
  for (i = 0; i < N; i++) a[i] = N - i;
  quick(a, 0, N - 1); show("rev quick ok", sorted(a, N));
  for (i = 0; i < N; i++) a[i] = i % 3;
  merge_sort(a, 0, N); show("dups merge ok", sorted(a, N));
  insertion(a, N); show("sorted insertion ok", sorted(a, N));
  showu("total", total);
  return (int)(total & 0xff);
}
