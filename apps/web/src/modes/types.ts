import type { ComponentType } from 'react';
import type { ModePlugin } from '@build-a-computer/platform-core';
import type { Level } from '@build-a-computer/schema';
import type { DockTab } from '../level/panels/dockState';

/**
 * The web half of a level mode's plugin (ADR-010). platform-core's
 * `ModePlugin` says what the mode is (editor, work, machine, test kinds);
 * this says how the app shows it. Shell components (App, SimControls,
 * Toolbar, Footer, BottomDock, LevelPanel) pick these parts through
 * `useModeUi()` instead of checking `level.mode`.
 *
 * Lazy-loading rule: a mode whose editor is heavy (CodeMirror, compiler,
 * tensors) gives a `lazy()` Workspace so its code stays in its own chunk.
 */
export interface ModeUi {
  core: ModePlugin;
  /** Full-bleed workspace behind the islands. */
  Workspace: ComponentType;
  /** Top-right island: simulation or debugger controls. */
  Controls: ComponentType;
  /** Top-center island in place of the board tools, or null to show the board toolbar. */
  Toolbar: ComponentType | null;
  /** Bottom-left zoom and undo/redo islands. */
  footer: boolean;
  /** The faint "place your first part" welcome. */
  welcome: boolean;
  /** Bottom-dock tabs for a level of this mode (the case debugger tab is filtered by canDebug). */
  dockTabs(level: Level): readonly DockTab[];
  /** Dock panels this mode draws itself, remounted per level. */
  panels: Partial<Record<DockTab, ComponentType>>;
  /** Mounted while a level of this mode is open: per-mode registrations (case debugger). */
  Effects: ComponentType<{ level: Level }> | null;
  /**
   * "Show solution" (ADR-007): load the level's reference solution into the
   * editor. Resolves to the success toast's i18n key, or null when the level
   * has no solution.
   */
  showSolution(level: Level): Promise<string | null>;
}
