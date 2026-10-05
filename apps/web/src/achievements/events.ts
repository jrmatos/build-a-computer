/**
 * Achievements event bus. Other code reports what the player did with a
 * one-line call:
 *
 *   emitAchievement({ type: 'hint-shown', levelId: level.id });
 *
 * This module has no imports, so calling it costs nothing and can never
 * break the caller: the achievements engine (achievements/runtime.ts)
 * subscribes once it starts, and signals sent before that are queued.
 *
 * Signals and who sends them:
 * - `tests-run`         level/runTests.ts, every finished test run
 * - `level-completed`   level/runTests.ts, after a full pass is recorded
 * - `hint-shown`        level/LevelPanel.tsx, a hint was opened
 * - `solution-revealed` level/LevelPanel.tsx, "Show solution" loaded (ADR-007)
 * - `case-debugged`     level/runTests.ts loadCaseInputs, and the case debugger
 * - `share-created`     community/CommunityLayer.tsx, a share link was made
 * - `pack-exported`     community/LevelEditor.tsx, a level pack was exported
 * - `workspace-exported` storage/controller.ts, "Export everything"
 *
 * Everything else (lamps, buses, chips, level opening) the runtime observes
 * from the editor store itself.
 */
export type AchievementSignal =
  | { type: 'tests-run'; levelId: string; passed: number; total: number }
  | {
      type: 'level-completed';
      levelId: string;
      /** First time this level was completed. */ first: boolean;
    }
  | { type: 'hint-shown'; levelId: string }
  | { type: 'solution-revealed'; levelId: string }
  | { type: 'case-debugged'; levelId?: string }
  | { type: 'share-created' }
  | { type: 'pack-exported' }
  | { type: 'workspace-exported' };

type Listener = (signal: AchievementSignal) => void;

const listeners = new Set<Listener>();
const queue: AchievementSignal[] = [];
const QUEUE_MAX = 200;

/** Report something the player did. Never throws. */
export function emitAchievement(signal: AchievementSignal): void {
  if (!listeners.size) {
    if (queue.length < QUEUE_MAX) queue.push(signal);
    return;
  }
  for (const l of listeners) {
    try {
      l(signal);
    } catch (e) {
      console.error(e);
    }
  }
}

/** Subscribe; queued signals are delivered first. Returns the unsubscribe function. */
export function onAchievementSignal(listener: Listener): () => void {
  listeners.add(listener);
  for (const s of queue.splice(0)) listener(s);
  return () => listeners.delete(listener);
}
