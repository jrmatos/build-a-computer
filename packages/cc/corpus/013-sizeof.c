/* 013-sizeof: sizes of scalar types, arrays, padded structs, unions, pointers, expressions (ilp32) */
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

struct s1 { char c; int i; };
struct s2 { char a; char b; short s; };
struct s3 { char c; short s; char d; };
struct s4 { int i; char c; };
struct s5 { char name[5]; struct s3 inner; int *p; };
union u1 { char c[5]; int i; };
union u2 { short s; char c; };
enum e1 { E_A, E_B, E_C };
typedef int row4[4];

static int garr[10];
static int grid[3][7];

static int ptr_size(int *p) { return (int)sizeof(p) + (int)sizeof(*p); }

int main(void) {
  int sum = 0, i = 5, k;
  char c = 'x';
  short sh = 1;
  row4 r;
  int sizes[32];
  int n = 0;
  sizes[n++] = (int)sizeof(char);
  sizes[n++] = (int)sizeof(signed char);
  sizes[n++] = (int)sizeof(unsigned char);
  sizes[n++] = (int)sizeof(short);
  sizes[n++] = (int)sizeof(unsigned short);
  sizes[n++] = (int)sizeof(int);
  sizes[n++] = (int)sizeof(unsigned);
  sizes[n++] = (int)sizeof(long);
  sizes[n++] = (int)sizeof(unsigned long);
  sizes[n++] = (int)sizeof(char *);
  sizes[n++] = (int)sizeof(int **);
  sizes[n++] = (int)sizeof(void (*)(void));
  sizes[n++] = (int)sizeof(struct s1);
  sizes[n++] = (int)sizeof(struct s2);
  sizes[n++] = (int)sizeof(struct s3);
  sizes[n++] = (int)sizeof(struct s4);
  sizes[n++] = (int)sizeof(struct s5);
  sizes[n++] = (int)sizeof(union u1);
  sizes[n++] = (int)sizeof(union u2);
  sizes[n++] = (int)sizeof(enum e1);
  sizes[n++] = (int)sizeof garr;
  sizes[n++] = (int)(sizeof garr / sizeof garr[0]);
  sizes[n++] = (int)sizeof grid;
  sizes[n++] = (int)sizeof grid[0];
  sizes[n++] = (int)sizeof r;
  sizes[n++] = (int)sizeof(row4[2]);
  sizes[n++] = (int)sizeof "hello";
  sizes[n++] = (int)sizeof "a\0b";
  sizes[n++] = (int)sizeof(struct s1[3]);
  for (k = 0; k < n; k++) {
    puts_("size["); puti(k); puts_("] = "); puti(sizes[k]); nl();
    sum = sum * 3 + sizes[k];
    sum &= 0xfffff;
  }
  show("sizeof c", (int)sizeof c);
  show("sizeof(c+1)", (int)sizeof(c + 1));
  show("sizeof(-c)", (int)sizeof(-c));
  show("sizeof(sh+sh)", (int)sizeof(sh + sh));
  show("sizeof 'a'", (int)sizeof 'a');
  show("sizeof(1?c:c)", (int)sizeof(1 ? c : c));
  show("sizeof(c=5) and c", (int)sizeof(c = 5) * 1000 + c);
  show("sizeof(i++)", (int)sizeof(i++));
  show("i unchanged", i);
  show("sizeof &garr", (int)sizeof &garr);
  show("sizeof *grid", (int)sizeof *grid);
  show("sizeof **grid", (int)sizeof **grid);
  show("sizeof garr[0]+1", (int)sizeof garr[0] + 1);
  show("ptr_size(garr)", ptr_size(garr));
  show("sum", sum);
  return sum & 0xff;
}
