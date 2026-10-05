/**
 * Expected-vs-actual details for 'riscv' tests. The checker (`runRiscvTest`)
 * and the worker's debugger ("Debug this test") compare a machine with a
 * test's `expect` through `riscvChecks`, so the per-register, per-byte and
 * UART diffs the debugger shows live are the ones the test judges.
 */

import { sha256 } from '@build-a-computer/det';
import type { Machine } from '@build-a-computer/rv32';
import type { Level, TestSpec } from '@build-a-computer/schema';
import type { Program } from './build';
import { type RunSetup, SetupError, createMachine, hex32, parseHex, regIndex, runMachine, toHex } from './machine';

type RiscvSpec = Extract<TestSpec, { kind: 'riscv' }>;
type Expect = RiscvSpec['expect'];

/** One expectation of a test with its current value. */
export type RvCheck =
  | {
      kind: 'reg';
      name: string;
      /** Unsigned 32-bit. */
      expected: number;
      actual: number;
      ok: boolean;
    }
  | {
      kind: 'exit';
      expected: number;
      /** null until the program exits (or when it stopped another way). */
      actual: number | null;
      ok: boolean;
    }
  | {
      kind: 'memory';
      addr: number;
      /** Expected bytes, "0c 00 00 00". */
      expected: string;
      /** Current bytes at the same addresses, or null when the address is not memory. */
      actual: string | null;
      /** Index of the first wrong byte, -1 when all match. */
      firstBad: number;
      ok: boolean;
    }
  | {
      kind: 'uart';
      expected: string;
      actual: string;
      /** First differing character (the shorter length when one is a prefix of the other). */
      firstDiff: number;
      /** Characters cut from the front of both strings (clipped case results). */
      offset?: number;
      ok: boolean;
    }
  | { kind: 'framebuffer'; expected: string; actual: string | null; ok: boolean };

/** What `riscvChecks` reads from a machine (or a recorded run). */
export interface RvReadout {
  /** Register by ABI name, unsigned. */
  reg(name: string): number;
  /** Bytes at an address, or null when it is not memory. */
  readBytes(addr: number, length: number): Uint8Array | null;
  uart: string;
  /** Exit code when the program exited, else null. */
  exitCode: number | null;
  /** SHA-256 of the framebuffer pixels (computed only when the test checks it). */
  framebufferSha256(): string;
}

/** A readout of a live machine; `exitCode` comes from the caller (the stop event). */
export function machineReadout(m: Machine, exitCode: number | null): RvReadout {
  return {
    reg: (name) => m.hart.reg(regIndex(name) ?? 0) >>> 0,
    readBytes: (addr, length) => {
      try {
        return m.readBytes(addr, length);
      } catch {
        return null;
      }
    },
    uart: m.uart.output,
    exitCode,
    framebufferSha256: () => sha256(m.fbPixels.bytes),
  };
}

/** First index where two strings differ (the shorter length when one is a prefix of the other). */
export function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/** Every expectation of `expect`, in a fixed order: registers, exit code, memory, UART, framebuffer. */
export function riscvChecks(expect: Expect, r: RvReadout): RvCheck[] {
  const out: RvCheck[] = [];
  for (const [name, want] of Object.entries(expect.regs ?? {})) {
    const actual = r.reg(name);
    out.push({ kind: 'reg', name, expected: want >>> 0, actual, ok: actual === want >>> 0 });
  }
  if (expect.exitCode !== undefined) {
    const want = expect.exitCode >>> 0;
    out.push({ kind: 'exit', expected: want, actual: r.exitCode, ok: r.exitCode === want });
  }
  for (const want of expect.memory ?? []) {
    const bytes = parseHex(want.hex);
    const got = r.readBytes(want.addr, bytes.length);
    let firstBad = -1;
    if (!got) firstBad = 0;
    else
      for (let i = 0; i < bytes.length; i++)
        if (bytes[i] !== got[i]) {
          firstBad = i;
          break;
        }
    out.push({
      kind: 'memory',
      addr: want.addr >>> 0,
      expected: toHex(bytes),
      actual: got ? toHex(got) : null,
      firstBad,
      ok: firstBad < 0,
    });
  }
  if (expect.uart !== undefined) {
    const actual = r.uart;
    out.push({
      kind: 'uart',
      expected: expect.uart,
      actual,
      firstDiff: firstDiff(actual, expect.uart),
      ok: actual === expect.uart,
    });
  }
  if (expect.framebufferSha256 !== undefined) {
    const actual = r.framebufferSha256();
    out.push({ kind: 'framebuffer', expected: expect.framebufferSha256, actual, ok: actual === expect.framebufferSha256 });
  }
  return out;
}

/** "4294967295 (-1)" for values with the top bit set, else "55". */
export const showReg = (v: number): string => (v >= 0x80000000 ? `${v} (${v | 0})` : String(v));

/** Quote a string for a message, starting near `from` and cut at `max` characters. */
export function snippet(s: string, from: number, max = 40): string {
  const start = from > 20 ? from - 10 : 0;
  let t = s.slice(start, start + max);
  if (start + max < s.length) t += '…';
  return (start > 0 ? '…' : '') + JSON.stringify(t);
}

/**
 * The plain-English problem for a failing check (null when it passes).
 * `stopped` says how the run ended, for the exit-code message.
 */
