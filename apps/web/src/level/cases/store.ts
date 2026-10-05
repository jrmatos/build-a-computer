import { create } from 'zustand';

interface CasesUi {
  open: boolean;
  /** Row (strip column) to select when the view opens. */
  focus: number | null;
}

export const useCasesUi = create<CasesUi>()(() => ({ open: false, focus: null }));

export function openTestCases(focus: number | null = null): void {
  useCasesUi.setState({ open: true, focus });
}

export function closeTestCases(): void {
  useCasesUi.setState({ open: false, focus: null });
}
