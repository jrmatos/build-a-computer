/**
 * Inline assembly, attributes and machine-level C (what the OS levels need):
 * CSR access, ecall into a C trap handler, timer interrupts, naked functions,
 * sections and alignment.
 */
import { describe, expect, it } from 'vitest';
import { compileOk, run } from './test/harness';

const putu = `
static void putu(unsigned v) { char b[12]; int i = 0; do { b[i++] = '0' + v % 10; v /= 10; } while (v); while (i) *(volatile char *)0x10000000 = b[--i]; }
static void say(const char *s) { while (*s) *(volatile char *)0x10000000 = *s++; }
`;

describe('inline asm', () => {
  it('reads and writes CSRs with "r" operands', () => {
    const r = run(`
      int main(void) {
        unsigned x = 0x1234, y;
        __asm__ volatile("csrw mscratch, %0" :: "r"(x));
        __asm__ volatile("csrr %0, mscratch" : "=r"(y));
        return y == 0x1234 ? 7 : 1;
      }`);
    expect(r.exitCode).toBe(7);
    expect(r.asm).toMatch(/csrw mscratch, [st]\d+/);
  });

  it('supports "+r" operands, named operands, %z and immediates', () => {
    const r = run(`
      int main(void) {
        int v = 5, w = 0;
        asm("addi %0, %0, 10" : "+r"(v));
        asm("add %[out], %[a], %[b]" : [out] "=r"(w) : [a] "r"(v), [b] "r"(100));
        asm volatile("csrw mscratch, %z0" :: "rJ"(0));
        asm("addi %0, %1, %2" : "=r"(v) : "r"(w), "i"(-3));
        return v;
      }`);
    expect(r.exitCode).toBe(112);
    expect(r.asm).toContain('csrw mscratch, zero');
  });

  it('binds register variables (syscall convention) and honors clobbers', () => {
    const r = run(
      `
      ${putu}
      volatile int got;
      __attribute__((interrupt)) void handler(void) {
        unsigned epc, a0v, a7v;
        asm volatile("csrr %0, mepc" : "=r"(epc));
        asm volatile("lw %0, 0(sp)" : "=r"(a0v));
        got = 1;
        asm volatile("csrw mepc, %0" :: "r"(epc + 4));
        (void)a0v; (void)a7v;
      }
      static int syscall1(int n, int arg) {
        register int a0 asm("a0") = arg;
        register int a7 asm("a7") = n;
        asm volatile("ecall" : "+r"(a0) : "r"(a7) : "memory");
        return a0;
      }
      int main(void) {
        asm volatile("csrw mtvec, %0" :: "r"(handler));
        int r = syscall1(64, 41);
        say("got "); putu(got); say("\\n");
        return r + got;
      }`,
    );
    expect(r.uart).toBe('got 1\n');
    expect(r.exitCode).toBe(42);
    expect(r.asm).toContain('mret');
    expect(r.asm).toMatch(/mv a7, /);
  });

  it('runs a timer interrupt handler written in C (wfi + mtimecmp)', () => {
    const r = run(`
      ${putu}
      #define MTIME (*(volatile unsigned *)0x0200bff8)
      #define MTIMECMP_LO (*(volatile unsigned *)0x02004000)
      #define MTIMECMP_HI (*(volatile unsigned *)0x02004004)
      static volatile int ticks;
      __attribute__((interrupt("machine"))) static void on_trap(void) {
        unsigned cause;
        asm volatile("csrr %0, mcause" : "=r"(cause));
        if (cause == 0x80000007u) {
          ticks++;
          MTIMECMP_HI = 0xffffffffu;
        }
      }
      int main(void) {
        int i;
        asm volatile("csrw mtvec, %0" :: "r"(on_trap));
        asm volatile("csrs mie, %0" :: "r"(1 << 7));
        asm volatile("csrs mstatus, %0" :: "r"(1 << 3));
        for (i = 0; i < 3; i++) {
          MTIMECMP_HI = 0;
          MTIMECMP_LO = MTIME + 500;
          while (ticks == i) asm volatile("wfi");
        }
        say("ticks "); putu(ticks); say("\\n");
        return ticks;
      }`);
    expect(r.uart).toBe('ticks 3\n');
    expect(r.exitCode).toBe(3);
  });

  it('emits naked functions without prologue', () => {
    const r = run(`
      __attribute__((naked)) int forty_two(void) { asm volatile("li a0, 42\\n ret"); }
      int main(void) { return forty_two(); }`);
    expect(r.exitCode).toBe(42);
    const fn = r.asm.slice(r.asm.indexOf('forty_two:'), r.asm.indexOf('main:'));
    expect(fn).not.toContain('addi sp');
  });

  it('places code and data in sections and aligns globals', () => {
    const cc = compileOk(`
      __attribute__((section(".text.init"))) void boot(void) {}
      __attribute__((aligned(4096))) char page[4096];
      int table[4] __attribute__((aligned(16))) = { 1 };
      __attribute__((section(".data.special"))) int special = 3;`);
    expect(cc.asm).toContain('.section .text.init');
    expect(cc.asm).toMatch(/\.align 12\npage:/);
    expect(cc.asm).toMatch(/\.align 4\ntable:/);
    expect(cc.asm).toContain('.section .data.special');
    const r = run(`
      __attribute__((aligned(4096))) char page[100];
      char c = 1;
      __attribute__((aligned(64))) int x = 5;
      int main(void) { return ((unsigned)page % 4096 == 0) + ((unsigned)&x % 64 == 0) * 2 + c * 4; }`);
    expect(r.exitCode).toBe(7);
  });

  it('passes top-level asm through', () => {
    const r = run(`
      __asm__(".text\\n.globl seven\\nseven:\\n li a0, 7\\n ret");
      int seven(void);
      int main(void) { return seven() * 2; }`);
    expect(r.exitCode).toBe(14);
  });

  it('keeps volatile accesses (MMIO) in order and unmerged', () => {
    const cc = compileOk(`
      #define REG (*(volatile unsigned *)0x10000000)
      void f(void) { REG = 1; REG = 2; (void)REG; (void)REG; }`);
    const body = cc.asm.slice(cc.asm.indexOf('f:'));
    expect(body.match(/\bsb |\bsw /g)?.length).toBeGreaterThanOrEqual(2);
    expect(body.match(/\blw /g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts sfence.vma, wfi and fence in asm templates', () => {
    const cc = compileOk(`
      void flush(void) { asm volatile("sfence.vma zero, zero" ::: "memory"); asm volatile("fence"); }
      void idle(void) { asm volatile("wfi"); }`);
    expect(cc.asm).toContain('sfence.vma zero, zero');
    expect(cc.asm).toContain('wfi');
  });

  it('reports unknown asm operand references', () => {
    expect(() => compileOk(`void f(int x) { asm("mv a0, %3" :: "r"(x)); }`)).toThrow(/asm operand '%3'/);
  });
});
