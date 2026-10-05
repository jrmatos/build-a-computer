import * as Comlink from 'comlink';
import { create } from 'zustand';
import type { Board, ChipMap, Level } from '@build-a-computer/schema';
import { closure, type CaseResult } from '@build-a-computer/sim-logic';
import type { JsApi, JsDebugResult, JsRunState, RvApi, RvLoadOptions, RvLoadResult, RvSnapshot, SimApi, Snapshot } from '@build-a-computer/worker';
import type { CaseDebugApi, CaseDebugStart } from '@build-a-computer/worker';
import { t } from '../i18n';
import { useEditor } from '../editor/store';

/** The worker serves boards (SimApi), the RV32 machine (RvApi) and the Track 2 sandbox (JsApi). */
type Api = SimApi & RvApi & JsApi;

/**
 * Main-thread handle to the simulation worker. The UI never simulates: it
 * sends commands and draws the snapshots it gets back. A crashed worker is
 * restarted with the current board (E-SIM-11).
 */
let worker: Worker | null = null;
let api: Comlink.Remote<Api> | null = null;
let lastLoaded: { board: Board; chips: ChipMap } | null = null;
/** Last program loaded into the RV32 machine (code levels), replayed after a crash. */
let lastRv: { source: string; level: Level; opts?: RvLoadOptions } | null = null;

function start(): Comlink.Remote<Api> {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('error', restart);
  api = Comlink.wrap<Api>(worker);
  void api.subscribe(Comlink.proxy((s: Snapshot) => useEditor.getState().set({ snapshot: s })));
  api.rvSubscribe(Comlink.proxy(onRvSnapshot)).catch((e: unknown) => console.error(e));
  // A worker without the JS sandbox rejects this; js.call reports that when the player runs code.
  Promise.resolve(api.jsSubscribe(Comlink.proxy(onJsState))).catch(() => undefined);
  return api;
}

function restart(): void {
  worker?.terminate();
  worker = null;
  api = null;
  useEditor.getState().toast(t('toast.workerRestarted'), 'error');
  const remote = start();
  if (lastLoaded) void remote.load(lastLoaded.board, lastLoaded.chips);
  if (lastRv) {
    const { source, level, opts } = lastRv;
    void remote
      .rvLoad(source, level, opts)
      .then(() => remote.rvSetBreakpoints(useEditor.getState().breakpoints))
      .catch((e: unknown) => console.error(e));
  }
}

const remote = (): Comlink.Remote<Api> => api ?? start();

/** Run a call and restart the worker if it throws (out of memory, crash). */
async function call<T>(fn: (r: Comlink.Remote<Api>) => Promise<T>): Promise<T | undefined> {
  try {
    return await fn(remote());
  } catch (e) {
    console.error(e);
    restart();
    return undefined;
  }
}

let lastLoadError: string | undefined;

