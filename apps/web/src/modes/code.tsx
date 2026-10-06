import { lazy } from 'react';
import { CODE_MODE } from '@build-a-computer/platform-core';
import { CodeLevelChip } from '../code/CodeLevelChip';
import { CodeControls } from '../level/controls/CodeControls';
import { codeTabs } from '../level/panels/dockState';
import { RvMemoryPanel } from '../level/panels/RvMemoryPanel';
import { OsPanel } from '../level/panels/os/OsPanel';
import { showSourceSolution } from './source';
import type { ModeUi } from './types';

// CodeMirror and the assembler stay out of the first-level bundle (own chunk).
const CodeWorkspace = lazy(() => import('../code/CodeWorkspace').then((m) => ({ default: m.CodeWorkspace })));

/**
 * Code levels (Phase 6+): the code editor replaces the board; the RV32
 * debugger's controls and panels replace the board's. The workspace
 * registers the 'riscv' Debug action while mounted.
 */
export const codeUi: ModeUi = {
  core: CODE_MODE,
  Workspace: CodeWorkspace,
  Controls: CodeControls,
  // Code levels have no board tools, zoom or board undo (CodeMirror keeps its own history).
  Toolbar: CodeLevelChip,
  footer: false,
  welcome: false,
  dockTabs: codeTabs,
  panels: { memory: RvMemoryPanel, os: OsPanel },
  Effects: null,
  showSolution: showSourceSolution,
};
