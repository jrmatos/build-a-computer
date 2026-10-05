import { create } from 'zustand';
import { PART_TYPES, type Board, type Level, type PartType } from '@ground-up/schema';
import type { CaseResult } from '@ground-up/sim-logic';
import type { Snapshot } from '@ground-up/worker';

/** Grid cell size in CSS pixels at 100% zoom. */
export const GRID = 20;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;
const HISTORY_LIMIT = 1000;

export type Tool = 'select' | 'hand' | 'wire' | `place:${PartType}`;
export type Theme = 'dark' | 'light';

/** World point under screen point: world = screen / (zoom * GRID) + camera. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

export interface TestRun {
  running: boolean;
  cases: CaseResult[];
  passed: number;
  total: number;
}

export interface EditorState {
  level: Level | null;
  board: Board;
  past: Board[];
  future: Board[];
  /** Board before an ongoing drag; committed as one history step. */
  transientBase: Board | null;
  selection: string[];
  tool: Tool;
  toolLocked: boolean;
  camera: Camera;
  theme: Theme;
  showGrid: boolean;
  libraryOpen: boolean;
  helpOpen: boolean;
  levelsOpen: boolean;
  snapshot: Snapshot | null;
  speedHz: number;
  testRun: TestRun | null;
  completed: string[];
  readOnly: boolean;
  storageMode: 'indexeddb' | 'memory';
  toasts: Toast[];
  /** Open context menu at screen point (CSS px), with the world point it was opened on. */
  contextMenu: { x: number; y: number; world: { x: number; y: number } } | null;
  /** Part whose label is being edited inline on the canvas. */
  editingLabel: string | null;

  /** Apply an edit as one undoable step. */
  commit: (fn: (b: Board) => Board, selection?: string[]) => void;
  beginTransient: () => void;
  setTransient: (b: Board) => void;
  endTransient: () => void;
  undo: () => void;
  redo: () => void;
  setSelection: (ids: string[]) => void;
  setTool: (t: Tool) => void;
  setCamera: (c: Camera) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  set: (patch: Partial<EditorState>) => void;
}

let toastId = 0;

export const useEditor = create<EditorState>()((set, get) => ({
  level: null,
  board: { parts: [], wires: [] },
  past: [],
  future: [],
  transientBase: null,
  selection: [],
  tool: 'select',
  toolLocked: false,
  camera: { x: -20, y: -12, zoom: 1 },
  theme: 'dark',
  showGrid: true,
  libraryOpen: false,
  helpOpen: false,
  levelsOpen: false,
  snapshot: null,
  speedHz: 4,
  testRun: null,
  completed: [],
  readOnly: false,
  storageMode: 'indexeddb',
  toasts: [],
  contextMenu: null,
  editingLabel: null,

  commit: (fn, selection) => {
    const { board, past, readOnly } = get();
    if (readOnly) return;
    const next = fn(board);
    if (next === board) {
      if (selection) set({ selection });
      return;
    }
    set({
      board: next,
      past: [...past, board].slice(-HISTORY_LIMIT),
      future: [],
      ...(selection ? { selection } : {}),
    });
  },
  beginTransient: () => set({ transientBase: get().board }),
  setTransient: (b) => {
    if (!get().readOnly) set({ board: b });
  },
  endTransient: () => {
    const { transientBase, board, past } = get();
    if (transientBase && transientBase !== board) {
      set({ past: [...past, transientBase].slice(-HISTORY_LIMIT), future: [], transientBase: null });
    } else set({ transientBase: null });
  },
  undo: () => {
    const { past, board, future, readOnly } = get();
    const prev = past[past.length - 1];
    if (!prev || readOnly) return;
    set({ board: prev, past: past.slice(0, -1), future: [board, ...future], selection: keepExisting(get().selection, prev) });
  },
  redo: () => {
    const { past, board, future, readOnly } = get();
    const next = future[0];
    if (!next || readOnly) return;
    set({ board: next, past: [...past, board], future: future.slice(1), selection: keepExisting(get().selection, next) });
  },
  setSelection: (ids) => set({ selection: ids }),
  setTool: (tool) => set({ tool, ...(tool === 'select' ? {} : { selection: [] }) }),
  setCamera: (camera) => set({ camera }),
  toast: (text, tone = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4000);
  },
  set: (patch) => set(patch),
}));

function keepExisting(selection: string[], board: Board): string[] {
  const ids = new Set([...board.parts.map((p) => p.id), ...board.wires.map((w) => w.id)]);
  return selection.filter((id) => ids.has(id));
}

/** Parts the current level allows, or all of them in the sandbox. */
export function allowedParts(level: Level | null): Set<PartType> {
  return new Set(level?.palette ?? PART_TYPES);
}
