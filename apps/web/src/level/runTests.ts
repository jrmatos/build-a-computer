import type { CaseResult } from '@build-a-computer/sim-logic';
import type { Level } from '@build-a-computer/schema';
import { useEditor } from '../editor/store';
import { sim } from '../sim/client';
import { t } from '../i18n';
import { markCompleted } from './persist';
import { plannedTotal } from './testStripModel';
import { useLevelUi } from './ui';

/** Cases the level's tests will run (truth rows, vectors, sequence checks, programs). */
export const totalCases = (level: Level | null): number => plannedTotal(level);

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
  if (running || !level || !canRunTests(level) || st.editStack.length > 0) return;
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

/**
 * Put a test case's inputs on the board's labelled switches so the player can
 * watch the circuit with exactly those values (Turing Complete style).
 * Returns the labels that have no switch on the board.
 */
export async function loadCaseInputs(inputs: Record<string, number>): Promise<string[]> {
  const { board, snapshot } = useEditor.getState();
  // Switches only respond while the board is powered: power on to show the case.
  if (snapshot && !snapshot.powered) await sim.power(true);
  const missed: string[] = [];
  const jobs: Promise<unknown>[] = [];
  for (const [label, value] of Object.entries(inputs)) {
    const part = board.parts.find((p) => p.label === label && (p.type === 'switch' || p.type === 'button'));
    if (!part) {
      missed.push(label);
      continue;
    }
    if (part.type === 'button') jobs.push(sim.press(part.id, value === 1));
    else if ((part.props?.width ?? 1) <= 1) jobs.push(sim.setSwitch(part.id, value === 1));
    else jobs.push(sim.setValue(part.id, value));
  }
  await Promise.all(jobs);
  return missed;
}
