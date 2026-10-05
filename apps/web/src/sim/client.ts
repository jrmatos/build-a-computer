import * as Comlink from 'comlink';
import type { Board } from '@ground-up/schema';
import type { CaseResult } from '@ground-up/sim-logic';
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
let lastLoaded: Board | null = null;

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
  if (lastLoaded) void remote.load(lastLoaded);
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

export const sim = {
  load: (board: Board) => {
    lastLoaded = board;
    return call((r) => r.load(board));
  },
  setSwitch: (partId: string, on: boolean) => call((r) => r.setSwitch(partId, on)),
  /** Flip a switch using the latest snapshot's state. */
  toggleSwitch: (partId: string) => {
    const on = useEditor.getState().snapshot?.switchesOn.includes(partId) ?? false;
    return call((r) => r.setSwitch(partId, !on));
  },
  step: (ticks = 1) => call((r) => r.step(ticks)),
  run: (hz: number) => call((r) => r.run(hz)),
  pause: () => call((r) => r.pause()),
  power: (on: boolean) => call((r) => r.power(on)),
  reset: () => call((r) => r.reset()),
  runTests: async (onCase: (c: CaseResult) => void) => {
    const level = useEditor.getState().level;
    if (!level) return undefined;
    return call((r) => r.runTests(level, Comlink.proxy(onCase)));
  },
};

/** Reload the netlist whenever the board changes, at most once per frame. */
export function startSimSync(): void {
  let pending = false;
  let last: Board | null = null;
  const flush = () => {
    pending = false;
    const { board } = useEditor.getState();
    if (board === last) return;
    last = board;
    void sim.load(board);
  };
  flush();
  useEditor.subscribe((s) => {
    if (s.board !== last && !pending) {
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
