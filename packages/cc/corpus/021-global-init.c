/* 021-global-init: initialized/zeroed globals, partial array init, string arrays, address initializers, structs */
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

struct rec { int id; char tag; int vals[3]; const char *name; };

int gx = 42;
int gneg = -7;
unsigned gu = 0xdeadbeefu;
int garr[8] = {1, 2, 3};
int gmat[3][3] = {{1}, {2, 3}, {4, 5, 6}};
char gmsg[] = "hello";
char gbuf[10] = "hi";
const char *gstr = "literal";
const char *gwords[] = {"zero", "one", "two", "three"};
int *gp = &gx;
int *gpa = &garr[2];
char *gpc = gmsg + 1;
struct rec grec = {7, 'q', {4, 5}, "rec7"};
struct rec grecs[2] = {{1, 'a', {1, 1, 1}, "first"}, {2, 'b', {2}, 0}};
struct rec *grp = &grecs[1];
int bss_arr[16];
static int sbss;
static char sbss_buf[5];
short gshort = -2;
unsigned char guc = 255;
signed char gsc = -1;
long glong = -100000L;

int main(void) {
  int i, j, s = 0;
  show("gx", gx); show("gneg", gneg); showu("gu", gu);
  for (i = 0; i < 8; i++) { puti(garr[i]); putch(' '); s += garr[i] * (i + 1); }
  nl();
  for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) { puti(gmat[i][j]); putch(j == 2 ? '\n' : ' '); s += gmat[i][j] << i; }
  puts_(gmsg); nl();
  show("sizeof gmsg", (int)sizeof gmsg);
  show("gmsg[5]", gmsg[5]);
  puts_(gbuf); nl();
  for (i = 0; i < 10; i++) s += gbuf[i];
  show("gbuf[9]", gbuf[9]);
  puts_(gstr); nl();
  for (i = 0; i < 4; i++) { puts_(gwords[i]); putch(' '); }
  nl();
  show("*gp", *gp);
  *gp += 1;
  show("gx after *gp+=1", gx);
  show("*gpa", *gpa);
  show("gpa-garr", (int)(gpa - garr));
  puts_(gpc); nl();
  show("grec.id", grec.id); show("grec.tag", grec.tag);
  show("grec.vals[1]", grec.vals[1]); show("grec.vals[2]", grec.vals[2]);
  puts_(grec.name); nl();
  show("grecs[0].vals[2]", grecs[0].vals[2]);
  show("grp->id", grp->id);
  show("grp->vals[1]", grp->vals[1]);
  show("grp->name==0", grp->name == 0);
  puts_(grecs[0].name); nl();
  for (i = 0; i < 16; i++) s += bss_arr[i];
  show("bss sum", s);
  show("sbss", sbss);
  for (i = 0; i < 5; i++) s += sbss_buf[i];
  bss_arr[3] = 9; sbss = 4;
  show("bss_arr[3]", bss_arr[3]);
  show("gshort", gshort); show("guc", guc); show("gsc", gsc); show("glong", (int)glong);
  s += gshort + guc + gsc + (int)(glong % 1000) + sbss;
  show("s", s);
  return s & 0xff;
}