export const sim = {
  /** Compile `board` with the custom chips it uses (the worker flattens them). */
  load: (board: Board, chips: ChipMap = useEditor.getState().chips) => {
    const used = closure(board, chips);
    lastLoaded = { board, chips: used };
    // Keep compile diagnostics for the diagnostics panel (EDIT-10).
    // The level's power-on mode applies to the live board too (E-SIM-07).
    const power = useEditor.getState().level?.power ?? 'zero';
    return call((r) => r.load(board, used, { power })).then((res) => {
      if (res) useEditor.getState().set({ diagnostics: res.diagnostics });
      // Refusals (too large, chip cycle, too much state) are not diagnostics; say why once.
      if (res && !res.ok && res.error && res.error !== lastLoadError) useEditor.getState().toast(res.error, 'error');
      lastLoadError = res && !res.ok ? res.error : undefined;
      return res;
    });
  },
  setSwitch: (partId: string, on: boolean) => call((r) => r.setSwitch(partId, on)),
  /** Flip a switch using the latest snapshot's state. */
  toggleSwitch: (partId: string) => {
    const on = useEditor.getState().snapshot?.switchesOn.includes(partId) ?? false;
    return call((r) => r.setSwitch(partId, !on));
  },
  /** Waveform recording and memory panels (bottom dock). */
  watch: (wireIds: string[]) => call((r) => r.watch(wireIds)),
  history: () => call((r) => r.history()),
  memory: (partId: string) => call((r) => r.memory(partId)),
  /** Set a multi-bit switch (number input) to an unsigned value. */
  setValue: (partId: string, value: number) => call((r) => r.setValue(partId, value >>> 0)),
  /** Momentary button: true while held. */
  press: (partId: string, down: boolean) => call((r) => r.press(partId, down)),
  step: (ticks = 1) => call((r) => r.step(ticks)),
  run: (hz: number) => call((r) => r.run(hz)),
  pause: () => call((r) => r.pause()),
  power: (on: boolean) => call((r) => r.power(on)),
  reset: () => call((r) => r.reset()),
  runTests: async (onCase: (c: CaseResult) => void) => {
    const { level, editStack } = useEditor.getState();
    // Inside a chip the sim runs the chip's own board: level tests do not apply.
    if (!level || editStack.length) return undefined;
    const { board, source } = useEditor.getState();
    // Tests run on the level's own board (chips are flattened in the worker); code levels send the source.
    type RunTests = (l: typeof level, cb: typeof onCase, b?: Board, budgetMs?: number, src?: string) => Promise<{ passed: number; total: number }>;
    const src = level.mode === 'code' || level.mode === 'js' ? source : undefined;
    return call((r) => (r.runTests as unknown as RunTests)(level, Comlink.proxy(onCase), board, undefined, src));
  },
  /** "Run this case": only that case of `level.tests[test]`, on the level's board (code levels: the source). */
  runCase: async (test: number, index: number) => {
    const { level, editStack, board, source } = useEditor.getState();
    if (!level || editStack.length) return undefined;
    const src = level.mode === 'code' || level.mode === 'js' ? source : undefined;
    return call((r) => r.runCase(level, test, index, board, undefined, src));
  },
  /** Case debugger (level/debug): replay one test case on the live board, then show any frame of it. */
  debugStart: (level: Level, test: number, index: number, inputs: Record<string, number> | undefined, board: Board) =>
    call((r) => (r as unknown as Comlink.Remote<CaseDebugApi>).debugStart(level, test, index, inputs, board) as Promise<CaseDebugStart>),
  debugSeek: (frame: number) => call((r) => (r as unknown as Comlink.Remote<CaseDebugApi>).debugSeek(frame)),
  debugEnd: () => call((r) => (r as unknown as Comlink.Remote<CaseDebugApi>).debugEnd()),
};

// ---------- RV32 debugger (code levels) ----------

/** Debugger data the store does not hold: symbols from the last load and registers at the previous stop. */
export interface RvDebug {
  symbols: { name: string; addr: number }[];
  entry: number;
  /** Registers at the stop before the current one, for "changed" highlights. */
  prevRegs: number[] | null;
  /** Bumps on every new stop (after run, step, reset or load). */
  stop: number;
  /** Bumps on every load (the machine and its UART start empty). */
  loads: number;
  /** The source and level of the last successful load; Run reloads when they change. */
  loaded: { source: string; level: Level } | null;
  /** "Debug this test": index in level.tests of the 'riscv' test the machine is set up for, or null. */
  test: number | null;
}

export const useRvDebug = create<RvDebug>()(() => ({ symbols: [], entry: 0, prevRegs: null, stop: 0, loads: 0, loaded: null, test: null }));

/** rvLoad options for the test being debugged (C levels stop at main). */
function debugOptions(level: Level): RvLoadOptions | undefined {
  const test = useRvDebug.getState().test;
  if (test === null || level.tests[test]?.kind !== 'riscv') return undefined;
  return { test, stopAtMain: level.code?.language === 'c' };
}

let lastStopKey = '';
let lastStopRegs: number[] | null = null;

