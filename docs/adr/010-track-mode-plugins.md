# ADR-010: Track and mode plugins in platform-core

- Status: Proposed
- Date: 2026-10-06
- Deciders: agent session (feat/full-computer)
- Related: PLAT-01, COM-02, PLAT-02, `docs/plan.md` → Architecture ("Track plugin interface", Packages)

## Context

The plan sketches one `TrackPlugin` per track (`editors`, `createSimulator`,
`checkers`, `panels`) and a `Checker` per test kind, with `packages/platform-core`
holding the track registry, level runner, checker interface, unlock graph,
hints and progress rules. Before PLAT-01 there was no platform-core: the app
switched on `level.mode` (`'board' | 'code' | 'js'`) in App, SimControls,
Toolbar, Footer, BottomDock, LevelPanel, the dock state, the case debugger
store and the sim client; the worker's `SimHost.runTests`/`runCase` branched
on the mode and on test kinds; unlock and progress rules lived in
`apps/web/src/level/progress.ts`.

The useful seam is not the track. Track 1 uses two very different modes
(board levels and code levels), Track 2 uses a third (JavaScript), and the
sandbox is a board-mode track with no tests. Everything that varies — the
editor, the live machine, the test kinds, what a save and a solution hold,
the panels — follows the level's `mode`. What varies by track is small: which
modes it uses and whether it is free play.

## Decision

- New package `packages/platform-core` (depends on `schema` only, pure TS,
  covered by the simulation-package ESLint rules: no DOM, clock or I/O). It
  imports no simulator, compiler or sandbox.
- **Plugins are per mode, grouped by track.**
  - `TrackPlugin { id, modes, freePlay }`. `freePlay` (the sandbox) means
    always unlocked, no tests, no next level, listed first.
  - `ModePlugin { id, editor, work: 'board' | 'source', machine: 'logic' | 'rv32' | 'js-sandbox', testKinds, caseReplay, starter(level) }`.
  - `TestKindSpec { kind, mode, board, single }` per schema test kind.
  - Built-ins are `Record`s keyed by the schema's `Level.mode`, `Level.track`
    and `TestSpec['kind']`, so a new schema value without a plugin fails to
    compile. `Registry` validates registrations (no duplicates, no unknown
    modes) for future tracks.
- **Shared rules** live in platform-core: unlock graph and progress
  (`isUnlocked`, `levelState`, `nextLevel`, `groupLevels`, `withCompleted`
  with an explicit time, …), `canRunTests`, `hintState`, `canShowSolution`,
  `solutionKind`, `initialSource`, `sourceToSave`.
  `apps/web/src/level/progress.ts` re-exports them unchanged (plus the
  default `new Date()` for `withCompleted`), so callers did not change.
- **Checker interface.** A `Checker<R, In>` per mode (`mode`, `singleCase`,
  `unsupported(kind)`, `fail(failure)`, `open(level, input)`), whose session
  maps test kinds to `KindRunner`s (`run` streams every case, `runCase` runs
  one). `runLevel` / `runLevelCase` own the shared loop: tag each result with
  its test, count passes, report level-wide failures (a chip cycle) once, and
  turn unsupported kinds and missing tests or cases into failed cases.
  Results are generic (`CheckResult`), so platform-core never sees
  sim-logic's `CaseResult`. This is the plan's `Checker`, keyed by mode
  rather than by kind, because a board run shares one prepared board across
  its tests.
- **Worker.** `packages/worker/src/checkers.ts` holds thin adapters:
  `boardChecker` (sim-logic), `codeChecker` (rv-check) and `jsChecker`
  (js-check). rv-check and js-check are still reached only through the lazy
  `loadRvModule` / `loadJsModule`, so a board level's worker stays small.
  `SimHost.runTests`/`runCase` are one line each through the registry.
- **App.** `apps/web/src/modes/` is the UI half: `ModeUi { core, Workspace,
  Controls, Toolbar, footer, welcome, dockTabs, panels, Effects,
  showSolution }`, one file per mode, collected in `MODE_UI:
  Record<LevelMode, ModeUi>`. Shell components ask `useModeUi()`. Heavy
  workspaces stay `lazy()` inside their mode file (code and ML chunks
  unchanged). Non-UI code (sim client, saves, storage, community) asks
  platform-core capabilities (`modeOf(level).machine === 'rv32'`,
  `isSourceLevel(level)`) instead of comparing mode names.

## Alternatives considered

| Option | Pros | Cons | Why not |
| --- | --- | --- | --- |
| One `TrackPlugin` per track, as sketched | Matches the plan text | Track 1 would need an internal mode switch again; the sandbox would duplicate Track 1 | Moves the `mode` switch instead of removing it |
| `Checker` per test kind | Matches the plan text | A board run prepares (flattens, compiles) once for all tests; per-kind checkers would each redo it or need shared state | Kept per-kind `KindRunner`s inside a per-mode session instead |
| UI components in platform-core | One registry | platform-core would import React and the app's stores | Breaks "pure, schema only"; the UI half stays in the app keyed by the same ids |
| Leave the switches, only move progress.ts | Smallest diff | Track 2 and later tracks keep editing every shell component | Fails PLAT-01's goal |

## Consequences

- Adding a mode means: a schema enum value, a `ModePlugin` and test kinds in
  platform-core (compile errors point at every Record), a checker adapter in
  the worker, and a `ModeUi` in `apps/web/src/modes/`.
- Mode-specific code that remains is inside the mode's own files (the code and
  JS workspaces check their own mode before rendering), in kind-specific case
  views (exhaustive `switch`es over `TestSpec['kind']`, which narrow types),
  in community pack validation (per-mode publishing rules with their own
  messages), and in one Phase 1 achievement rule (content, not dispatch).
  Sandbox-specific wording in the level map and panel is presentation.
- `js` levels keep the board's controls, toolbar, footer and dock, exactly as
  before; their `ModeUi` can now change that without touching the shell.
- Revisit when PLAT-02 (graph editor) adds an editor kind, or if checkers need
  to run outside the worker (COM-02 server-side verification).
