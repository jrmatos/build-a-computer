import * as Comlink from 'comlink';
import type { Board, ChipMap } from '@ground-up/schema';
import { closure, type CaseResult } from '@ground-up/sim-logic';
import type { SimApi, Snapshot } from '@ground-up/worker';
import { t } from '../i18n';
import { useEditor } from '../editor/store';

/**
 * Main-thread handle to the simulation worker. The UI never simulates: it
 * sends commands and draws the snapshots it gets back. A crashed worker is
 * restarted with the current board (E-SIM-11).
 */
let worker: Worker | null = null;
let api: Comlink.Remote<SimApi> | null = null;
let lastLoaded: { board: Board; chips: ChipMap } | null = null;

function start(): Comlink.Remote<SimApi> {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('error', restart);
  api = Comlink.wrap<SimApi>(worker);
  void api.subscribe(Comlink.proxy((s: Snapshot) => useEditor.getState().set({ snapshot: s })));
  return api;
}

function restart(): void {
  worker?.terminate();
  worker = null;
  api = null;
  useEditor.getState().toast(t('toast.workerRestarted'), 'error');
  const remote = start();
  if (lastLoaded) void remote.load(lastLoaded.board, lastLoaded.chips);
}

const remote = (): Comlink.Remote<SimApi> => api ?? start();

/** Run a call and restart the worker if it throws (out of memory, crash). */
async function call<T>(fn: (r: Comlink.Remote<SimApi>) => Promise<T>): Promise<T | undefined> {
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
    const { board } = useEditor.getState();
    // Tests run on the level's own board (chips are flattened in the worker).
    type RunTests = (l: typeof level, cb: typeof onCase, b?: Board) => Promise<{ passed: number; total: number }>;
    return call((r) => (r.runTests as unknown as RunTests)(level, Comlink.proxy(onCase), board));
  },
};

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
  useEditor.subscribe((s) => {
    if ((s.board !== last || s.chips !== lastChips) && !pending) {
      pending = true;
      requestAnimationFrame(flush);
    }
  });
  // E-SIM-12: pause a running clock while the tab is hidden; resume on return.
  let pausedByHide = false;
  document.addEventListener('visibilitychange', () => {
    const running = useEditor.getState().snapshot?.running;
    if (document.hidden && running) {
      pausedByHide = true;
      void sim.pause();
    } else if (!document.hidden && pausedByHide) {
      pausedByHide = false;
      void sim.run(useEditor.getState().speedHz);
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
