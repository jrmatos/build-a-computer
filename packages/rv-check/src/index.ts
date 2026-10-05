import type { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';

export interface RiscvCheckOptions {
  /** Wall-clock budget in ms; time comes from `now` (no clock APIs in this package). */
  budgetMs?: number;
  now?: () => number;
}

/**
 * Run one 'riscv' test: assemble + link the player's source with the level's
 * library files, run it on the RV32 machine, and compare registers, memory,
 * UART output, exit code and framebuffer. STUB: the rv-check agent implements it.
 */
export function* runRiscvTest(
  _source: string,
  test: Extract<TestSpec, { kind: 'riscv' }>,
  _level: Level,
  _opts: RiscvCheckOptions = {},
): Generator<CaseResult> {
  yield {
    index: 0,
    pass: false,
    inputs: {},
    expected: {},
    actual: {},
    message: `RISC-V checker not implemented yet (${test.name ?? 'program'})`,
  } as CaseResult;
}
