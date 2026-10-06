/**
 * The app's entry: the light level catalog and `loadLevel` (full levels load
 * per phase group on demand). Complete levels for Node tests and tools:
 * `@build-a-computer/content/full`.
 */
export { LEVELS, levelById, loadLevel, loadedLevel, type LevelGroup, type LevelInfo } from './catalog';
export { SANDBOX } from './sandbox';
export { defineLevel, type LevelDraft } from './define';
export * from './toy8';

/** Phase 9: the kernel behind a level (kernel.h and, for program levels, its symbols), loaded on demand. */
export type { OsKernelInfo } from './phase9/kernel-info';
export const osKernelInfo = async (levelId: string): Promise<import('./phase9/kernel-info').OsKernelInfo | null> =>
  (await import('./phase9/kernel-info')).osKernelInfo(levelId);
