import type { Board, Level } from '@ground-up/schema';
import type { CaseResult, Diagnostic } from '@ground-up/sim-logic';

/** A snapshot of the running simulation, posted to the UI at most 60 times a second. */
export interface Snapshot {
  /** Net value per wire id: 0, 1 or 2 (X). */
  wires: Record<string, number>;
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

export interface LoadResult {
  ok: boolean;
  error?: string;
  diagnostics: Diagnostic[];
}

/** Commands the UI sends to the simulation worker (see plan: Worker protocol). */
export interface SimApi {
  load(board: Board): LoadResult;
  setSwitch(partId: string, on: boolean): void;
  step(ticks: number): void;
  run(hz: number): void;
  pause(): void;
  power(on: boolean): void;
  reset(): void;
  /** Resolves only after every onCase callback has been delivered (each one is awaited). */
  runTests(level: Level, onCase: (r: CaseResult) => void | Promise<void>): Promise<{ passed: number; total: number }>;
  subscribe(onSnapshot: (s: Snapshot) => void): void;
}
