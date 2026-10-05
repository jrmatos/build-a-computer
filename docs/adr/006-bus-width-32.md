# ADR-006: Buses carry at most 32 bits in v1

- Status: Proposed — needs owner review
- Deviates from the plan ("Buses carry 1 to 64 bits")

## Context

Every net stores its value and unknown (X) mask as unsigned 32-bit integers, so the engine stays
on fast typed arrays with `>>> 0` math. RV32 — the CPU the curriculum targets — never needs a
wider bus.

## Decision

`MAX_WIDTH = 32` in `packages/schema/src/board.ts`. Widths 1–32 are validated by the schema; the
engines, blocks and checkers assume it.

## Consequences

- 64-bit values (e.g. `mtime`, RV64) need two buses or a later engine change: two words per net
  (lo/hi) for both the value and X masks.
- Saves stay forward-compatible: raising the limit only widens the schema.

## Alternatives considered

- BigInt values (rejected: far slower in the hot loop).
- Two words per net now (rejected for v1: doubles memory traffic for a case no level needs yet).
