import type { BusValue } from '@build-a-computer/worker';
import { useEditor } from '../../editor/store';
import { sim } from '../../sim/client';
import { HISTORY_TICKS, type History } from './waveform';

/**
 * Where the dock reads recorded values and memory. Normally the worker; in
 * dev builds `?fakeDock` swaps in a synthetic source so the panels can be
 * checked visually before the engine records history.
 */
export interface DockSource {
  watch(ids: string[]): Promise<void>;
  history(): Promise<History | undefined>;
  memory(partId: string): Promise<number[] | undefined>;
  /** True while values change on their own (clock running). */
  live(): boolean;
}

const workerSource: DockSource = {
  watch: async (ids) => {
    await sim.watch(ids);
  },
  history: () => sim.history(),
  memory: (id) => sim.memory(id),
  live: () => !!useEditor.getState().snapshot?.running,
};

/** Synthetic data for dev previews only. */
function fakeSource(): DockSource {
  let watched: string[] = [];
  const t0 = performance.now();
  const tickNow = () => Math.floor((performance.now() - t0) / 50);
  const valueAt = (id: string, i: number, k: number): BusValue => {
    if (k === 0) return { w: 1, v: i & 1, x: 0 };
    if (k % 3 === 1) return { w: 1, v: (i >> k) & 1, x: i % 97 < 5 ? 1 : 0 };
    const w = k % 2 ? 8 : 16;
    return { w, v: (Math.floor(i / (2 + k)) * 37 + id.length) % 2 ** w, x: i % 211 < 6 ? 0xf : 0 };
  };
  return {
    watch: async (ids) => {
      watched = ids;
    },
    history: async () => {
      const end = tickNow();
      const start = Math.max(0, end - HISTORY_TICKS);
      const ticks: number[] = [];
      for (let i = start; i < end; i++) ticks.push(i);
      const values: Record<string, BusValue[]> = {};
      watched.forEach((id, k) => (values[id] = ticks.map((i) => valueAt(id, i, k))));
      return { ticks, values };
    },
    memory: async (id) => {
      const p = useEditor.getState().board.parts.find((q) => q.id === id);
      if (!p) return [];
      if (p.type === 'register' || p.type === 'counter') return [tickNow() % 256];
      const n = 2 ** (p.props?.addrWidth ?? 8);
      const s = Math.floor(tickNow() / 4);
      return Array.from({ length: n }, (_, i) => (i * 7 + (i % 16 === s % 16 ? s : 0)) & 0xff);
    },
    live: () => true,
  };
}

const wantFake = (): boolean => {
  if (!import.meta.env?.DEV) return false;
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').has('fakeDock');
  } catch {
    return false;
  }
};

export const dockSource: DockSource = wantFake() ? fakeSource() : workerSource;
