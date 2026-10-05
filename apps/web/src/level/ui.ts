import { create } from 'zustand';

/** Level-area UI state that the shared editor store does not carry. */
export interface LevelUi {
  /** E-DATA-01: 'elsewhere' when another tab holds the level, 'stolen' when it took it from us. */
  lock: 'held' | 'elsewhere' | 'stolen';
  /** E-DATA-04: the current level's save is from a newer app version; it is never overwritten. */
  newerSave: boolean;
  /** E-DATA-02: why storage fell back to memory. */
  memoryReason: 'unavailable' | 'quota' | null;
  /** Level whose success card is showing. */
  justCompleted: string | null;
  set: (patch: Partial<LevelUi>) => void;
}

export const useLevelUi = create<LevelUi>()((set) => ({
  lock: 'held',
  newerSave: false,
  memoryReason: null,
  justCompleted: null,
  set: (patch) => set(patch),
}));
