import * as Comlink from 'comlink';
import { create } from 'zustand';
import type { Board, ChipMap, Level } from '@build-a-computer/schema';
import { closure, type CaseResult } from '@build-a-computer/sim-logic';
import type { RvApi, RvLoadResult, RvSnapshot, SimApi, Snapshot } from '@build-a-computer/worker';
import { t } from '../i18n';
import { useEditor } from '../editor/store';

/** The worker serves boards (SimApi) and the RV32 machine (RvApi). */
type Api = SimApi & RvApi;

/**
 * Main-thread handle to the simulation worker. The UI never simulates: it
 * sends commands and draws the snapshots it gets back. A crashed worker is
 * restarted with the current board (E-SIM-11).
 */
let worker: Worker | null = null;
let api: Comlink.Remote<Api> | null = null;
let lastLoaded: { board: Board; chips: ChipMap } | null = null;
/** Last program loaded into the RV32 machine (code levels), replayed after a crash. */
let lastRv: { source: string; level: Level } | null = null;

function start(): Comlink.Remote<Api> {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('error', restart);
  api = Comlink.wrap<Api>(worker);
  void api.subscribe(Comlink.proxy((s: Snapshot) => useEditor.getState().set({ snapshot: s })));
  api.rvSubscribe(Comlink.proxy(onRvSnapshot)).catch((e: unknown) => console.error(e));
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
    const { source, level } = lastRv;
    void remote
      .rvLoad(source, level)
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
    const src = level.mode === 'code' ? source : undefined;
    return call((r) => (r.runTests as unknown as RunTests)(level, Comlink.proxy(onCase), board, undefined, src));
  },
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
}

export const useRvDebug = create<RvDebug>()(() => ({ symbols: [], entry: 0, prevRegs: null, stop: 0, loads: 0, loaded: null }));

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
  const res = await call((r) => r.rvLoad(source, level));
  if (!res) return undefined;
  useEditor.getState().set({ codeDiagnostics: res.diagnostics });
  lastStopRegs = null;
  lastStopKey = '';
  useRvDebug.setState((d) => ({ symbols: res.symbols, entry: res.entry, prevRegs: null, loads: d.loads + 1, loaded: res.ok ? { source, level } : null }));
  if (res.ok) {
    lastRv = { source, level };
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
};

/** Keep the machine's breakpoints in step with the editor and load each code level once on open. */
function startRvSync(): void {
  let bps = useEditor.getState().breakpoints;
  let level = useEditor.getState().level;
  const onLevel = () => {
    lastRv = null;
    lastStopKey = '';
    lastStopRegs = null;
    useRvDebug.setState({ symbols: [], entry: 0, prevRegs: null, loaded: null });
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
