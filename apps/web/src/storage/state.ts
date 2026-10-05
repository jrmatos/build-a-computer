/** UI state for files and the workspace: the status indicator and the import preview. */
import type { Workspace } from '@build-a-computer/schema';
import { create } from 'zustand';
import type { SyncState } from './autosave';
import type { WorkspaceMerge } from './merge';
import type { PersistResult } from './persistence';
import type { FileHandleLike } from './provider';

export interface ImportPreview {
  fileName: string;
  /** 'open' connects the file for autosave after applying; 'import' only merges. */
  mode: 'import' | 'open';
  workspace: Workspace;
  merge: WorkspaceMerge;
  handle?: FileHandleLike;
  lastModified?: number;
}

export interface FileUiState {
  /** File System Access API available (Chrome, Edge). */
  fsa: boolean;
  sync: SyncState;
  /** A file from a previous visit that can be reconnected with a click. */
  reconnect: { name: string } | null;
  persist: PersistResult | null;
  preview: ImportPreview | null;
  set(patch: Partial<Omit<FileUiState, 'set'>>): void;
}

export const useFileUi = create<FileUiState>()((set) => ({
  fsa: false,
  sync: { status: 'none', fileName: null, error: null, savedAt: null },
  reconnect: null,
  persist: null,
  preview: null,
  set: (patch) => set(patch),
}));
