import type { Board, TestSpec } from '@build-a-computer/schema';
import type { Netlist } from '../compile';
import { Budget, Rig, UNSTABLE_MESSAGE, failCase, type CaseResult, type CheckOptions } from './common';

type ProgramSpec = Extract<TestSpec, { kind: 'program' }>;

/** Full clock cycles between wall-clock checks. */
const CHECK_EVERY = 64;

/**
 * Normalize a program listing to the ROM `data` format: hex entries separated
 * by single spaces. Accepts whitespace or commas between entries, optional
 * `0x` prefixes, and `;` or `#` comments to the end of a line. Returns an
 * error message for anything that is not hex.
 */
export function parseProgram(program: string): { data: string } | { error: string } {
  const entries: string[] = [];
  for (const line of program.split(/\r?\n/)) {
    const code = line.replace(/[;#].*$/, '');
    for (const tok of code.split(/[\s,]+/)) {
      if (!tok) continue;
      const hex = tok.replace(/^0x/i, '');
      if (!/^[0-9a-f]{1,8}$/i.test(hex)) return { error: `The program has '${tok}', which is not a hex number.` };
      entries.push(hex.toLowerCase());
    }
  }
  return { data: entries.join(' ') };
}

/**
 * TOY-03: a copy of `board` with `program` written into the data of the ROM
 * labelled `test.rom`. The worker compiles the returned board before running
 * the test. When no such ROM exists (or the program is not hex) the board is
 * returned unchanged and `runProgram` reports the problem.
 */
export function loadProgram(board: Board, test: Pick<ProgramSpec, 'program' | 'rom'>): Board {
  const parsed = parseProgram(test.program);
  if ('error' in parsed) return board;
  const label = test.rom ?? 'ROM';
  const k = board.parts.findIndex((p) => p.type === 'rom' && p.label === label);
  if (k < 0) return board;
  const parts = board.parts.slice();
  const rom = parts[k]!;
  parts[k] = { ...rom, props: { ...rom.props, data: parsed.data } };
  return { ...board, parts };
}

/**
 * TOY-03 program run. Expects a netlist compiled from `loadProgram(board, test)`.
 * Powers on, sets `set`, then runs full clock cycles (2 ticks each) until the
 * lamp labelled `halt` reads 1 or `maxCycles` pass, then compares `expect`.
 * A board without a HALT lamp runs exactly `maxCycles`. One case per run.
 */
export function* runProgram(nl: Netlist, test: ProgramSpec, opts: CheckOptions = {}): Generator<CaseResult> {
  const kind = 'program';
  const romLabel = test.rom ?? 'ROM';
  const haltLabel = test.halt ?? 'HALT';
  const inputs = test.set ?? {};
  const expected = test.expect;
  const base = { inputs, expected };

  const parsed = parseProgram(test.program);
  if ('error' in parsed) {
    yield failCase(kind, 0, parsed.error, base);
    return;
  }
  if (!nl.parts.some((p) => p.type === 'rom' && p.label === romLabel)) {
    yield failCase(kind, 0, `There is no ROM labelled ${romLabel} on the board to load the program into.`, base);
    return;
  }

  const budget = new Budget(opts);
  const rig = new Rig(nl, opts);
  let stable = rig.engine.powerOn().stable;
  const set = rig.set(inputs);
  if (set.error) {
    yield failCase(kind, 0, set.error, { ...base, cycle: 0 });
    return;
  }
  if (Object.keys(inputs).length > 0) stable = set.stable;

  const hasHalt = !!rig.output(haltLabel);
  let cycles = 0;
  let halted = hasHalt && rig.isHigh(haltLabel);
  let timedOut = false;
  while (stable && !halted && cycles < test.maxCycles) {
    stable = rig.engine.tick().stable && rig.engine.tick().stable;
    cycles++;
    if (hasHalt) halted = rig.isHigh(haltLabel);
    if (cycles % CHECK_EVERY === 0 && budget.expired()) {
      timedOut = true;
      break;
    }
  }

  const cmp = rig.compare(expected);
  let pass = cmp.pass;
  let message = cmp.message;
  let summary: string;
  if (!stable) {
    pass = false;
    message = UNSTABLE_MESSAGE;
    summary = `Stopped at cycle ${cycles}: the circuit never settled.`;
  } else if (timedOut) {
    pass = false;
    message = `The program was still running after ${cycles.toLocaleString('en')} cycles when the ${budget.seconds} s time limit ran out. Does it end with a halt instruction that sets ${haltLabel}?`;
    summary = `Ran ${cycles.toLocaleString('en')} of ${test.maxCycles.toLocaleString('en')} cycles before the time limit.`;
  } else if (hasHalt && !halted) {
    pass = false;
    message = `The program did not halt within ${test.maxCycles.toLocaleString('en')} cycles. It may be stuck in a loop: does it end with a halt instruction that sets ${haltLabel}?`;
    summary = `Ran all ${test.maxCycles.toLocaleString('en')} cycles without halting.`;
  } else if (halted) {
    summary = `Halted after ${cycles.toLocaleString('en')} of ${test.maxCycles.toLocaleString('en')} cycles.`;
  } else {
    summary = `Ran ${cycles.toLocaleString('en')} cycles (no ${haltLabel} output on the board).`;
  }
  yield {
    index: 0,
    kind,
    pass,
    inputs,
    expected,
    actual: cmp.actual,
    actualNum: cmp.actualNum,
    cycle: cycles,
    halted,
    summary,
    ...(message ? { message } : {}),
  };
}
