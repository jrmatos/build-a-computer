import type { Board, ChipMap, Level } from '@build-a-computer/schema';
import type { CaseResult, Diagnostic } from '@build-a-computer/sim-logic';
import type { RiscvCaseResult, RunSetup, RvCheck } from '@build-a-computer/rv-check';
import type { JsCaseDetail, JsCaseResult, JsDiffNode, JsMismatch } from '@build-a-computer/js-check';

export type { RiscvCaseResult, RvCheck, JsCaseDetail, JsCaseResult, JsDiffNode, JsMismatch };

/** A snapshot of the running simulation, posted to the UI at most 60 times a second. */
export interface Snapshot {
  /** 1-bit summary per wire id: 0, 1 or 2 (X). For buses: 1 if any bit is 1, 2 if any bit is X, else 0. */
  wires: Record<string, number>;
  /** Full value of every wire wider than 1 bit (v = bits, x = unknown mask, w = width). Z reads as X. */
  buses: Record<string, BusValue>;
  /** Full value of every pin wider than 1 bit, keyed `${partId}:${pin}`. */
  busPins: Record<string, BusValue>;
  /** Current value of multi-bit switches (number inputs), by part id. */
  switchValues: Record<string, number>;
  /** Value seen by each pin, keyed `${partId}:${pin}`. */
  pins: Record<string, number>;
  /** Switches that are on. */
  switchesOn: string[];
  powered: boolean;
  running: boolean;
  ticks: number;
  clock: number;
  stable: boolean;
  /** Pins on nets that never settled or have contention, keyed `${partId}:${pin}`. */
  unstablePins: string[];
  contentionPins: string[];
}

export interface BusValue {
  w: number;
  v: number;
  x: number;
}

/** How a board is loaded: the level's power-on mode (E-SIM-07) and seed. */
export interface LoadOptions {
  power?: 'zero' | 'random';
  seed?: number;
}

export interface LoadResult {
  ok: boolean;
  error?: string;
  diagnostics: Diagnostic[];
}

/** Commands the UI sends to the simulation worker (see plan: Worker protocol). */
export interface SimApi {
  /** Compile the board with its custom chips (flattened in the worker) and power on. */
  load(board: Board, chips?: ChipMap, opts?: LoadOptions): LoadResult;
  setSwitch(partId: string, on: boolean): void;
  /** Set a multi-bit switch (number input) to an unsigned value. */
  setValue(partId: string, value: number): void;
  /** Momentary button: true while held. */
  press(partId: string, down: boolean): void;
  /** Contents of a RAM/ROM/register for memory panels; empty when unknown. */
  memory(partId: string): number[];
  /** Wires whose values are recorded every tick for the waveform panel (EDIT-11). */
  watch(wireIds: string[]): void;
  /** Recorded values of watched wires, oldest first, at most the last 4,096 ticks. */
  history(): { ticks: number[]; values: Record<string, BusValue[]> };
  step(ticks: number): void;
  run(hz: number): void;
  pause(): void;
  power(on: boolean): void;
  reset(): void;
  /** Resolves only after every onCase callback has been delivered (each one is awaited). */
  /** `board` defaults to the last loaded board (program tests patch its ROM); `budgetMs` is per test. */
  runTests(
    level: Level,
    onCase: (r: CaseResult) => void | Promise<void>,
    board?: Board,
    budgetMs?: number,
    /** Player's assembly for code levels ('riscv' tests). */
    source?: string,
  ): Promise<{ passed: number; total: number }>;
  /**
   * "Run this case": only case `caseIndex` of `level.tests[testIndex]`, with the
   * same result (tagged with `test`) a full runTests reports for it. Sequence
   * steps replay from power on; exhaustive/random reuse the run's vectors;
   * 'program', 'riscv' and 'js' tests are one case (index 0). Same `board`,
   * `budgetMs` and `source` rules as runTests.
   */
  runCase(level: Level, testIndex: number, caseIndex: number, board?: Board, budgetMs?: number, source?: string): Promise<CaseResult>;
  subscribe(onSnapshot: (s: Snapshot) => void): void;
}

