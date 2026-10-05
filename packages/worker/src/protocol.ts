import type { Board, ChipMap, Level } from '@ground-up/schema';
import type { CaseResult, Diagnostic } from '@ground-up/sim-logic';

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

export interface LoadResult {
  ok: boolean;
  error?: string;
  diagnostics: Diagnostic[];
}

/** Commands the UI sends to the simulation worker (see plan: Worker protocol). */
export interface SimApi {
  /** Compile the board with its custom chips (flattened in the worker) and power on. */
  load(board: Board, chips?: ChipMap): LoadResult;
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
  runTests(level: Level, onCase: (r: CaseResult) => void | Promise<void>): Promise<{ passed: number; total: number }>;
  subscribe(onSnapshot: (s: Snapshot) => void): void;
}
