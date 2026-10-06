/**
 * Checker adapters (ADR-010): each level mode's test runner behind
 * platform-core's `Checker` interface. Board levels run on sim-logic; code
 * levels on the RV32 machine through rv-check; Track 2 levels in the js-check
 * sandbox. The rv-check and js-check subsystems load on first use, so a board
 * level's worker script carries only the logic simulator.
 */
import type { Board, ChipMap, Level, TestSpec } from '@build-a-computer/schema';
// The checker subpath imports schema types only: the worker never pulls in zod.
import { CheckerRegistry, type Checker, type Failure, type KindRunner } from '@build-a-computer/platform-core/checker';
import {
  ChipCycleError,
  CompileError,
  FastEngine,
  compile,
  flattenBoard,
  loadProgram,
  runTest,
  runTestCase,
  type CaseResult,
  type CheckOptions,
  type Netlist,
} from '@build-a-computer/sim-logic';
import type { JsHostOptions } from './js-host';

/** What every checker gets for one run: the board (board levels), the source (code and js levels) and the time budget. */
export interface CheckInput {
  board?: Board | undefined;
  source: string;
  budgetMs: number;
}

export type LevelChecker = Checker<CaseResult, CheckInput>;

/** A failed case with the empty fields every CaseResult has. */
const failed = (f: Failure): CaseResult => ({
  index: f.index,
  pass: false,
  inputs: {},
  expected: {},
  actual: {},
  ...(f.kind ? { kind: f.kind } : {}),
  test: f.test,
  message: f.message,
});

/** A case that failed because the simulator threw. */
const simFailed = (kind: TestSpec['kind'], test: number, e: unknown): CaseResult => ({
  index: 0,
  pass: false,
  inputs: {},
  expected: {},
  actual: {},
  kind,
  test,
  message: `The simulator failed while testing: ${e instanceof Error ? e.message : String(e)}`,
});

/** The live simulator state board checks fall back to (SimHost). */
export interface BoardState {
  /** The last loaded netlist, if it compiled. */
  nl(): Netlist | null;
  /** The last loaded board after flattening (program tests patch its ROM). */
  flatBoard(): Board | null;
  chips(): ChipMap;
  now(): number;
}

/**
 * Board levels: sim-logic's checkers on a FastEngine, with the level's
 * power-on mode, seed 1 and the wall-clock budget. Tests run on `board`
 * (flattened with the loaded chips), else the last loaded board; 'program'
 * tests compile a copy with the program in its ROM.
 */
export function boardChecker(state: BoardState): LevelChecker {
  return {
    mode: 'board',
    singleCase: false,
    unsupported: (kind) => `A board level cannot run a '${kind}' test.`,
    fail: failed,
    open(level, { board: given, budgetMs }) {
      let board: Board | undefined;
      // Without a board, fall back to the last loaded one (already flattened).
      if (!given) board = state.flatBoard() ?? undefined;
      else {
        try {
          board = flattenBoard(given, state.chips()).board;
        } catch (e) {
          if (!(e instanceof ChipCycleError)) throw e;
          return { ok: false, error: { index: 0, pass: false, inputs: {}, expected: {}, actual: {}, message: e.message }, counts: true };
        }
      }
      if (!state.nl() && !board) return { ok: false, error: failed({ index: 0, test: 0, message: 'There is no board loaded.' }), counts: false };
      const opts: CheckOptions = {
        powerOnState: level.power,
        seed: 1,
        createEngine: (nl, o) => new FastEngine(nl, o),
        now: state.now,
        budgetMs,
      };
      /** The netlist test `t` runs on, or the failed case. */
      const netlist = (t: TestSpec, ti: number): { nl: Netlist } | CaseResult => {
        try {
          if (t.kind === 'program') {
            if (!board) return { index: 0, pass: false, inputs: {}, expected: t.expect, actual: {}, kind: t.kind, test: ti, message: 'Could not load the program: the board was not sent with the test run.' };
            return { nl: compile(loadProgram(board, t)) };
          }
          return { nl: state.nl() ?? compile(board!) };
        } catch (e) {
          if (!(e instanceof CompileError)) throw e;
          return { index: 0, pass: false, inputs: {}, expected: {}, actual: {}, kind: t.kind, test: ti, message: e.message };
        }
      };
      // sim-logic's runTest answers every kind (non-board kinds fail with a message), so one runner serves them all.
      const runner: KindRunner<CaseResult> = {
        async run(t, ti, emit) {
          const nl = netlist(t, ti);
          if (!('nl' in nl)) return emit(nl);
          try {
            for (const r of runTest(nl.nl, t, opts)) await emit(r);
          } catch (e) {
            await emit(simFailed(t.kind, ti, e));
          }
        },
        async runCase(t, ti, caseIndex) {
          const nl = netlist(t, ti);
          if (!('nl' in nl)) return { ...nl, index: caseIndex, ...(t.kind === 'sequence' ? { step: caseIndex } : {}) };
          try {
            return runTestCase(nl.nl, t, caseIndex, opts);
          } catch (e) {
            return { ...simFailed(t.kind, ti, e), index: caseIndex };
          }
        },
      };
      return { ok: true, session: { runner: () => runner } };
    },
  };
}

