import { create } from 'zustand';

/** Which chip dialog is open. */
export interface ChipUi {
  /** "Make chip" dialog for the current board. */
  make: boolean;
  /** Chip being renamed/recolored. */
  edit: string | null;
  /** Chip whose deletion is being confirmed (usages listed first, E-DATA-08). */
  remove: string | null;
  set: (patch: Partial<Omit<ChipUi, 'set'>>) => void;
}

export const useChipUi = create<ChipUi>()((set) => ({
  make: false,
  edit: null,
  remove: null,
  set: (patch) => set(patch),
}));

/** Tile colors offered for chips (readable on the dark tile body). */
export const CHIP_COLORS = [
  '#4c6ef5',
  '#228be6',
  '#15aabf',
  '#12b886',
  '#40c057',
  '#fab005',
  '#fd7e14',
  '#fa5252',
  '#e64980',
  '#be4bdb',
  '#7950f2',
  '#868e96',
];
