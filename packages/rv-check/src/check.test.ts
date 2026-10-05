import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { type RiscvTest, runRiscvTest } from './check';
import { EXIT_STUB_ADDR, buildProgram, createMachine, regIndex, runMachine } from './machine';

const level = (code: Record<string, unknown> = {}): Level =>
  Level.parse({
    id: 't',
    version: 1,
    track: 'sandbox',
    phase: 6,
    order: 0,
    title: 'T',
    goal: 'g',
    palette: [],
    starter: { parts: [], wires: [] },
    mode: 'code',
    code: { language: 'rv32-asm', ...code },
  });

const spec = (t: Record<string, unknown>): RiscvTest => TestSpec.parse({ kind: 'riscv', ...t }) as RiscvTest;

const run = (src: string, t: Record<string, unknown>, lvl = level(), opts = {}): CaseResult => {
  const out = [...runRiscvTest(src, spec(t), lvl, opts)];
  expect(out).toHaveLength(1);
  expect(out[0]!.kind).toBe('riscv');
  return out[0]!;
};

const SUM = `
.globl _start
_start:
  li a0, 0
  li t0, 1
  li t1, 11
loop:
  add a0, a0, t0
  addi t0, t0, 1
  bne t0, t1, loop
  ebreak
`;

describe('runRiscvTest', () => {
  it('passes a correct program and reports registers as decimal strings', () => {
    const r = run(SUM, { expect: { regs: { a0: 55, x6: 11 } } });
    expect(r.pass).toBe(true);
    expect(r.actual).toEqual({ a0: '55', x6: '11' });
    expect(r.expected).toEqual({ a0: 55, x6: 11 });
    expect(r.halted).toBe(true);
    expect(r.summary).toMatch(/^Ran \d+ instructions; stopped at ebreak \(line 11\)\.$/);
  });

  it('fails a wrong register with a clear message', () => {
    const r = run(SUM, { expect: { regs: { a0: 56 } } });
    expect(r.pass).toBe(false);
    expect(r.message).toBe('a0 should be 56 but is 55.');
    expect(r.actual.a0).toBe('55');
  });

  it('shows negative values in messages', () => {
    const r = run('li a0, -1\nebreak', { expect: { regs: { a0: 1 } } });
    expect(r.message).toBe('a0 should be 1 but is 4294967295 (-1).');
  });

  it('applies setup registers and memory pokes, and checks memory', () => {
    const src = `
      lw t0, 0(a1)
      lw t1, 4(a1)
      add t2, t0, t1
      sw t2, 8(a1)
      ebreak`;
    const t = {
      setup: { regs: { a1: 0x80010000 }, memory: [{ addr: 0x80010000, hex: '05000000 07000000' }] },
      expect: { memory: [{ addr: 0x80010008, hex: '0c 00 00 00' }] },
    };
    expect(run(src, t).pass).toBe(true);
    const bad = run(src, { ...t, expect: { memory: [{ addr: 0x80010008, hex: '0d000000' }] } });
    expect(bad.pass).toBe(false);
    expect(bad.message).toBe('Memory at 0x80010008 should be 0d 00 00 00 but is 0c 00 00 00.');
  });

  it('exit via ecall a7=93 reports the exit code', () => {
    const src = 'li a0, 3\nli a7, 93\necall';
    const ok = run(src, { expect: { exitCode: 3 } });
    expect(ok.pass).toBe(true);
    expect(ok.actual['exit code']).toBe('3');
    expect(ok.summary).toMatch(/exited with code 3/);
    const bad = run(src, { expect: { exitCode: 0 } });
    expect(bad.message).toBe('Exit code should be 0 but is 3.');
    const brk = run('ebreak', { expect: { exitCode: 0 } });
    expect(brk.pass).toBe(false);
    expect(brk.message).toMatch(/should exit with code 0/);
  });

  it('ret from _start exits with a0 (ra points at the exit stub)', () => {
    const r = run('_start:\n  li a0, 7\n  ret', { expect: { exitCode: 7 } });
    expect(r.pass).toBe(true);
  });

  it('sets sp to the top of RAM and ra to the exit stub', () => {
    const r = run('ebreak', { expect: { regs: { sp: 0x80000000 + 64 * 1024, ra: EXIT_STUB_ADDR } } }, level({ ramSize: 64 * 1024 }));
    expect(r.pass).toBe(true);
  });

  it('E-SIM-10: an infinite loop fails after maxSteps with a message suggesting an exit', () => {
    const r = run('li a0, 1\nloop: j loop', { maxSteps: 10_000, expect: { regs: { a0: 1 } } });
    expect(r.pass).toBe(false);
    expect(r.halted).toBe(false);
    expect(r.message).toMatch(/never stopped.*line 2.*ebreak/);
  });

  it('E-SIM-10: the wall-clock budget ends a long run', () => {
    let t = 0;
    const r = run('loop: j loop', { maxSteps: 200_000_000, expect: {} }, level(), { now: () => (t += 1000), budgetMs: 5000 });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/ran out of time/);
  });

  it('E-CPU-08: an illegal instruction names its line and word', () => {
    const r = run('nop\n.word 0xffffffff\nebreak', { expect: {} });
    expect(r.pass).toBe(false);
    expect(r.message).toBe('Illegal instruction 0xffffffff at line 2 (pc 0x80000004): the CPU cannot run that word.');
  });

  it('E-CPU-08: running off the end of the code says to add an exit', () => {
    const r = run('li a0, 1', { expect: {} });
    expect(r.message).toMatch(/ran past the end of its code.*ebreak/);
  });

  it('E-CPU-05: a misaligned load is a trap with the address', () => {
    const r = run('li t0, 0x80000002\nlw a0, 0(t0)\nebreak', { expect: {} });
    expect(r.message).toMatch(/^Misaligned load at line 2 \(lw a0, 0\(t0\)\): address 0x80000002/);
  });

  it('E-CPU-09: an access outside memory names the address', () => {
    const r = run('li t0, 0x40000000\nsw zero, 0(t0)\nebreak', { expect: {} });
    expect(r.message).toMatch(/^Store access fault at line 2 .*0x40000000/);
  });

  it('an ecall other than exit, with no handler, explains the convention', () => {
    const r = run('li a7, 64\necall', { expect: {} });
    expect(r.message).toMatch(/a7 = 64: no trap handler.*exit \(a7 = 93\)/);
  });

  it('a program with its own trap handler handles the misaligned load itself', () => {
    const src = `
_start:
  la t0, handler
  csrw mtvec, t0
  li t1, 0x80000002
  lw a0, 0(t1)
  li a7, 93
  ecall
handler:
  li a0, 42
  csrr t2, mepc
  addi t2, t2, 4
  csrw mepc, t2
  mret`;
    const r = run(src, { expect: { exitCode: 42 } });
    expect(r.message).toBeUndefined();
    expect(r.pass).toBe(true);
  });

  const ECHO = `
.equ UART, 0x10000000
_start:
  li s0, UART
wait:
  lbu t0, 5(s0)      # LSR: bit 0 = data ready
  andi t0, t0, 1
  beqz t0, done
  lbu t1, 0(s0)
  addi t1, t1, -32   # upper-case
  sb t1, 0(s0)
  j wait
done:
  ebreak`;

  it('UART echo program reads the input and prints exactly', () => {
    expect(run(ECHO, { input: 'abc', expect: { uart: 'ABC' } }).pass).toBe(true);
    const bad = run(ECHO, { input: 'abc', expect: { uart: 'ABD' } });
    expect(bad.pass).toBe(false);
    expect(bad.message).toBe('UART output is wrong: expected "ABD", got "ABC".');
  });

  it('the keyboard device also receives the input', () => {
    const src = `
      li s0, 0x10001000
      lw t0, 0(s0)
      lw a0, 4(s0)
      ebreak`;
    expect(run(src, { input: 'Z', expect: { regs: { t0: 1, a0: 90 } } }).pass).toBe(true);
  });

  it('long UART mismatches show the part around the first difference', () => {
    const src = `
_start:
  la a1, msg
  li s0, 0x10000000
1: lbu t0, 0(a1)
  beqz t0, 2f
  sb t0, 0(s0)
  addi a1, a1, 1
  j 1b
2: ebreak
.data
msg: .asciz "The quick brown fox jumps over the lazy dog"`;
    const r = run(src, { expect: { uart: 'The quick brown fox jumps over the lazy cat' } });
    expect(r.message).toBe('UART output is wrong: expected …" the lazy cat", got …" the lazy dog".');
  });

  it('checks the framebuffer hash over 64,000 pixel bytes', () => {
    const src = `
      li t0, 0x20000000
      li t1, 64000
      li t2, 4
1:    sb t2, 0(t0)
      addi t0, t0, 1
      addi t1, t1, -1
      bnez t1, 1b
      ebreak`;
    const want = createHash('sha256').update(new Uint8Array(64000).fill(4)).digest('hex');
    expect(run(src, { expect: { framebufferSha256: want } }).pass).toBe(true);
    const r = run(src, { expect: { framebufferSha256: '0'.repeat(64) } });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/framebuffer/);
  });

  it('links level library files with the player source', () => {
    const lib = `
.globl double
double:
  add a0, a0, a0
  ret`;
    const src = `
.globl _start
_start:
  li a0, 21
  call double
  li a7, 93
  ecall`;
    const r = run(src, { expect: { exitCode: 42 } }, level({ library: [{ name: 'lib.s', text: lib }] }));
    expect(r.pass).toBe(true);
    const bad = run('call missing\nebreak', { expect: {} }, level({ library: [{ name: 'lib.s', text: lib }] }));
    expect(bad.message).toMatch(/^The program does not assemble/);
  });

  it('assembly errors fail the case with file and line numbers', () => {
    const r = run('nop\n  addd a0, a0, a0\nli a0', { expect: {} });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/^The program does not assemble \(\d+ errors?\):\nmain\.s:2:3: /);
    expect(r.summary).toBe('Not run: assembly errors.');
  });

  it('a trap inside a library names the library file', () => {
    const r = run('call boom\nebreak', { expect: {} }, level({ library: [{ name: 'lib.s', text: '.globl boom\nboom:\n  .word 0\n' }] }));
    expect(r.message).toMatch(/at lib\.s line 3/);
  });

  it('unknown register names in the test are reported', () => {
    expect(run('ebreak', { expect: { regs: { q9: 1 } } }).message).toMatch(/unknown register "q9"/);
    expect(run('ebreak', { setup: { regs: { foo: 1 } }, expect: {} }).message).toMatch(/unknown register "foo"/);
  });

  it('E-CPU-11: wfi with nothing to wake it fails instead of hanging', () => {
    const r = run('wfi\nebreak', { expect: {} });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/waiting \(wfi\) at line 1/);
  });
});

describe('machine helpers', () => {
  it('maps ABI and xN register names', () => {
    expect(regIndex('zero')).toBe(0);
    expect(regIndex('fp')).toBe(8);
    expect(regIndex('s0')).toBe(8);
    expect(regIndex('a7')).toBe(17);
    expect(regIndex('t6')).toBe(31);
    expect(regIndex('x31')).toBe(31);
    expect(regIndex('x32')).toBeUndefined();
  });

  it('runMachine reports a stop event at the stopping pc', () => {
    const lvl = level();
    const link = buildProgram('nop\nebreak', lvl);
    const m = createMachine(link, lvl);
    const r = runMachine(m, 100);
    expect(r.stop).toEqual({ kind: 'ebreak', pc: 0x80000004 });
    expect(m.hart.pc).toBe(0x80000004);
  });
});
