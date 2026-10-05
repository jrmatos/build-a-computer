/**
 * SIM-12: settle time of a flattened 32-bit ripple-carry adder (288 NAND gates).
 * Budget (docs/plan.md, Performance budgets): 1 ms or less per settle on the
 * fast engine; the test fails if the mean is over budget.
 * Run with `pnpm --filter @ground-up/sim-logic bench`.
 * Set BENCH_OUT=path.json to also write the numbers as JSON (for posting on a PR).
 * Lives outside packages/sim-logic/src because it reads the wall clock.
 */
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { rippleAdderBoard } from '../../packages/sim-logic/src/boards';
import { compile, FastEngine, ReferenceEngine, type Netlist, type SettleResult } from '../../packages/sim-logic/src/index';

const BUDGET_MS = 1;

interface Engine {
  powerOn(): SettleResult;
  setSwitch(id: string, on: boolean): SettleResult;
}

interface Row {
  engine: string;
  scenario: string;
  settles: number;
  meanUs: number;
  p50Us: number;
  p99Us: number;
}

const us = (ms: number) => Math.round(ms * 100_000) / 100;

/** Time `n` calls of `step` on an engine already prepared by `setup`. */
function measure(engine: string, scenario: string, e: Engine, step: (e: Engine, i: number) => void, n: number): Row {
  for (let i = 0; i < Math.min(500, n); i++) step(e, i); // warm up the JIT
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    step(e, i);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    engine,
    scenario,
    settles: n,
    meanUs: us(times.reduce((a, b) => a + b, 0) / n),
    p50Us: us(times[n >> 1]!),
    p99Us: us(times[Math.floor(n * 0.99)]!),
  };
}

it('SIM-12: a flattened 32-bit NAND ripple adder settles within 1 ms', () => {
  const nl = compile(rippleAdderBoard(32));
  const makers: [string, (nl: Netlist) => Engine][] = [
    ['reference', (n) => new ReferenceEngine(n)],
    ['fast', (n) => new FastEngine(n)],
  ];

  // Worst case: A = all ones, B = 0; toggling carry-in ripples through all 32 bits.
  const worstSetup = (e: Engine) => {
    e.powerOn();
    for (let b = 0; b < 32; b++) e.setSwitch(`A${b}`, true);
  };
  const worst = (e: Engine, i: number) => {
    e.setSwitch('CIN', (i & 1) === 0);
  };
  // Random operand bits flipping (deterministic xorshift sequence).
  let x = 0x9e3779b9;
  const random = (e: Engine) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const bit = (x >>> 0) % 65;
    e.setSwitch(bit === 64 ? 'CIN' : `${bit < 32 ? 'A' : 'B'}${bit % 32}`, ((x >>> 8) & 1) === 1);
  };

  const rows: Row[] = [];
  for (const [name, make] of makers) {
    const n = name === 'fast' ? 20_000 : 2_000;
    const a = make(nl);
    worstSetup(a);
    rows.push(measure(name, 'carry ripple, 32 bits (worst case)', a, worst, n));
    const b = make(nl);
    b.powerOn();
    rows.push(measure(name, 'random operand bit flips', b, random, n));
    const c = make(nl);
    rows.push(measure(name, 'power on (full settle)', c, (e) => void e.powerOn(), Math.max(200, n / 10)));
  }
  console.table(rows);
  if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify({ budgetMs: BUDGET_MS, rows }, null, 2));
  for (const r of rows.filter((r) => r.engine === 'fast')) expect(r.meanUs).toBeLessThanOrEqual(BUDGET_MS * 1000);
});
