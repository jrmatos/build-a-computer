import { create } from 'zustand';

/** Bottom dock tabs, Turing Complete style. */
export const DOCK_TABS = ['waveform', 'diagnostics', 'memory', 'program'] as const;
export type DockTab = (typeof DOCK_TABS)[number];

export const MIN_HEIGHT = 140;
export const MAX_HEIGHT = 640;
const STORAGE_KEY = 'ground-up:dock';

interface Persisted {
  open: boolean;
  tab: DockTab;
  height: number;
}

export interface DockState extends Persisted {
  /** Wires pinned to the waveform, in lane order. */
  pinned: string[];
  setOpen: (open: boolean) => void;
  setTab: (tab: DockTab) => void;
  setHeight: (h: number) => void;
  pin: (wireId: string) => void;
  unpin: (wireId: string) => void;
  /** Move a lane up (-1) or down (+1). */
  movePin: (wireId: string, dir: -1 | 1) => void;
  setPinned: (ids: string[]) => void;
}

export const clampHeight = (h: number): number => Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)));

/** Per-viewer convenience; storage can be missing or throw (private mode), so every access is guarded. */
function load(): Persisted {
  const fallback: Persisted = { open: false, tab: 'waveform', height: 240 };
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<Persisted>;
    return {
      open: typeof v.open === 'boolean' ? v.open : fallback.open,
      tab: DOCK_TABS.includes(v.tab as DockTab) ? (v.tab as DockTab) : fallback.tab,
      height: typeof v.height === 'number' && Number.isFinite(v.height) ? clampHeight(v.height) : fallback.height,
    };
  } catch {
    return fallback;
  }
}

function save(p: Persisted): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: the dock still works, it just forgets */
  }
}

export const useDock = create<DockState>()((set, get) => {
  const persist = () => {
    const { open, tab, height } = get();
    save({ open, tab, height });
  };
  return {
    ...load(),
    pinned: [],
    setOpen: (open) => {
      set({ open });
      persist();
    },
    setTab: (tab) => {
      set({ tab, open: true });
      persist();
    },
    setHeight: (h) => {
      set({ height: clampHeight(h) });
      persist();
    },
    pin: (id) => {
      if (!get().pinned.includes(id)) set({ pinned: [...get().pinned, id] });
    },
    unpin: (id) => set({ pinned: get().pinned.filter((p) => p !== id) }),
    movePin: (id, dir) => {
      const list = [...get().pinned];
      const i = list.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j]!, list[i]!];
      set({ pinned: list });
    },
    setPinned: (pinned) => set({ pinned }),
  };
});
