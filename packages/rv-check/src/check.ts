/**
 * RV-07: run one 'riscv' test. Build the player's source (assembly or C) with
 * the level's library files (and libc for C levels), run it on the RV32 machine until it stops, and
 * compare registers, memory, UART output, exit code and framebuffer.
 */

import type { Machine } from '@build-a-computer/rv32';
import type { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { type Program, buildProgram } from './build';
import {
  type RvCheck,
  applyInput,
  checkExpectRegs,
  checkProblem,
  clipCheck,
  machineReadout,
  riscvChecks,
} from './diff';
import {
  type StopEvent,
  SetupError,
  createMachine,
  formatDiag,
  regIndex,
  runMachine,
  trapMessage,
  where,
} from './machine';

export type RiscvTest = Extract<TestSpec, { kind: 'riscv' }>;

/** A 'riscv' case result with the expected-vs-actual details of every check. */
export interface RiscvCaseResult extends CaseResult {
  /** Every expectation with its value at the end of the run (UART cut around the first difference). Absent when the program did not build or set up. */
  checks?: RvCheck[];
}

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

/**
 * Run one 'riscv' test and yield ONE CaseResult (kind 'riscv'). `expected` and
 * `actual` hold the checked registers (actual as unsigned decimal strings) and
 * 'exit code'; UART, memory and framebuffer problems are explained in
 * `message`, and `checks` has every expectation with its actual value.
 * `summary` says how many instructions ran and how it ended.
 */
export function* runRiscvTest(
  source: string,
  test: RiscvTest,
  level: Level,
  opts: RiscvCheckOptions = {},
): Generator<RiscvCaseResult> {
  yield checkRiscv(source, test, level, opts);
}

/** The case result before the program ran: inputs and expected values. */
function baseCase(test: RiscvTest): RiscvCaseResult {
  const expected: Record<string, number> = { ...(test.expect.regs ?? {}) };
  if (test.expect.exitCode !== undefined) expected['exit code'] = test.expect.exitCode;
  return {
    index: 0,
    pass: false,
    kind: 'riscv',
    inputs: { ...(test.setup?.regs ?? {}) },
    expected,
    actual: {},
  };
}

function checkRiscv(
  source: string,
  test: RiscvTest,
  level: Level,
  opts: RiscvCheckOptions,
): RiscvCaseResult {
  const base = baseCase(test);
  const fail = (message: string, extra: Partial<CaseResult> = {}): RiscvCaseResult => ({
    ...base,
    ...extra,
    pass: false,
    message,
  });

  const link = buildProgram(source, level);
  const isC = link.language === 'c';
  if (!link.ok) {
    const errs = link.diagnostics.filter((d) => d.severity === 'error');
    const list = errs.slice(0, MAX_ERRORS).map(formatDiag).join('\n');
    const more = errs.length > MAX_ERRORS ? `\n…and ${errs.length - MAX_ERRORS} more.` : '';
    const n = errs.length;
    return fail(
      `The program does not ${isC ? 'compile' : 'assemble'} (${n} error${n === 1 ? '' : 's'}):\n${list}${more}`,
      {
        summary: `Not run: ${isC ? 'compile' : 'assembly'} errors.`,
      },
    );
  }

  let m: Machine;
  try {
    m = createMachine(link, level, test.setup ?? {});
    checkExpectRegs(test.expect);
  } catch (e) {
    if (e instanceof SetupError) return fail(e.message, { summary: 'Not run.' });
    throw e;
  }
  applyInput(m, test.input);

  // Run until the program stops, the step budget ends (E-SIM-10), it waits
  // forever (E-CPU-11) or the wall-clock budget ends.
  const maxSteps = test.maxSteps ?? 5_000_000;
  const now = opts.now;
  const t0 = now?.() ?? 0;
  let steps = 0;
  let stop: StopEvent | undefined;
  let ended: RunEnd | undefined;
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
  return judgeRiscv(link, m, test, { ...(stop ? { stop } : {}), ...(ended ? { ended } : {}), maxSteps });
}

/** How a run ended without a stop event: step budget, waiting forever, wall-clock budget. */
export type RunEnd = 'steps' | 'wfi' | 'time';

/**
 * Judge a machine after a run, as the test does: the stop event (or how the
 * run ended) and every expectation. The checker calls it at the end of a
 * test; the debugger calls it when a debugged test's program stops.
 */
export function judgeRiscv(
  link: Program,
  m: Machine,
  test: RiscvTest,
  run: { stop?: StopEvent; ended?: RunEnd; maxSteps?: number },
): RiscvCaseResult {
  const base = baseCase(test);
  const expect = test.expect;
  const isC = link.language === 'c';
  const { stop, ended } = run;
  const maxSteps = run.maxSteps ?? test.maxSteps ?? 5_000_000;
  const ran = m.hart.instret;
  const pc = m.hart.pc;
  const checks = riscvChecks(expect, machineReadout(m, stop?.kind === 'exit' ? stop.code : null));
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
  const result: RiscvCaseResult = {
    ...base,
    actual,
    actualNum,
    halted,
    cycle: ran,
    summary: `Ran ${fmt(ran)} instructions; ${how}.`,
    checks: checks.map(clipCheck),
  };

  // Problems that stop the run come first.
  if (stop?.kind === 'trap') return { ...result, message: trapMessage(m, link, stop) };
  const hint = isC
    ? 'Return from main (or call exit) where it should end, and check your loops.'
    : 'Add an exit (li a7, 93 then ecall) or an ebreak where it should end.';
  if (ended === 'steps')
    return {
      ...result,
      message: `The program never stopped: it ran ${fmt(maxSteps)} steps and was still going at ${where(link, pc)}. ${hint}`,
    };
  if (ended === 'time')
    return {
      ...result,
      message: `The program ran out of time after ${fmt(ran)} instructions (still going at ${where(link, pc)}). ${hint}`,
    };
  if (ended === 'wfi')
    return {
      ...result,
      message: `The program is waiting (wfi) at ${where(link, pc - 4)} for an interrupt that never comes.`,
    };
  if (!stop)
    return { ...result, message: `The program has not stopped yet (at ${where(link, pc)}).` };

  const stopped = stop.kind === 'exit' ? 'exit' : 'ebreak';
  const problems = checks
    .map((c) => checkProblem(c, { isC, stopped }))
    .filter((p): p is string => p !== null);
  if (problems.length === 0) return { ...result, pass: true };
  const more =
    problems.length > 1 ? `\n(+${problems.length - 1} more: ${problems.slice(1).join(' ')})` : '';
  return { ...result, message: problems[0]! + more };
}
