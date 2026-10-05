/**
 * RV-07: run one 'riscv' test. Assemble + link the player's source with the
 * level's library files, run it on the RV32 machine until it stops, and
 * compare registers, memory, UART output, exit code and framebuffer.
 */

import { sha256 } from '@build-a-computer/det';
import type { Machine } from '@build-a-computer/rv32';
import type { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import {
  type StopEvent,
  SetupError,
  buildProgram,
  createMachine,
  formatDiag,
  hex32,
  parseHex,
  regIndex,
  runMachine,
  toHex,
  trapMessage,
  where,
} from './machine';

export type RiscvTest = Extract<TestSpec, { kind: 'riscv' }>;

export interface RiscvCheckOptions {
  /** Wall-clock budget in ms; time comes from `now` (no clock APIs in this package). */
  budgetMs?: number;
  now?: () => number;
}

/** Steps run between wall-clock checks. */
const CHUNK = 250_000;
/** Assembly errors listed in a failing case. */
const MAX_ERRORS = 5;

const fmt = (n: number): string => n.toLocaleString('en-US');

/** "4294967295 (-1)" for values with the top bit set, else "55". */
const showReg = (v: number): string => (v >= 0x80000000 ? `${v} (${v | 0})` : String(v));

/** Quote a string for a message, starting near `from` and cut at `max` characters. */
function snippet(s: string, from: number, max = 40): string {
  const start = from > 20 ? from - 10 : 0;
  let t = s.slice(start, start + max);
  if (start + max < s.length) t += '…';
  return (start > 0 ? '…' : '') + JSON.stringify(t);
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/**
 * Run one 'riscv' test and yield ONE CaseResult (kind 'riscv'). `expected` and
 * `actual` hold the checked registers (actual as unsigned decimal strings) and
 * 'exit code'; UART, memory and framebuffer problems are explained in
 * `message`. `summary` says how many instructions ran and how it ended.
 */
export function* runRiscvTest(
  source: string,
  test: RiscvTest,
  level: Level,
  opts: RiscvCheckOptions = {},
): Generator<CaseResult> {
  yield checkRiscv(source, test, level, opts);
}

function checkRiscv(source: string, test: RiscvTest, level: Level, opts: RiscvCheckOptions): CaseResult {
  const expect = test.expect;
  const expected: Record<string, number> = { ...(expect.regs ?? {}) };
  if (expect.exitCode !== undefined) expected['exit code'] = expect.exitCode;
  const base: CaseResult = {
    index: 0,
    pass: false,
    kind: 'riscv',
    inputs: { ...(test.setup?.regs ?? {}) },
    expected,
    actual: {},
  };
  const fail = (message: string, extra: Partial<CaseResult> = {}): CaseResult => ({ ...base, ...extra, pass: false, message });

  const link = buildProgram(source, level);
  if (!link.ok) {
    const errs = link.diagnostics.filter((d) => d.severity === 'error');
    const list = errs.slice(0, MAX_ERRORS).map(formatDiag).join('\n');
    const more = errs.length > MAX_ERRORS ? `\n…and ${errs.length - MAX_ERRORS} more.` : '';
    const n = errs.length;
    return fail(`The program does not assemble (${n} error${n === 1 ? '' : 's'}):\n${list}${more}`, {
      summary: 'Not run: assembly errors.',
    });
  }

  let m: Machine;
  try {
    m = createMachine(link, level, test.setup ?? {});
    for (const name of Object.keys(expect.regs ?? {}))
      if (regIndex(name) === undefined) throw new SetupError(`The test checks an unknown register "${name}".`);
  } catch (e) {
    if (e instanceof SetupError) return fail(e.message, { summary: 'Not run.' });
    throw e;
  }
  if (test.input) {
    m.uart.receive(test.input);
    for (const b of new TextEncoder().encode(test.input)) m.keyboard.press(b);
  }

  // Run until the program stops, the step budget ends (E-SIM-10), it waits
  // forever (E-CPU-11) or the wall-clock budget ends.
  const maxSteps = test.maxSteps ?? 5_000_000;
  const now = opts.now;
  const t0 = now?.() ?? 0;
  let steps = 0;
  let stop: StopEvent | undefined;
  let ended: 'steps' | 'wfi' | 'time' | undefined;
  for (;;) {
    const n = Math.min(CHUNK, maxSteps - steps);
    if (n <= 0) {
      ended = 'steps';
      break;
    }
    const r = runMachine(m, n);
    steps += r.steps;
    if (r.stop) {
      stop = r.stop;
      break;
    }
    if (r.reason === 'wfi') {
      ended = 'wfi';
      break;
    }
    if (now && opts.budgetMs !== undefined && now() - t0 > opts.budgetMs) {
      ended = 'time';
      break;
    }
  }

  const ran = m.hart.instret;
  const pc = m.hart.pc;
  const actual: Record<string, string> = {};
  const actualNum: Record<string, number | null> = {};
  for (const name of Object.keys(expect.regs ?? {})) {
    const v = m.hart.reg(regIndex(name)!);
    actual[name] = String(v);
    actualNum[name] = v;
  }
  if (stop?.kind === 'exit') {
    actual['exit code'] = String(stop.code);
    actualNum['exit code'] = stop.code;
  } else if (expect.exitCode !== undefined) actualNum['exit code'] = null;
  const halted = stop?.kind === 'exit' || stop?.kind === 'ebreak';
  const how =
    stop?.kind === 'exit'
      ? `exited with code ${stop.code}`
      : stop?.kind === 'ebreak'
        ? `stopped at ebreak (${where(link, stop.pc)})`
        : stop?.kind === 'trap'
          ? `trapped at ${where(link, stop.pc)}`
          : ended === 'wfi'
            ? `waiting for an interrupt at ${where(link, pc - 4)}`
            : `still running at ${where(link, pc)}`;
  const result = { ...base, actual, actualNum, halted, cycle: ran, summary: `Ran ${fmt(ran)} instructions; ${how}.` };

  // Problems that stop the run come first.
  if (stop?.kind === 'trap') return { ...result, message: trapMessage(m, link, stop) };
  if (ended === 'steps')
    return {
      ...result,
      message: `The program never stopped: it ran ${fmt(maxSteps)} steps and was still going at ${where(link, pc)}. Add an exit (li a7, 93 then ecall) or an ebreak where it should end.`,
    };
  if (ended === 'time')
    return {
      ...result,
      message: `The program ran out of time after ${fmt(ran)} instructions (still going at ${where(link, pc)}). Add an exit (li a7, 93 then ecall) or an ebreak where it should end.`,
    };
  if (ended === 'wfi')
    return {
      ...result,
      message: `The program is waiting (wfi) at ${where(link, pc - 4)} for an interrupt that never comes.`,
    };

  const problems: string[] = [];
  for (const [name, want] of Object.entries(expect.regs ?? {})) {
    const got = actualNum[name]!;
    if (got !== want >>> 0) problems.push(`${name} should be ${showReg(want >>> 0)} but is ${showReg(got!)}.`);
  }
  if (expect.exitCode !== undefined) {
    if (stop?.kind !== 'exit')
      problems.push(`The program should exit with code ${expect.exitCode} (li a7, 93 then ecall), but it stopped at ebreak.`);
    else if (stop.code !== expect.exitCode >>> 0)
      problems.push(`Exit code should be ${showReg(expect.exitCode >>> 0)} but is ${showReg(stop.code)}.`);
  }
  for (const want of expect.memory ?? []) {
    const bytes = parseHex(want.hex);
    let got: Uint8Array;
    try {
      got = m.readBytes(want.addr, bytes.length);
    } catch {
      problems.push(`The test reads memory at ${hex32(want.addr)}, which is not memory.`);
      continue;
    }
    let i = 0;
    while (i < bytes.length && bytes[i] === got[i]) i++;
    if (i < bytes.length) {
      const from = i & ~3;
      const span = (b: Uint8Array): string => toHex(b.subarray(from, from + 8)) + (from + 8 < b.length ? ' …' : '');
      problems.push(`Memory at ${hex32(want.addr + from)} should be ${span(bytes)} but is ${span(got)}.`);
    }
  }
  if (expect.uart !== undefined) {
    const got = m.uart.output;
    if (got !== expect.uart) {
      const i = firstDiff(got, expect.uart);
      problems.push(`UART output is wrong: expected ${snippet(expect.uart, i)}, got ${snippet(got, i)}.`);
    }
  }
  if (expect.framebufferSha256 !== undefined) {
    if (sha256(m.fbPixels.bytes) !== expect.framebufferSha256)
      problems.push('The picture on the framebuffer is not the expected one.');
  }

  if (problems.length === 0) return { ...result, pass: true };
  const more = problems.length > 1 ? `\n(+${problems.length - 1} more: ${problems.slice(1).join(' ')})` : '';
  return { ...result, message: problems[0]! + more };
}