function onRvSnapshot(s: RvSnapshot): void {
  useEditor.getState().set({ rv: s });
  if (s.state.running) return;
  const key = `${s.state.instret}:${s.state.pc}:${s.state.reason ?? ''}`;
  if (key === lastStopKey) return;
  lastStopKey = key;
  useRvDebug.setState((d) => ({ prevRegs: lastStopRegs, stop: d.stop + 1 }));
  lastStopRegs = s.state.regs.slice();
}

/** States after which Run or Step starts the program again from the top. */
const FINISHED = new Set(['exit', 'trap', 'error']);

/** True when the editor's source or level differ from what the machine runs. */
function stale(): boolean {
  const { source, level } = useEditor.getState();
  const loaded = useRvDebug.getState().loaded;
  // Compare levels by id and version: the store may swap in an equal level object.
  return !loaded || !level || loaded.source !== source || loaded.level.id !== level.id || loaded.level.version !== level.version;
}

async function rvLoad(quiet = false): Promise<RvLoadResult | undefined> {
  const { source, level, breakpoints } = useEditor.getState();
  if (!level || level.mode !== 'code') return undefined;
  if (quiet && !source.trim()) return undefined;
  const opts = debugOptions(level);
  const res = await call((r) => r.rvLoad(source, level, opts));
  if (!res) return undefined;
  useEditor.getState().set({ codeDiagnostics: res.diagnostics });
  lastStopRegs = null;
  lastStopKey = '';
  useRvDebug.setState((d) => ({ symbols: res.symbols, entry: res.entry, prevRegs: null, loads: d.loads + 1, loaded: res.ok ? { source, level } : null }));
  if (res.ok) {
    lastRv = { source, level, ...(opts ? { opts } : {}) };
    await call((r) => r.rvSetBreakpoints(breakpoints));
  } else {
    lastRv = null;
  }
  if (!res.ok && !quiet) {
    const n = res.diagnostics.filter((d) => d.severity === 'error').length;
    useEditor.getState().toast(t('panels.rv.loadFailed', { n }), 'error');
  }
  return res;
}

/** Load (or reload) before running when the source changed or the program finished. */
async function ready(): Promise<boolean> {
  const st = useEditor.getState().rv?.state;
  if (stale() || (st?.reason && FINISHED.has(st.reason))) {
    const res = await rvLoad();
    return !!res?.ok;
  }
  return true;
}

export const rv = {
  /** Assemble the editor's source and reset the machine with the level's setup. */
  load: () => rvLoad(),
  run: async () => {
    if (await ready()) await call((r) => r.rvRun());
  },
  pause: () => call((r) => r.rvPause()),
  /** Run or continue; pause when already running. */
  toggle: () => (useEditor.getState().rv?.state.running ? rv.pause() : rv.run()),
  step: async (n = 1) => {
    if (await ready()) await call((r) => r.rvStep(n));
  },
  stepLine: async () => {
    if (await ready()) await call((r) => r.rvStepLine());
  },
  /** Reset to the entry point; picks up source edits. */
  reset: () => rvLoad(),
  input: (text: string) => call((r) => r.rvInput(text)),
  memory: (addr: number, length: number) => call((r) => r.rvMemory(addr >>> 0, length)),
  framebuffer: () => call((r) => r.rvFramebuffer()),
  /**
   * "Debug this test": reload the machine with `level.tests[index]`'s setup,
   * input and disk (stopped at the entry, or at main in C). Snapshots then
   * carry the test's expectations (`rv.test`); Reset and reloads keep the test.
   */
  debugTest: async (index: number) => {
    const level = useEditor.getState().level;
    if (!level || level.mode !== 'code' || level.tests[index]?.kind !== 'riscv') return undefined;
    if (useEditor.getState().rv?.state.running) await call((r) => r.rvPause());
    useRvDebug.setState({ test: index });
    return rvLoad();
  },
  /** Leave test debugging: back to the plain debugger (first test's setup). */
  stopDebug: async () => {
    if (useRvDebug.getState().test === null) return undefined;
    useRvDebug.setState({ test: null });
    return rvLoad(true);
  },
};