/** A checker whose tests are each one case, produced by `result`. */
function singleCaseChecker(mode: 'code' | 'js', kind: TestSpec['kind'], what: string, result: (level: Level, t: TestSpec, input: CheckInput) => Promise<CaseResult[]>): LevelChecker {
  return {
    mode,
    singleCase: true,
    unsupported: (k) => `A ${what} level cannot run a '${k}' test.`,
    fail: failed,
    open(level, input) {
      const runner: KindRunner<CaseResult> = {
        async run(t, _ti, emit) {
          for (const r of await result(level, t, input)) await emit(r);
        },
        async runCase(t) {
          return (await result(level, t, input))[0]!;
        },
      };
      return { ok: true, session: { runner: (k) => (k === kind ? runner : undefined) } };
    },
  };
}

type RvCheck = { runRiscvTest: typeof import('@build-a-computer/rv-check').runRiscvTest };
type JsCheck = { runJsTest: typeof import('@build-a-computer/js-check').runJsTest };

/** Code levels: each 'riscv' test runs the player's source on the RV32 machine (rv-check, loaded lazily). */
export function codeChecker(load: () => Promise<RvCheck>, now: () => number): LevelChecker {
  return singleCaseChecker('code', 'riscv', 'code', async (level, t, { source, budgetMs }) => {
    if (t.kind !== 'riscv') return [];
    try {
      const { runRiscvTest } = await load();
      return [...runRiscvTest(source, t, level, { now, budgetMs })];
    } catch (e) {
      return [{ index: 0, pass: false, inputs: {}, expected: {}, actual: {}, kind: t.kind, message: `The emulator failed while testing: ${e instanceof Error ? e.message : String(e)}` }];
    }
  });
}

/** Track 2: each 'js' test runs the player's main.js in a fresh sandbox with its own timeoutMs (js-check, loaded lazily). */
export function jsChecker(load: () => Promise<JsCheck>, options: () => JsHostOptions): LevelChecker {
  return singleCaseChecker('js', 'js', 'JavaScript', async (level, t, { source }) => {
    if (t.kind !== 'js') return [];
    const { runner, datasets } = options();
    try {
      const { runJsTest } = await load();
      return [await runJsTest(source, t, level, { ...(runner ? { runner } : {}), ...(datasets ? { datasets } : {}) })];
    } catch (e) {
      return [{ index: 0, pass: false, inputs: {}, expected: {}, actual: {}, kind: t.kind, message: `The JavaScript checker failed: ${e instanceof Error ? e.message : String(e)}` }];
    }
  });
}

/** The checker registry a SimHost dispatches through. */
export function levelCheckers(board: BoardState, rv: () => Promise<RvCheck>, js: () => Promise<JsCheck>, jsOptions: () => JsHostOptions): CheckerRegistry<CaseResult, CheckInput> {
  return new CheckerRegistry<CaseResult, CheckInput>()
    .register(boardChecker(board))
    .register(codeChecker(rv, board.now))
    .register(jsChecker(js, jsOptions));
}
