import { lazy } from 'react';
import { JS_MODE } from '@build-a-computer/platform-core';
import { BoardControls } from '../level/controls/BoardControls';
import { BOARD_TABS } from '../level/panels/dockState';
import { showSourceSolution } from './source';
import type { ModeUi } from './types';

// Track 2 (JavaScript + tensors): its own lazy chunk.
const JsWorkspace = lazy(() => import('../ml/JsWorkspace').then((m) => ({ default: m.JsWorkspace })));

/**
 * Track 2 levels: the JavaScript workspace replaces the board. The
 * workspace registers the 'js' Debug action while mounted. The top bar,
 * footer and dock are the board's for now (as before PLAT-01).
 */
export const jsUi: ModeUi = {
  core: JS_MODE,
  Workspace: JsWorkspace,
  Controls: BoardControls,
  Toolbar: null,
  footer: true,
  welcome: false,
  dockTabs: () => BOARD_TABS,
  panels: {},
  Effects: null,
  showSolution: showSourceSolution,
};
