# ADR-005: Reference engine initial state at power on

- Status: Proposed (owner review)
- Date: 2026-10-04
- Deciders: project owner; M1 agent session
- Related: SIM-03, E-SIM-01, E-SIM-07, E-SIM-08,
  `packages/sim-logic/src/engine.ts` (`ReferenceEngine.powerOn`),
  `docs/plan.md` → "Power and reset"

## Context

The plan says power on sets volatile state to 0 or to seeded random values. For
flip-flops that is unambiguous. For gate feedback loops built by players (an SR
latch from two NANDs, a NOT ring) it is not: with every net starting at X, a
latch with both inputs inactive computes `NAND(1, X) = X` forever, so it would
never hold a value, unlike real hardware, which falls into one stable state.
Forcing _every_ gate output to 0 at once is also wrong: it can start a latch in
an inconsistent state and make it oscillate for one wave.

## Decision

`ReferenceEngine.powerOn()` works in three steps:

1. **Everything starts at X.** Nets and gate output slots are filled with X;
   contention is cleared; the clock level is 0 and `ticks` is 0. Each D
   flip-flop's stored state is set to 0, or to a seeded random bit when
   `powerOnState: 'random'` (E-SIM-07); its previous clock is X, so no edge is
   seen at power on. Sources (switches, constants, clock) write their outputs,
   and every net is resolved from its drivers.
2. **Settle the whole circuit once.** Gates whose inputs decide the output
   leave X (e.g. `NAND(0, X) = 1`). If this settle is unstable, return it.
3. **Resolve leftover loops one net at a time.** Walk the parts in netlist
   order. For each gate that the compiler marked `inLoop` (part of a strongly
   connected component or wired to itself) and whose output is _still_ X, set
   that one output to 0 (or a seeded random bit), refresh its net, and settle
   only from that net's readers. Stop and return as soon as a settle is
   unstable.

Effects:

- **SR latch (2 NANDs, inputs inactive):** the first gate's output is set, the
  other gate follows, the pair is consistent, and the latch holds. With `zero`
  the side picked depends only on part order; with `random` it is reproducible
  from the seed.
- **NOT ring / self-wired NOT:** the forced value propagates and flips forever;
  the settle hits the event budget (1,000 events per part, capped at 5 million)
  and returns `stable: false` with `unstableNets` listing every net still
  moving (E-SIM-01).
- Loops already decided by their inputs in step 2 are left alone.
- Power off clears nets, slots and flip-flop state back to X (E-SIM-08).

## Alternatives considered

| Option                                            | Why not                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Leave loops at X                                  | Latches never work until explicitly set; contradicts real hardware and the curriculum |
| Force every gate output to 0/random at once       | Inconsistent start states; spurious one-wave glitches; harder to fuzz against         |
| Resolve all X nets, not only loop gates           | Hides unconnected-input X (E-SIM-03) that the player must see                         |
| Pick per-loop values by solving for a fixed point | More complex, and the reference engine is meant to be simple                          |

## Consequences

- The fast engine (SIM-04) must reproduce exactly this order (netlist part
  order, one net at a time, same PRNG draws) or differential fuzzing fails.
- Changing part order in the compiler can change which side a latch picks with
  `zero`; tests must not depend on that side unless they set the latch first.
- Levels that care about the initial state should drive it explicitly (set/reset
  inputs or `reset`), which matches good hardware practice.