/** A diagnostic in the player's source: 1-based line and column. */
export interface SourceDiagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning';
  /** File name: the player's file is 'main.s' ('main.c' in C levels); level libraries and libc use their own names. */
  file: string;
}

export interface RvLoadResult {
  ok: boolean;
  diagnostics: SourceDiagnostic[];
  /** Labels with their addresses, for the debugger. */
  symbols: { name: string; addr: number }[];
  entry: number;
  /** The test being debugged (rvLoad with `opts.test`), when it is a 'riscv' test. */
  test?: { index: number; name: string };
}

/** rvLoad options for "Debug this test". */
export interface RvLoadOptions {
  /** Index in `level.tests` of a 'riscv' test: the machine gets ITS setup, input and disk, and snapshots carry `test`. */
  test?: number;
  /** C levels: run the startup code and stop at the first instruction of `main`. */
  stopAtMain?: boolean;
}

/** The debugged test, live: every expectation with its current value, and the verdict once the program ends. */
export interface RvTestView {
  index: number;
  name: string;
  /** What the test sets before the first instruction (shown in the test panel). */
  setup: RunSetup;
  input?: string;
  /** The test's step limit; past it the test fails ("never stopped"). */
  maxSteps: number;
  /** Every expectation with its current value (UART cut around the first difference when long). */
  checks: RvCheck[];
  /**
   * The test's verdict for the run so far, set when the program ends (exit,
   * trap), reaches ebreak (where the test ends), waits forever, or runs past
   * maxSteps. Cleared when it runs again.
   */
  verdict?: RiscvCaseResult;
  /** With the verdict: how many times each line of the player's file ran (absent for runs over 1,000,000 steps). */
  lineHits?: { line: number; count: number }[];
}

export type RvStopReason = 'breakpoint' | 'step' | 'paused' | 'ebreak' | 'exit' | 'trap' | 'wfi' | 'budget' | 'error';

/** The RISC-V machine as the debugger sees it (code levels, Phase 6+). */
export interface RvState {
  pc: number;
  /** x0..x31, unsigned. */
  regs: number[];
  /** Source position of pc in the player's file, when it maps to one. */
  line?: number;
  file?: string;
  mode: 'M' | 'S' | 'U';
  instret: number;
  running: boolean;
  /** Why it last stopped; absent while running or before the first run. */
  reason?: RvStopReason;
  exitCode?: number;
  /** Last trap taken without a handler (cause, mtval, plain-English message). */
  trap?: { cause: number; tval: number; message: string };
  /** Selected CSRs for the debugger (mstatus, mepc, mcause, mtval, mtvec, mie, mip, satp…). */
  csrs: Record<string, number>;
}

export interface RvSnapshot {
  state: RvState;
  /** Everything the program printed to the UART (last 64 KiB). */
  uart: string;
  /** Bumps whenever framebuffer pixels or palette changed. */
  fbVersion: number;
  /** "Debug this test": the test's expectations against the machine now. */
  test?: RvTestView;
}

/** OS-05: how the MMU would translate one virtual address (RvApi.rvTranslate). */
export interface RvTranslation {
  va: number;
  satp: number;
  access: 'fetch' | 'load' | 'store';
  ok: boolean;
  /** The physical address (ok). */
  pa?: number;
  /** satp's MODE is Bare (or machine mode): no translation. */
  bare?: boolean;
  /** Level of the leaf (1 = 4 MiB superpage) and its PTE (ok). */
  level?: 0 | 1;
  pte?: number;
  /** The fault the access would raise (not ok): mcause, and why. */
  cause?: number;
  why?: 'access' | 'invalid' | 'reserved' | 'noLeaf' | 'notUser' | 'userPage' | 'noExec' | 'noRead' | 'noWrite' | 'misaligned';
  /** Each page-table entry read, root first. */
  steps: { level: 0 | 1; pteAddr: number; pte: number }[];
}

/**
 * Debugger commands for code levels. The same worker serves boards (SimApi)
 * and the RV32 machine (RvApi); they never run at the same time.
 */
