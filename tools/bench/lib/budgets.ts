/**
 * Performance budgets from docs/plan.md ("Performance budgets"). CI blocks a
 * merge when one is missed.
 *
 * Only time to interactive gets a CI multiplier: the plan states it for "a
 * mid-range laptop", and a shared 2/4-vCPU GitHub runner with a cold browser
 * profile and software raster is slower than that, with noisy neighbours. The
 * other budgets are stated for the code, not the machine, and are enforced as
 * written.
 */
export const CI_TTI_MULTIPLIER = 1.5;

export const BUDGETS = {
  /** Editor frame time with 2,000 visible components, p95 renderer draw time. */
  frameMs: 16,
  /** Settle of a flattened 32-bit ripple adder, mean on the fast engine. */
  adderSettleMs: 1,
  /** RISC-V interpreter speed, best of 3 runs. */
  rv32Mips: 10,
  /** JavaScript for the first level, gzipped: entry chunk + static imports + worker scripts. */
  firstLevelJsKb: 400,
  /** Time to interactive, plan budget (2 s) times the CI multiplier. */
  ttiMs: 2000 * CI_TTI_MULTIPLIER,
} as const;

export interface Result {
  metric: string;
  value: number | null;
  unit: string;
  budget: string;
  pass: boolean;
  note?: string;
}
