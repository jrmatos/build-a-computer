import { create } from 'zustand';
import type { Board, LevelPack, SharedBoard } from '@build-a-computer/schema';
import type { PackReport } from './packs';

/** A shared board being viewed read-only, and what to restore when the view closes. */
export interface SharedView {
  payload: SharedBoard;
  levelId: string | undefined;
  prev: { board: Board; past: Board[]; future: Board[]; readOnly: boolean };
}

export interface PackImport {
  fileName: string;
  pack: LevelPack;
  /** null while the worker is still checking. */
  report: PackReport | null;
  progress: { done: number; total: number };
  error?: string;
}

interface CommunityUi {
  shareOpen: boolean;
  editorOpen: boolean;
  shared: SharedView | null;
  /** A fork waiting for "replace my board?" confirmation. */
  pendingFork: SharedBoard | null;
  packImport: PackImport | null;
  set: (patch: Partial<Omit<CommunityUi, 'set'>>) => void;
}

export const useCommunityUi = create<CommunityUi>()((set) => ({
  shareOpen: false,
  editorOpen: false,
  shared: null,
  pendingFork: null,
  packImport: null,
  set: (patch) => set(patch),
}));
