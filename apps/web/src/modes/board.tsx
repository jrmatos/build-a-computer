import { BOARD_MODE } from '@build-a-computer/platform-core';
import type { Level } from '@build-a-computer/schema';
import { Canvas } from '../editor/Canvas';
import { zoomToFit } from '../editor/camera';
import { useEditor } from '../editor/store';
import { BoardControls } from '../level/controls/BoardControls';
import { useBoardCaseDebug } from '../level/debug/useBoardCaseDebug';
import { BOARD_TABS } from '../level/panels/dockState';
import { loadSolution } from '../level/solution';
import type { ModeUi } from './types';

/** While a board level is open, the strip's Debug action replays cases on the board. */
function BoardEffects({ level }: { level: Level }) {
  useBoardCaseDebug(level);
  return null;
}

/** Board levels: the canvas editor, the logic simulator's controls and the board panels. */
export const boardUi: ModeUi = {
  core: BOARD_MODE,
  Workspace: Canvas,
  Controls: BoardControls,
  Toolbar: null,
  footer: true,
  welcome: true,
  dockTabs: () => BOARD_TABS,
  panels: {},
  Effects: BoardEffects,
  async showSolution(level) {
    const board = await loadSolution(level);
    if (!board) return null;
    // One undo step, so Ctrl+Z brings the player's attempt back.
    useEditor.getState().commit(() => board, []);
    requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
    return 'level.solution.loaded';
  },
};