/** Keep the machine's breakpoints in step with the editor and load each code level once on open. */
function startRvSync(): void {
  let bps = useEditor.getState().breakpoints;
  let level = useEditor.getState().level;
  const onLevel = () => {
    lastRv = null;
    lastStopKey = '';
    lastStopRegs = null;
    useRvDebug.setState({ symbols: [], entry: 0, prevRegs: null, loaded: null, test: null });
    useEditor.getState().set({ rv: null });
    if (level?.mode === 'code') void rvLoad(true);
  };
  if (level?.mode === 'code') void rvLoad(true);
  useEditor.subscribe((s) => {
    if (s.level !== level) {
      level = s.level;
      // Let the level's source land in the store before assembling it.
      queueMicrotask(onLevel);
    }
    if (s.breakpoints !== bps) {
      bps = s.breakpoints;
      if (s.level?.mode === 'code') void call((r) => r.rvSetBreakpoints(bps));
    }
  });
}

// ---------- Track 2: the player's JavaScript (js levels) ----------

/** What jsCall resolves to. */
export type JsCallResult = Awaited<ReturnType<JsApi['jsCall']>>;

/** Options the workspace may pass with a call; a sandbox that does not know them ignores them. */
export interface JsCallOptions {
  /** Resume training from a saved checkpoint (E-ML-06): the state the code passed to checkpoint(state). */
  resume?: { step: number; state: unknown };
}

/** Bumps per call so a late stream from an earlier run cannot overwrite a newer one's start. */
let jsRun = 0;

/** "Debug this test" on js levels: the test being debugged and the outcome of its last run. */
export interface JsDebugState {
  /** Index in level.tests, or null when not debugging a test. */
  test: number | null;
  running: boolean;
  /** The last debug run of `test` (verdict with the full diff). */
  result: JsDebugResult | null;
}

export const useJsDebug = create<JsDebugState>()(() => ({ test: null, running: false, result: null }));

function onJsState(s: JsRunState): void {
  if (useEditor.getState().level?.mode !== 'js') return;
  useEditor.getState().set({ js: s });
}

const emptyJs = (): JsRunState => ({ running: false, log: '', samples: [] });

export const js = {
  /**
   * Call `entry(...args)` from the player's main.js in the sandbox. State
   * (console, samples, errors) streams into store.js; the final result is
   * merged in when the call resolves.
   */
  call: async (entry: string, args: unknown[], opts?: JsCallOptions): Promise<JsCallResult | undefined> => {
    const { source, level } = useEditor.getState();
    if (!level || level.mode !== 'js') return undefined;
    const run = ++jsRun;
    useEditor.getState().set({ js: { ...emptyJs(), running: true } });
    type Call = (src: string, l: Level, e: string, a: unknown[], o?: JsCallOptions) => Promise<JsCallResult>;
    let res: JsCallResult | undefined;
    try {
      res = await (remote().jsCall as unknown as Call)(source, level, entry, args, opts);
    } catch (e) {
      res = { ok: false, error: { message: t('ml.run.unavailable', { reason: e instanceof Error ? e.message : String(e) }) } };
    }
    const cur = useEditor.getState();
    if (run !== jsRun || cur.level?.id !== level.id) return res;
    const prev = cur.js ?? emptyJs();
    cur.set({
      js: {
        ...prev,
        running: false,
        result: res.ok ? res.result : prev.result,
        error: res.ok ? undefined : (res.error ?? prev.error),
      },
    });
    return res;
  },
  /**
   * "Debug this test": run only `level.tests[index]` with its args, seed and
   * time limit. Console and samples stream into store.js as for `call`; the
   * verdict (as the checker judges it, with the full diff) lands in useJsDebug.
   */
  debug: async (index: number): Promise<JsDebugResult | null | undefined> => {
    const { source, level } = useEditor.getState();
    if (!level || level.mode !== 'js' || level.tests[index]?.kind !== 'js') return undefined;
    const run = ++jsRun;
    useJsDebug.setState({ test: index, running: true, result: null });
    useEditor.getState().set({ js: { ...emptyJs(), running: true } });
    type Debug = (src: string, l: Level, i: number) => Promise<JsDebugResult | null>;
    let res: JsDebugResult | null;
    try {
      res = await (remote().jsDebugCall as unknown as Debug)(source, level, index);
    } catch (e) {
      res = { ok: false, test: index, error: { message: t('ml.run.unavailable', { reason: e instanceof Error ? e.message : String(e) }) } };
    }
    const cur = useEditor.getState();
    if (run !== jsRun || cur.level?.id !== level.id) return res;
    useJsDebug.setState({ test: index, running: false, result: res });
    const prev = cur.js ?? emptyJs();
    cur.set({
      js: {
        ...prev,
        running: false,
        result: res?.ok ? res.result : prev.result,
        error: res && !res.ok ? (res.error ?? prev.error) : undefined,
      },
    });
    return res;
  },
  /** Close the test debugger. */
  closeDebug: () => useJsDebug.setState({ test: null, running: false, result: null }),
  /** Stop the running code (terminates its sandbox). */
  stop: async () => {
    jsRun++;
    if (useJsDebug.getState().running) useJsDebug.setState({ running: false });
    try {
      await remote().jsStop();
    } catch (e) {
      console.error(e);
    }
    const cur = useEditor.getState();
    if (cur.js?.running) cur.set({ js: { ...cur.js, running: false } });
  },
  /** Forget the last run's output (console, result, curves). */
  clear: () => useEditor.getState().set({ js: null }),
};

