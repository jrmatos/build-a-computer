/**
 * Web-side mode registry (ADR-010): the UI half of each level mode's plugin.
 * Shell components ask `useModeUi()` / `modeUi(level)` for the workspace,
 * controls, toolbar, dock tabs, panels and solution loader of the open
 * level instead of switching on `level.mode`.
 */
import { modeOf, type LevelMode } from '@build-a-computer/platform-core';
import type { Level } from '@build-a-computer/schema';
import { useEditor } from '../editor/store';
import { boardUi } from './board';
import { codeUi } from './code';
import { jsUi } from './js';
import type { ModeUi } from './types';

export type { ModeUi } from './types';

/** A Record, so a new schema mode without a UI plugin fails to compile. */
export const MODE_UI: Record<LevelMode, ModeUi> = { board: boardUi, code: codeUi, js: jsUi };

/** The UI plugin of a level (no level: the board, as for the sandbox before a level loads). */
export const modeUi = (level: Pick<Level, 'mode'> | null | undefined): ModeUi => MODE_UI[modeOf(level).id];

/** The open level's UI plugin. */
export const useModeUi = (): ModeUi => useEditor((s) => modeUi(s.level));