export interface RvApi {
  /**
   * Assemble + link `source` with the level's library files, reset the machine
   * with the first test's setup, or with `opts.test`'s setup, input and disk
   * ("Debug this test"). The worker's SimHost answers asynchronously: it loads
   * the RISC-V subsystem on the first call.
   */
  rvLoad(source: string, level: Level, opts?: RvLoadOptions): RvLoadResult | Promise<RvLoadResult>;
  rvRun(): void;
  rvPause(): void;
  /** Execute n instructions (stops early at breakpoints/exit). */
  rvStep(n: number): void;
  /** Run until the next source line in the player's file (over calls: no). */
  rvStepLine(): void;
  rvReset(): void;
  /** Breakpoints by 1-based line in the player's file. */
  rvSetBreakpoints(lines: number[]): void;
  /** Send text to the UART receiver (console input) and keyboard device. */
  rvInput(text: string): void;
  rvMemory(addr: number, length: number): Uint8Array;
  /**
   * OS-05: `count` little-endian words of plain memory from `addr`, `stride`
   * bytes apart (default 4; 4096 reads the first word of each page). Zeros
   * outside memory.
   */
  rvReadWords(addr: number, count: number, stride?: number): Uint32Array;
  /**
   * OS-05: how the MMU would translate `va` through `satp` (default: the
   * current satp) for a user-mode access, without touching A/D bits or the TLB.
   */
  rvTranslate(va: number, satp?: number, access?: 'fetch' | 'load' | 'store'): RvTranslation | null;
  /** OS-05: `count` sectors (512 bytes) of the block device from `sector`; empty past its end. */
  rvDisk(sector: number, count: number): Uint8Array;
  /** 320x200 8-bit pixels + 256-entry RGBA palette, or null without a framebuffer. */
  rvFramebuffer(): { pixels: Uint8Array; palette: Uint32Array } | null;
  rvSubscribe(onSnapshot: (s: RvSnapshot) => void): void;
}

/** One training-progress sample for the loss curve (Track 2). */
export interface MlSample {
  step: number;
  /** Any numbers the player's code reports via report({loss, acc, …}). */
  values: Record<string, number>;
}

export interface JsRunState {
  running: boolean;
  /** console.log output and errors from the player's code (last 64 KiB). */
  log: string;
  samples: MlSample[];
  /** Last error, with the line in main.js when known. */
  error?: { message: string; line?: number; column?: number };
  /** Result of the last call, JSON-safe (tensors as {shape, data}). */
  result?: unknown;
  /** Latest checkpoint(state) from training code, for resume after a reload (E-ML-06). */
  checkpoint?: { step: number; state: unknown };
  /** "Debug this test" (jsDebugCall): the test's index, and its verdict once the call ends. */
  test?: { index: number; verdict?: JsCaseResult };
  /** The device the tensor modules got, and whether this run used the GPU (E-ML-01 badge). */
  device?: { available: 'webgpu' | 'cpu'; used: boolean; message: string };
}

/** What jsDebugCall resolves to. */
export interface JsDebugResult {
  ok: boolean;
  result?: unknown;
  error?: { message: string; line?: number };
  /** Index of the test in level.tests. */
  test: number;
  /** The test's verdict (as the checker judges it) with the full diff tree in `detail.diff`. */
  verdict?: JsCaseResult;
}

export interface JsCallOptions {
  /** Resume training: restoreCheckpoint() returns this state inside the sandbox. */
  resume?: { step: number; state: unknown };
}

/**
 * Track 2: run the player's JavaScript in a sandboxed worker (no network,
 * time limit, seeded Math.random — ASM-05, E-ML-*). Training code calls
 * report({...}) to stream samples and checkpoint(state) to save progress.
 */
export interface JsApi {
  /** Run `entry(...args)` from the player's module (main.js) with the level's modules and datasets. */
  jsCall(
    source: string,
    level: Level,
    entry: string,
    args: unknown[],
    opts?: JsCallOptions,
  ): Promise<{ ok: boolean; result?: unknown; error?: { message: string; line?: number } }>;
  /** "Debug this test": run only `level.tests[testIndex]` (its args, seed, time limit) and judge it; null for a non-'js' test. */
  jsDebugCall(source: string, level: Level, testIndex: number): Promise<JsDebugResult | null>;
  /** Stop the running code (terminates its sandbox). */
  jsStop(): void;
  jsSubscribe(onState: (s: JsRunState) => void): void;
}
