import type { TestSpec } from '@build-a-computer/schema';
import type { Netlist } from '../compile';
import { Budget, Rig, UNSTABLE_MESSAGE, failCase, type CaseResult, type CheckOptions } from './common';

/** Ticks between wall-clock checks inside one step. */
const CHECK_EVERY = 256;

/**
 * Clocked sequence (LVL-07). Powers on, then for each step: optional power
 * cycle (off, then on), set inputs, run `ticks` clock half-periods, compare
 * `expect`. Every step is one case, even one with nothing to check (it fails
 * only on a missing input or an unstable circuit).
 */
export function* runSequence(
  nl: Netlist,
  test: Extract<TestSpec, { kind: 'sequence' }>,
  opts: CheckOptions = {},
): Generator<CaseResult> {
  const kind = 'sequence';
  const budget = new Budget(opts);
  const rig = new Rig(nl, opts);
  const e = rig.engine;
  let stable = e.powerOn().stable;
  let ticks = 0;
  for (let index = 0; index < test.steps.length; index++) {
    const step = test.steps[index]!;
    const inputs = step.set ?? {};
    const expected = step.expect ?? {};
    if (budget.expired()) {
      yield failCase(kind, index, `The test ran out of time at step ${index + 1} (${budget.seconds} s budget).`, { step: index });
      return;
    }
    if (step.power === 'cycle') {
      e.powerOff();
      stable = e.powerOn().stable;
      ticks = 0;
    }
    const set = rig.set(inputs);
    if (set.error) {
      yield failCase(kind, index, set.error, { step: index, inputs, expected, cycle: ticks });
      continue;
    }
    // `stable` is whether the latest settle finished; any oscillation during the step fails it.
    if (Object.keys(inputs).length > 0) stable = set.stable;
    let oscillated = !stable;
    let timedOut = false;
    const want = step.ticks ?? 0;
    for (let t = 0; t < want; t++) {
      const r = e.tick();
      ticks++;
      stable = r.stable;
      if (!stable) oscillated = true;
      if (t % CHECK_EVERY === CHECK_EVERY - 1 && budget.expired()) {
        timedOut = true;
        break;
      }
    }
    const cmp = rig.compare(expected);
    let pass = cmp.pass;
    let message = cmp.message;
    if (timedOut) {
      pass = false;
      message = `The test ran out of time during step ${index + 1} (${budget.seconds} s budget).`;
    } else if (oscillated) {
      pass = false;
      message = UNSTABLE_MESSAGE;
    }
    yield {
      index,
      kind,
      step: index,
      cycle: ticks,
      pass,
      inputs,
      expected,
      actual: cmp.actual,
      actualNum: cmp.actualNum,
      ...(message ? { message } : {}),
    };
    if (timedOut) return;
  }
}
