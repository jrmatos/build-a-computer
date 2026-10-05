/**
 * RV-04: interpreter speed. Budget (docs/plan.md): at least 10 million
 * instructions per second. Run with `pnpm --filter @build-a-computer/rv32 bench`.
 * Lives outside packages/rv32/src because it reads the wall clock.
 */
import { expect, it } from 'vitest';
import { asm, li, Machine, RAM_BASE, toBytes } from '../../packages/rv32/src/index';

const BUDGET_MIPS = 10;

function benchProgram(iterations: number): number[] {
  // t0 = counter, a0 = accumulator, a1 = data pointer (separate page from code).
  const loop = [
    asm('lw', 6, 11, 0), // lw t1, 0(a1)
    asm('add', 10, 10, 6), // add a0, a0, t1
    asm('addi', 6, 6, 1), // addi t1, t1, 1
    asm('sw', 6, 11, 0), // sw t1, 0(a1)
    asm('xor', 12, 10, 5), // xor a2, a0, t0
    asm('slli', 13, 12, 3), // slli a3, a2, 3
    asm('andi', 13, 13, 0xff), // andi a3, a3, 255
    asm('mul', 14, 13, 12), // mul a4, a3, a2
    asm('addi', 5, 5, -1), // addi t0, t0, -1
  ];
  const prologue = [...li(5, iterations), asm('addi', 10, 0, 0), ...li(11, RAM_BASE + 0x1000)];
  return [...prologue, ...loop, asm('bne', 5, 0, -4 * loop.length), asm('jal', 0, 0)];
}

it('RV-04: interpreter runs at least 10 MIPS', () => {
  const iterations = 2_000_000;
  const steps = iterations * 10 + 5;
  const m = new Machine();
  m.load(RAM_BASE, toBytes(benchProgram(iterations)));
  m.hart.pc = RAM_BASE;
  m.run(100_000); // warm up the JIT
  const runs: number[] = [];
  for (let k = 0; k < 3; k++) {
    m.hart.pc = RAM_BASE;
    const t0 = performance.now();
    const r = m.run(steps);
    const ms = performance.now() - t0;
    runs.push(r.steps / ms / 1000);
  }
  const best = Math.max(...runs);
  console.log(
    `rv32 interpreter: ${runs.map((r) => r.toFixed(1)).join(', ')} MIPS (best ${best.toFixed(1)})`,
  );
  expect(best).toBeGreaterThanOrEqual(BUDGET_MIPS);
});