export function checkProblem(c: RvCheck, opts: { isC: boolean; stopped?: 'exit' | 'ebreak' }): string | null {
  if (c.ok) return null;
  switch (c.kind) {
    case 'reg':
      return `${c.name} should be ${showReg(c.expected)} but is ${showReg(c.actual)}.`;
    case 'exit':
      if (c.actual === null)
        return `The program should exit with code ${c.expected} (${opts.isC ? 'return it from main' : 'li a7, 93 then ecall'}), but it ${opts.stopped === 'ebreak' ? 'stopped at ebreak' : 'has not exited'}.`;
      return `Exit code should be ${showReg(c.expected)} but is ${showReg(c.actual)}.`;
    case 'memory': {
      if (c.actual === null) return `The test reads memory at ${hex32(c.addr)}, which is not memory.`;
      const from = c.firstBad & ~3;
      const span = (hex: string): string => {
        const b = hex.split(' ');
        return b.slice(from, from + 8).join(' ') + (from + 8 < b.length ? ' …' : '');
      };
      return `Memory at ${hex32(c.addr + from)} should be ${span(c.expected)} but is ${span(c.actual)}.`;
    }
    case 'uart': {
      const i = c.firstDiff;
      return `UART output is wrong: expected ${snippet(c.expected, i)}, got ${snippet(c.actual, i)}.`;
    }
    case 'framebuffer':
      return 'The picture on the framebuffer is not the expected one.';
  }
}

/** UART text kept around the first difference in a case result. */
const UART_WINDOW = 400;

/** A copy of a check small enough for a case result: UART strings are cut around the first difference. */
export function clipCheck(c: RvCheck): RvCheck {
  if (c.kind !== 'uart') return c;
  const longest = Math.max(c.expected.length, c.actual.length);
  if (longest <= UART_WINDOW) return c;
  const offset = Math.max(0, c.firstDiff - UART_WINDOW / 4);
  return {
    ...c,
    expected: c.expected.slice(offset, offset + UART_WINDOW),
    actual: c.actual.slice(offset, offset + UART_WINDOW),
    offset: (c.offset ?? 0) + offset,
  };
}

/** What "Debug this test" loads: the test, its machine setup and its input. */
export interface RiscvDebugSetup {
  /** Index in `level.tests`. */
  index: number;
  test: RiscvSpec;
  /** "Test 2" or the test's name. */
  name: string;
  setup: RunSetup;
  /** Queued in the UART receiver and pressed into the keyboard before the first instruction. */
  input?: string;
  maxSteps: number;
}

/** The setup of `level.tests[index]`; undefined when it is not a 'riscv' test. */
export function riscvDebugSetup(level: Level, index: number): RiscvDebugSetup | undefined {
  const test = level.tests[index];
  if (!test || test.kind !== 'riscv') return undefined;
  return {
    index,
    test,
    name: test.name ?? `Test ${index + 1}`,
    setup: test.setup ?? {},
    ...(test.input ? { input: test.input } : {}),
    maxSteps: test.maxSteps ?? 5_000_000,
  };
}

/** Queue a test's input: the UART receiver gets the text, the keyboard one key per byte. */
export function applyInput(m: Machine, input: string | undefined): void {
  if (!input) return;
  m.uart.receive(input);
  for (const b of new TextEncoder().encode(input)) m.keyboard.press(b);
}

/** Throws SetupError when the test checks a register that does not exist. */
export function checkExpectRegs(expect: Expect): void {
  for (const name of Object.keys(expect.regs ?? {}))
    if (regIndex(name) === undefined) throw new SetupError(`The test checks an unknown register "${name}".`);
}

/** Most steps `lineHits` replays (it single-steps, so it is slower than a run). */
export const LINE_HITS_MAX_STEPS = 1_000_000;

/** How many times a line of the player's file ran. */
export interface LineHit {
  line: number;
  count: number;
}

/**
 * Replay a test's run from the start for `steps` steps (at most
 * LINE_HITS_MAX_STEPS) and count how many times each line of the player's
 * file ran (a line's count is how often its most-run instruction ran). Sorted by
 * line. Explains loops: "line 5 ran 9 times". Undefined when the setup fails.
 */
export function lineHits(program: Program, level: Level, setup: RunSetup, input: string | undefined, steps: number): LineHit[] | undefined {
  let m;
  try {
    m = createMachine(program, level, setup);
  } catch (e) {
    if (e instanceof SetupError) return undefined;
    throw e;
  }
  applyInput(m, input);
  const byPc = new Map<number, number>();
  const n = Math.min(steps, LINE_HITS_MAX_STEPS);
  for (let i = 0; i < n; i++) {
    const pc = m.hart.pc >>> 0;
    byPc.set(pc, (byPc.get(pc) ?? 0) + 1);
    const r = runMachine(m, 1);
    if (r.stop || r.reason === 'wfi') break;
  }
  // A line counts its most-run instruction (a C `for` line: the condition, not the init).
  const lines = new Map<number, number>();
  for (const [pc, count] of byPc) {
    const loc = program.locate(pc);
    if (!loc || loc.file !== program.mainFile) continue;
    lines.set(loc.line, Math.max(lines.get(loc.line) ?? 0, count));
  }
  return [...lines.entries()].map(([line, count]) => ({ line, count })).sort((a, b) => a.line - b.line);
}
