# ADR-007: Players can reveal a level's reference solution

- Status: Accepted (owner request, 2026-10-04)
- Supersedes the plan default for the open question "Should reference solutions be hidden?"

## Context

The plan's default kept reference solutions in `packages/content/solutions`, never bundled or
linked from the game. Playing the OR level, the owner got stuck and asked for a button that shows
the answer, because hints alone did not get them unstuck.

## Decision

- The level panel has a **Show solution** button under the hints. It asks for confirmation, then
  replaces the board with the level's reference solution as one undo step (Ctrl+Z restores the
  player's attempt).
- Solutions load lazily from `@ground-up/content/solutions` into their own chunk, so the
  first-level bundle (400 KB budget) does not grow and nothing is fetched until a player asks.
- The game lays the solution out before showing it (`apps/web/src/level/solution.ts`): columns by
  logic depth between the level's inputs and outputs, wires routed automatically. A test checks
  that every laid-out solution still passes its level.
- Hints were rewritten as a ladder that ends close to the answer, so most players never need the
  button.

## Consequences

- Solutions are public in the shipped app. Spoilers are one deliberate click away, as in many
  puzzle games.
- Completing a level after revealing the solution still counts. If leaderboards (M14) need it,
  record `usedSolution` per level then; scores from revealed solutions should not rank.

## Alternatives considered

- Hints only (rejected: the owner's direct feedback).
- Show the solution as a read-only image (rejected: loading it as a board lets players poke it,
  run the tests and step through it, which teaches more).