/** Stop the sandbox and clear its output when the player leaves a js level. */
function startJsSync(): void {
  let level = useEditor.getState().level;
  useEditor.subscribe((s) => {
    if (s.level === level) return;
    const was = level;
    level = s.level;
    if (was?.mode === 'js' && was.id !== s.level?.id) {
      if (s.js?.running) void js.stop();
      useEditor.getState().set({ js: null });
      useJsDebug.setState({ test: null, running: false, result: null });
    }
  });
}

/** Reload the netlist whenever the board or the chip library changes, at most once per frame. */
export function startSimSync(): void {
  let pending = false;
  let last: Board | null = null;
  let lastChips: ChipMap | null = null;
  let lastUsed = '';
  const flush = () => {
    pending = false;
    const { board, chips } = useEditor.getState();
    if (board === last && chips === lastChips) return;
    // A library change only matters when it touches a chip this board uses.
    const usedKey = usedVersions(board, chips);
    if (board === last && usedKey === lastUsed) {
      lastChips = chips;
      return;
    }
    last = board;
    lastChips = chips;
    lastUsed = usedKey;
    void sim.load(board, chips);
  };
  flush();
  startRvSync();
  startJsSync();
  useEditor.subscribe((s) => {
    if ((s.board !== last || s.chips !== lastChips) && !pending) {
      pending = true;
      requestAnimationFrame(flush);
    }
  });
  // E-SIM-12: pause a running clock while the tab is hidden; resume on return.
  let pausedByHide = false;
  document.addEventListener('visibilitychange', () => {
    const { snapshot, rv: rvSnap, level } = useEditor.getState();
    const code = level?.mode === 'code';
    const running = code ? rvSnap?.state.running : snapshot?.running;
    if (document.hidden && running) {
      pausedByHide = true;
      void (code ? rv.pause() : sim.pause());
    } else if (!document.hidden && pausedByHide) {
      pausedByHide = false;
      void (code ? call((r) => r.rvRun()) : sim.run(useEditor.getState().speedHz));
    }
  });
}

/** Fingerprint of the chip definitions a board uses (ids and versions). */
function usedVersions(board: Board, chips: ChipMap): string {
  return Object.values(closure(board, chips))
    .map((c) => `${c.id}@${c.version}`)
    .sort()
    .join(',');
}
