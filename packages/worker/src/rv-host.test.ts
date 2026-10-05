import { describe, expect, it } from 'vitest';
import { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { SimHost } from './host';
import type { RvSnapshot } from './protocol';

const level = (code: Record<string, unknown> = {}, tests: unknown[] = []): Level =>
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
    tests: tests.map((t) => TestSpec.parse(t)),
  });

/** A host with a fake clock (+1 ms per read) and a manual scheduler. */
function makeHost() {
  let clock = 0;
  const queue: (() => void)[] = [];
  const host = new SimHost(
    () => (clock += 1),
    (fn) => {
      queue.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
  const snaps: RvSnapshot[] = [];
  host.rvSubscribe((s) => snaps.push(s));
  /** Run scheduled slices until idle (or `max` slices). */
  const pump = (max = 1000): number => {
    let n = 0;
    while (queue.length && n < max) {
      queue.shift()!();
      n++;
    }
    return n;
  };
  const last = (): RvSnapshot => snaps.at(-1)!;
  return { host, pump, last, snaps, queue };
}

const SUM = `.globl _start
_start:
  li a0, 0          # line 3
  li t0, 1
  li t1, 11
loop:
  add a0, a0, t0    # line 7
  addi t0, t0, 1
  bne t0, t1, loop
  li a7, 93         # line 10
  ecall
`;

describe('RvHost (RvApi through SimHost)', () => {
  it('rvLoad returns diagnostics with 1-based ranges and the file name', () => {
    const { host } = makeHost();
    const r = host.rvLoad('nop\n  addd a0, a0, a0\n', level());
    expect(r.ok).toBe(false);
    const d = r.diagnostics[0]!;
    expect(d).toMatchObject({ file: 'main.s', line: 2, column: 3, endLine: 2, severity: 'error' });
    expect(d.endColumn).toBeGreaterThan(d.column);
    const lib = host.rvLoad('call f\nebreak', level({ library: [{ name: 'lib.s', text: '.globl f\nf: bogus\n' }] }));
    expect(lib.ok).toBe(false);
    expect(lib.diagnostics[0]).toMatchObject({ file: 'lib.s', line: 2 });
  });

  it('rvLoad returns symbols and the entry; the state starts at the entry with sp at top of RAM', () => {
    const { host, last } = makeHost();
    const r = host.rvLoad(SUM, level({ ramSize: 64 * 1024 }));
    expect(r.ok).toBe(true);
    expect(r.entry).toBe(0x80000000);
    expect(r.symbols).toEqual(expect.arrayContaining([{ name: '_start', addr: 0x80000000 }, { name: 'loop', addr: 0x8000000c }]));
    const s = last().state;
    expect(s.pc).toBe(0x80000000);
    expect(s.line).toBe(3);
    expect(s.file).toBe('main.s');
    expect(s.regs[2]).toBe(0x80010000);
    expect(s.running).toBe(false);
    expect(s.csrs).toMatchObject({ mstatus: 0, mtvec: 0, mepc: 0, mcause: 0, mtval: 0, mie: 0, mip: 0, satp: 0 });
  });

  it('runs to exit and reports the exit code', () => {
    const { host, pump, last, snaps } = makeHost();
    host.rvLoad(SUM, level());
    host.rvRun();
    expect(snaps.some((x) => x.state.running)).toBe(true);
    pump();
    const s = last().state;
    expect(s.running).toBe(false);
    expect(s.reason).toBe('exit');
    expect(s.exitCode).toBe(55);
    expect(s.regs[10]).toBe(55);
    // Finished: run does nothing until a reset.
    host.rvRun();
    expect(last().state.running).toBe(false);
    host.rvReset();
    expect(last().state.pc).toBe(0x80000000);
    expect(last().state.reason).toBeUndefined();
    expect(last().state.exitCode).toBeUndefined();
  });

  it('stops at a breakpoint by line, then continues to the next hit', () => {
    const { host, pump, last } = makeHost();
    host.rvLoad(SUM, level());
    host.rvSetBreakpoints([7]);
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'breakpoint', line: 7, running: false });
    expect(last().state.regs[10]).toBe(0);
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'breakpoint', line: 7 });
    expect(last().state.regs[10]).toBe(1);
    host.rvSetBreakpoints([]);
    host.rvRun();
    pump();
    expect(last().state.reason).toBe('exit');
  });

  it('a breakpoint on a comment line breaks at the next line with code', () => {
    const { host, pump, last } = makeHost();
    host.rvLoad('# start\nnop\nli a0, 1\nebreak', level());
    host.rvSetBreakpoints([1]);
    host.rvRun();
    pump();
    // Line 2 is the first instruction; resuming skips the breakpoint we start on.
    expect(last().state.reason).toBe('ebreak');
    host.rvReset();
    host.rvSetBreakpoints([3]);
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'breakpoint', line: 3 });
  });

  it('rvStep executes n instructions; rvStepLine moves to the next source line', () => {
    const { host, last } = makeHost();
    host.rvLoad('_start:\n  li a0, 0x12345678\n  li a1, 2\n  call f\n  ebreak\nf:\n  addi a1, a1, 1\n  ret\n', level());
    host.rvStep(1); // li with a large value is two instructions: still on line 2
    expect(last().state).toMatchObject({ reason: 'step', line: 2 });
    host.rvStepLine();
    expect(last().state).toMatchObject({ reason: 'step', line: 3 });
    expect(last().state.regs[10]).toBe(0x12345678);
    host.rvStepLine();
    expect(last().state.line).toBe(4);
    host.rvStepLine(); // into the call
    expect(last().state.line).toBe(7);
    host.rvStepLine();
    expect(last().state.line).toBe(8);
    host.rvStepLine(); // ret back to the caller
    expect(last().state.line).toBe(5);
    expect(last().state.regs[11]).toBe(3);
    host.rvStep(1);
    expect(last().state.reason).toBe('ebreak');
  });

  it('E-SIM-10: pause works during an infinite loop', () => {
    const { host, pump, last, queue } = makeHost();
    host.rvLoad('li a0, 1\nloop: addi a0, a0, 1\nj loop', level());
    host.rvRun();
    expect(pump(5)).toBe(5);
    expect(queue.length).toBe(1); // still scheduled: never blocks
    expect(last().state.running).toBe(true);
    host.rvPause();
    pump();
    const s = last().state;
    expect(s).toMatchObject({ running: false, reason: 'paused' });
    expect(s.instret).toBeGreaterThan(1000);
    expect([2, 3]).toContain(s.line);
  });

  it('step-line on a line that loops forever can be paused', () => {
    const { host, pump, last } = makeHost();
    host.rvLoad('loop: j loop', level());
    host.rvStepLine();
    pump(3);
    expect(last().state.running).toBe(true);
    host.rvPause();
    expect(last().state.reason).toBe('paused');
  });

  it('echoes UART input; wfi waits and input resumes the run', () => {
    const src = `
.equ UART, 0x10000000
_start:
  li s0, UART
  li t0, 1
  sb t0, 1(s0)          # IER: interrupt on received data
  li t0, 0x0c000000
  li t1, 1
  sw t1, 40(t0)         # PLIC priority of source 10 (UART)
  li t2, 0x0c002000
  li t1, 0x400
  sw t1, 0(t2)          # enable source 10 for hart 0 M-mode
  li t1, 0x800
  csrw mie, t1          # MEIE (global MIE stays off: wfi just wakes)
wait:
  wfi
  lbu t0, 5(s0)
  andi t0, t0, 1
  beqz t0, wait
  lbu t1, 0(s0)
  li t2, 10
  beq t1, t2, done
  sb t1, 0(s0)
  j wait
done:
  ebreak
`;
    const { host, pump, last } = makeHost();
    expect(host.rvLoad(src, level()).ok).toBe(true);
    host.rvRun();
    pump();
    // Parked in wfi: pc already points at the next instruction.
    expect(last().state).toMatchObject({ reason: 'wfi', running: false, line: 17 });
    host.rvInput('hi');
    pump();
    expect(last().uart).toBe('hi');
    expect(last().state.reason).toBe('wfi');
    host.rvInput('!\n');
    pump();
    expect(last().uart).toBe('hi!');
    expect(last().state.reason).toBe('ebreak');
  });

  it('an unhandled trap stops with a plain-English message', () => {
    const { host, pump, last } = makeHost();
    host.rvLoad('nop\n.word 0xffffffff\n', level());
    host.rvRun();
    pump();
    const s = last().state;
    expect(s.reason).toBe('trap');
    expect(s.trap).toMatchObject({ cause: 2, tval: 0xffffffff });
    expect(s.trap!.message).toMatch(/Illegal instruction 0xffffffff at line 2/);
    expect(s.pc).toBe(0x80000004);
  });

  it('framebuffer: pixels + RGBA palette, fbVersion bumps on writes; null without the device', () => {
    const src = `
  li t0, 0x20000000
  li t1, 9
  sb t1, 0(t0)
  ebreak
  li t0, 0x10003400
  li t1, 0x00112233
  sw t1, 0(t0)       # palette entry 0
  ebreak`;
    const { host, last } = makeHost();
    host.rvLoad(src, level());
    expect(host.rvFramebuffer()).toBeNull();
    host.rvLoad(src, level({ devices: ['uart', 'framebuffer'] }));
    const v0 = last().fbVersion;
    host.rvStep(2);
    expect(last().fbVersion).toBe(v0);
    host.rvStep(1);
    expect(last().fbVersion).toBe(v0 + 1);
    const fb = host.rvFramebuffer()!;
    expect(fb.pixels.length).toBe(64_000);
    expect(fb.pixels[0]).toBe(9);
    expect(fb.palette[15]).toBe(0xffffffff);
    host.rvStep(10);
    expect(last().state.reason).toBe('ebreak');
    host.rvStep(10);
    expect(last().state.reason).toBe('ebreak');
    expect(last().fbVersion).toBe(v0 + 2);
    expect(host.rvFramebuffer()!.palette[0]).toBe(0x112233ff);
  });

  it('rvMemory reads RAM and returns zeros for device windows', () => {
    const { host } = makeHost();
    host.rvLoad('ebreak\n.data\nv: .word 0x11223344', level());
    const ram = host.rvMemory(0x80000004, 4);
    expect(Array.from(ram)).toEqual([0x44, 0x33, 0x22, 0x11]);
    expect(Array.from(host.rvMemory(0x10000000, 4))).toEqual([0, 0, 0, 0]);
  });

  it('applies the first riscv test setup to the debug machine', () => {
    const { host, last } = makeHost();
    host.rvLoad('ebreak', level({}, [{ kind: 'riscv', setup: { regs: { a0: 5 } }, expect: {} }]));
    expect(last().state.regs[10]).toBe(5);
  });

  it('the uart tail keeps the last 64 KiB', () => {
    const { host, pump, last } = makeHost();
    const src = `
  li s0, 0x10000000
  li t0, 70000
  li t1, 65
1: sb t1, 0(s0)
  addi t0, t0, -1
  bnez t0, 1b
  li t1, 66
  sb t1, 0(s0)
  ebreak`;
    host.rvLoad(src, level());
    host.rvRun();
    pump();
    expect(last().uart.length).toBe(64 * 1024);
    expect(last().uart.endsWith('AB')).toBe(true);
  });
});

describe('SimHost.runTests for code levels', () => {
  it('runs riscv tests with the source and tags each case with its test index', async () => {
    const { host } = makeHost();
    const lvl = level({}, [
      { kind: 'riscv', name: 'sum', expect: { exitCode: 55 } },
      { kind: 'riscv', expect: { regs: { a0: 1 } } },
    ]);
    const seen: CaseResult[] = [];
    const res = await host.runTests(lvl, async (r) => {
      seen.push(r);
    }, undefined, 10_000, SUM);
    expect(res).toEqual({ passed: 1, total: 2 });
    expect(seen.map((c) => [c.test, c.kind, c.pass])).toEqual([[0, 'riscv', true], [1, 'riscv', false]]);
    expect(seen[1]!.message).toBe('a0 should be 1 but is 55.');
  });

  it('an empty source fails with a message instead of throwing', async () => {
    const { host } = makeHost();
    const seen: CaseResult[] = [];
    const res = await host.runTests(level({}, [{ kind: 'riscv', expect: { exitCode: 0 } }]), (r) => {
      seen.push(r);
    });
    expect(res).toEqual({ passed: 0, total: 1 });
    expect(seen[0]!.pass).toBe(false);
  });
});
