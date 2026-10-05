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

enum op { OP_PUSH, OP_ADD, OP_SUB, OP_MUL, OP_JMP, OP_JZ, OP_DUP, OP_PRINT,
          OP_POP, OP_SWAP, OP_OVER, OP_LOAD, OP_STORE, OP_HALT };

static const char *op_names[] = { "push", "add", "sub", "mul", "jmp", "jz", "dup", "print",
                                  "pop", "swap", "over", "load", "store", "halt" };

struct vm { int stack[64]; int sp; int vars[8]; unsigned steps; unsigned counts[14]; };

static int pop(struct vm *m) { return m->stack[--m->sp]; }
static void push(struct vm *m, int v) { m->stack[m->sp++] = v; }

static int run(struct vm *m, const int *code, int len) {
  int pc = 0;
  m->sp = 0;
  while (pc < len) {
    int op = code[pc++];
    int a, b;
    m->steps++;
    m->counts[op]++;
    switch (op) {
    case OP_PUSH: push(m, code[pc++]); break;
    case OP_ADD: b = pop(m); a = pop(m); push(m, (int)((unsigned)a + (unsigned)b)); break;
    case OP_SUB: b = pop(m); a = pop(m); push(m, (int)((unsigned)a - (unsigned)b)); break;
    case OP_MUL: b = pop(m); a = pop(m); push(m, (int)((unsigned)a * (unsigned)b)); break;
    case OP_JMP: pc = code[pc]; break;
    case OP_JZ: a = pop(m); if (a == 0) pc = code[pc]; else pc++; break;
    case OP_DUP: a = pop(m); push(m, a); push(m, a); break;
    case OP_PRINT: puti(pop(m)); nl(); break;
    case OP_POP: (void)pop(m); break;
    case OP_SWAP: b = pop(m); a = pop(m); push(m, b); push(m, a); break;
    case OP_OVER: b = pop(m); a = pop(m); push(m, a); push(m, b); push(m, a); break;
    case OP_LOAD: push(m, m->vars[code[pc++]]); break;
    case OP_STORE: m->vars[code[pc++]] = pop(m); break;
    case OP_HALT: return 0;
    default: return -1;
    }
  }
  return 1;
}

/* factorial of 1..12: v0 = n, v1 = acc, v2 = i */
static const int fact_prog[] = {
  OP_PUSH, 1, OP_STORE, 0,             /* 0: n = 1 */
  OP_PUSH, 1, OP_STORE, 1,             /* 4: acc = 1 */
  OP_LOAD, 0, OP_STORE, 2,             /* 8: i = n */
  OP_LOAD, 2, OP_JZ, 32,               /* 12: while i */
  OP_LOAD, 1, OP_LOAD, 2, OP_MUL, OP_STORE, 1, /* 16: acc *= i */
  OP_LOAD, 2, OP_PUSH, 1, OP_SUB, OP_STORE, 2, OP_JMP, 12, /* 23 */
  OP_LOAD, 1, OP_PRINT,                /* 32: print acc */
};

int main(void) {
  static struct vm m;
  static int code[128];
  int len = 0, i, r;
  unsigned sum = 0;
  /* build fib program dynamically: a=0 b=1, repeat 20: print a; (a,b)=(b,a+b) */
  code[len++] = OP_PUSH; code[len++] = 0; code[len++] = OP_STORE; code[len++] = 0;
  code[len++] = OP_PUSH; code[len++] = 1; code[len++] = OP_STORE; code[len++] = 1;
  code[len++] = OP_PUSH; code[len++] = 20; code[len++] = OP_STORE; code[len++] = 3;
  i = len; /* loop top */
  code[len++] = OP_LOAD; code[len++] = 3; code[len++] = OP_JZ; code[len++] = 0; /* patched */
  r = len - 1;
  code[len++] = OP_LOAD; code[len++] = 0; code[len++] = OP_DUP; code[len++] = OP_PRINT;
  code[len++] = OP_LOAD; code[len++] = 1; code[len++] = OP_DUP; code[len++] = OP_STORE; code[len++] = 0;
  code[len++] = OP_ADD; code[len++] = OP_STORE; code[len++] = 1;
  code[len++] = OP_LOAD; code[len++] = 3; code[len++] = OP_PUSH; code[len++] = 1; code[len++] = OP_SUB;
  code[len++] = OP_STORE; code[len++] = 3;
  code[len++] = OP_JMP; code[len++] = i;
  code[r] = len;
  code[len++] = OP_LOAD; code[len++] = 1; code[len++] = OP_PUSH; code[len++] = 3;
  code[len++] = OP_OVER; code[len++] = OP_SWAP; code[len++] = OP_SUB; code[len++] = OP_PRINT;
  code[len++] = OP_POP; code[len++] = OP_HALT;
  puts_("fib:"); nl();
  r = run(&m, code, len);
  show("fib result", r);
  show("fib sp", m.sp);
  showu("fib steps", m.steps);
  sum += m.steps;

  /* factorials: wrap fact_prog in an outer driver by patching n */
  puts_("fact:"); nl();
  for (i = 1; i <= 13; i++) {
    int j, flen = (int)(sizeof(fact_prog) / sizeof(fact_prog[0]));
    for (j = 0; j < flen; j++) code[j] = fact_prog[j];
    code[1] = i;
    r = run(&m, code, flen);
    sum += (unsigned)m.vars[1];
  }
  showu("steps total", m.steps);
  for (i = 0; i < 14; i++) {
    if (m.counts[i]) { puts_(op_names[i]); putch('='); putu(m.counts[i]); putch(' '); }
  }
  nl();
  showu("sum", sum);
  return (int)(sum % 251u);
}
