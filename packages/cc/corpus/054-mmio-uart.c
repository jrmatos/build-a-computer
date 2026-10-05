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

#define UART_BASE 0x10000000u
#define UART_LSR ((volatile unsigned char *)0x10000005)
#define LSR_THRE 0x20

typedef volatile unsigned char vu8;

static vu8 *const uart_thr = (vu8 *)UART_BASE;
static volatile unsigned char *uart_ptr_var;

static void out_direct(char c) { *(volatile unsigned char *)0x10000000 = (unsigned char)c; }
static void out_typedef(char c) { *uart_thr = (unsigned char)c; }
static void out_var(char c) { *uart_ptr_var = (unsigned char)c; }
static void out_index(char c) { uart_ptr_var[0] = (unsigned char)c; }
static void out_from_int(char c) {
  unsigned long addr = UART_BASE;
  volatile unsigned char *p = (volatile unsigned char *)addr;
  *p = (unsigned char)c;
}
static void out_via_offset(char c) {
  volatile unsigned char *base = (volatile unsigned char *)(UART_BASE + 8u);
  *(base - 8) = (unsigned char)c;
}

typedef void (*writer)(char);
static const writer writers[] = { out_direct, out_typedef, out_var, out_index, out_from_int, out_via_offset };
static const char *writer_names[] = { "direct", "typedef", "var", "index", "from_int", "offset" };

static void write_str(writer w, const char *s) { while (*s) w(*s++); }

int main(void) {
  int i, j;
  unsigned char lsr;
  int thre_ok = 0;
  uart_ptr_var = (volatile unsigned char *)UART_BASE;
  for (i = 0; i < 30; i++) out_direct('=');
  out_direct('\n');
  for (i = 0; i < 6; i++) {
    write_str(writers[i], "| uart via ");
    write_str(writers[i], writer_names[i]);
    for (j = 0; j < 13 - (int)(i * 2 % 5); j++) writers[(i + j) % 6]('.');
    writers[i]('\n');
  }
  for (i = 0; i < 30; i++) out_typedef(i % 2 ? '-' : '=');
  out_typedef('\n');
  for (i = 0; i < 8; i++) {
    lsr = *UART_LSR;
    if (lsr & LSR_THRE) thre_ok++;
    out_var((char)('0' + ((lsr >> 5) & 1)));
  }
  out_var('\n');
  lsr = *UART_LSR;
  show("THRE", (lsr >> 5) & 1);
  show("thre reads ok", thre_ok);
  /* write every printable char once */
  for (i = 32; i < 127; i++) writers[i % 6]((char)i);
  nl();
  return thre_ok + 40;
}
