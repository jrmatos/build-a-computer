import type { CaseResult } from '@ground-up/sim-logic';
import type { Level } from '@ground-up/schema';
import { useEditor } from '../editor/store';
import { sim } from '../sim/client';
import { t } from '../i18n';
import { markCompleted } from './persist';
import { useLevelUi } from './ui';

export const totalCases = (level: Level | null): number =>
  level?.tests.reduce((n, test) => n + (test.kind === 'truth-table' ? test.rows.length : 0), 0) ?? 0;

export const canRunTests = (level: Level | null): boolean => !!level && level.track !== 'sandbox' && totalCases(level) > 0;

let running = false;

/**
 * Run the level's tests in the worker. Results stream into store.testRun,
 * batched per animation frame so big tables stay smooth. A full pass marks the
 * level completed and shows the success card.
 */
export async function runLevelTests(): Promise<void> {
  const st = useEditor.getState();
  const level = st.level;
  if (running || !level || !canRunTests(level)) return;
  running = true;
  const total = totalCases(level);
  const cases: CaseResult[] = [];
  let pending = false;
  let finished = false;
  const publish = () => {
    pending = false;
    if (finished) return;
    const cur = useEditor.getState();
    if (cur.level !== level) return;
    cur.set({ testRun: { running: true, cases: [...cases], passed: cases.filter((c) => c.pass).length, total } });
  };
  useLevelUi.getState().set({ justCompleted: null });
  st.set({ testRun: { running: true, cases: [], passed: 0, total } });
  try {
    const result = await sim.runTests((c) => {
      cases.push(c);
      if (!pending) {
        pending = true;
        requestAnimationFrame(publish);
      }
    });
    // Case callbacks travel on their own message channel and can trail the final result.
    const want = result?.total ?? total;
    for (let waited = 0; cases.length < want && waited < 1000; waited += 20) await new Promise((r) => setTimeout(r, 20));
    finished = true;
    const cur = useEditor.getState();
    if (cur.level !== level) return;
    const passed = result?.passed ?? cases.filter((c) => c.pass).length;
    const tot = result?.total ?? total;
    cur.set({ testRun: { running: false, cases: [...cases], passed, total: tot } });
    if (result && tot > 0 && passed === tot) {
      const first = !cur.completed.includes(level.id);
      await markCompleted(level);
      useLevelUi.getState().set({ justCompleted: level.id });
      if (first) cur.toast(t('level.toast.completed', { title: level.title }), 'success');
    }
  } catch (e) {
    console.error(e);
    finished = true;
    const cur = useEditor.getState();
    if (cur.level === level) cur.set({ testRun: { running: false, cases: [...cases], passed: 0, total } });
  } finally {
    running = false;
  }
}
