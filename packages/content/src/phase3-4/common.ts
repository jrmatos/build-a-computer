import type { PartType, SequenceStep } from '@ground-up/schema';
import { grow } from '../define';
import { P2_ALL } from '../phase0-2';

/** Everything unlocked by the end of Phase 2: the starting palette of Phase 3. */
export const AFTER_PHASE2: PartType[] = P2_ALL;

/** Everything unlocked by the end of Phase 3: the starting palette of Phase 4. */
export const AFTER_PHASE3: PartType[] = grow(AFTER_PHASE2, 'clock', 'buffer', 'dff', 'register', 'counter', 'ram', 'rom');

/** Last Phase 2 level (owned by the Phase 0–2 content agent); Phase 3 starts after it. */
export const PHASE2_LAST_ID = 'alu-32bit';

type Values = Record<string, number>;

/** Set inputs, run one full clock cycle (rising then falling edge), then check. */
export const cycle = (set: Values | undefined, expect?: Values, cycles = 1): SequenceStep => ({
  ...(set ? { set } : {}),
  ticks: 2 * cycles,
  ...(expect ? { expect } : {}),
});

/** Set inputs and check without ticking the clock. */
export const check = (set: Values | undefined, expect: Values): SequenceStep => ({ ...(set ? { set } : {}), ticks: 0, expect });

/** Set inputs, run `ticks` half-periods, check. */
export const ticks = (n: number, set: Values | undefined, expect?: Values): SequenceStep => ({
  ...(set ? { set } : {}),
  ticks: n,
  ...(expect ? { expect } : {}),
});
