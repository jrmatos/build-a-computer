import type { Level } from '@build-a-computer/schema';
import { useEditor } from '../editor/store';
import { loadSourceSolution } from '../level/solution';

/** Source-based modes (code, js): the reference solution replaces the editor's text. */
export async function showSourceSolution(level: Level): Promise<string | null> {
  const source = await loadSourceSolution(level);
  if (source === undefined) return null;
  useEditor.getState().set({ source });
  return 'level.solution.loadedCode';
}
