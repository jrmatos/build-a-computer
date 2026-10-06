/**
 * Case debugger session: which case is loaded on the live board, its recorded
 * timeline (from the worker) and the frame shown. Actions drive the worker
 * (sim.debugStart / debugSeek / debugEnd) and keep the canvas highlight (the
 * output's fan-in cone, through the store's flashIds) in step.
 */
import { create } from 'zustand';
import type { Board, Level } from '@build-a-computer/schema';
import { canRunTests, modeOf } from '@build-a-computer/platform-core';
import type { DebugTrace } from '@build-a-computer/sim-logic';
import { emitAchievement } from '../../achievements/events';
import { useEditor } from '../../editor/store';
import { sim } from '../../sim/client';
import { t } from '../../i18n';
import { useDock } from '../panels/dockState';
import { assignResults, planStrip, type StripPlan } from '../testStripModel';
import { fanInCone, labelWires } from './cone';
import { caseTarget, checkFor, outputVerdicts, type CaseTarget } from './model';

export interface DebugSession {
  levelId: string;
  target: CaseTarget;
  trace: DebugTrace | null;
  /** Frame shown on the board. */
  frame: number;
  /** Checkpoint shown in the values table. */
  check: number;
  loading: boolean;
  error?: string;
  /** Board the trace was recorded on (an edit re-runs the case). */
  board: Board;
}

export interface DebugUi {
  session: DebugSession | null;
  /** Output whose fan-in cone is highlighted on the canvas. */
  focusOutput: string | null;
  showPath: boolean;
  onlyFailing: boolean;
}

export const useDebug = create<DebugUi>()(() => ({ session: null, focusOutput: null, showPath: true, onlyFailing: false }));

const plans = new WeakMap<Level, StripPlan>();
/** The strip plan of a level (cached per level object). */
export function stripPlan(level: Level): StripPlan {
  let p = plans.get(level);
  if (!p) plans.set(level, (p = planStrip(level)));
  return p;
}

/** Results of the last test run by strip column. */
export function resultsByColumn(level: Level): ReturnType<typeof assignResults>['byColumn'] {
  const run = useEditor.getState().testRun;
  return run ? assignResults(stripPlan(level), run.cases).byColumn : [];
}

/** True when the level's cases can be replayed on its board. */
export function canDebug(level: Level | null): boolean {
  // Modes whose cases replay on the live board (platform-core), on levels with tests to run.
  return !!level && modeOf(level).caseReplay && canRunTests(level, stripPlan(level).count);
}

let token = 0;
let seekToken = 0;

/**
 * Load strip column `column` onto the live board and open the debugger. With
 * `frame`, show that frame instead of the case's checkpoint (re-runs keep the
 * place on the timeline).
 */
export async function debugColumn(column: number, opts: { frame?: number; check?: number } = {}): Promise<void> {
  const st = useEditor.getState();
  const level = st.level;
  if (!level || st.editStack.length || !canDebug(level)) return;
  const plan = stripPlan(level);
  const target = caseTarget(plan, column, resultsByColumn(level)[column]);
  if (!target) return;
  ensureSync();
  const my = ++token;
  const board = st.board;
  const prev = useDebug.getState().session;
  const same = prev?.target.column === column && prev.levelId === level.id;
  useDebug.setState((s) => ({
    session: {
      levelId: level.id,
      target,
      trace: same ? prev.trace : null,
      frame: same ? prev.frame : 0,
      check: same ? prev.check : 0,
      loading: true,
      board,
    },
    focusOutput: same ? s.focusOutput : null,
  }));
  const dock = useDock.getState();
  if (dock.tab !== 'debug' || !dock.open) dock.setTab('debug');
  if (dock.height < 300) dock.setHeight(300);
  if (st.snapshot?.running) await sim.pause();
  const res = await sim.debugStart(level, target.test, target.index, target.inputs, board);
  if (my !== token) return;
  if (!res || !res.ok) {
    useDebug.setState({ session: { levelId: level.id, target, trace: null, frame: 0, check: 0, loading: false, error: res && !res.ok ? res.error : t('debug.error.worker'), board } });
    return;
  }
  const { trace } = res;
  emitAchievement({ type: 'case-debugged', levelId: level.id });
  let frame = res.frame;
  let check = trace.checks.length ? Math.min(trace.focus, trace.checks.length - 1) : 0;
  if (opts.frame !== undefined && opts.frame !== frame && opts.frame < trace.frames.length) {
    const at = await sim.debugSeek(opts.frame);
    if (my !== token) return;
    if (at) frame = at.frame;
    check = opts.check ?? checkFor(trace, frame);
  }
  const ports = stripPlan(level).outputs.filter((p) => trace.outputs.includes(p.label));
  const verdicts = outputVerdicts(trace.checks[check], ports);
  const keep = useDebug.getState().focusOutput;
  const focus =
    keep && trace.outputs.includes(keep) ? keep : (verdicts.find((v) => v.status === 'wrong' || v.status === 'unknown')?.label ?? trace.outputs[0] ?? null);
  useDebug.setState({ session: { levelId: level.id, target, trace, frame, check, loading: false, board }, focusOutput: focus });
  // Clocked cases: their inputs and outputs go on the waveform (keeping the player's own lanes).
  if (target.kind === 'sequence' || target.kind === 'program') {
    const wires = labelWires(board, [...trace.inputs, ...trace.outputs]);
    const pinned = useDock.getState().pinned;
    const add = wires.filter((w) => !pinned.includes(w));
    if (add.length) {
      const next = [...pinned, ...add];
      useDock.getState().setPinned(next);
      await sim.watch(next);
    }
  }
}

/** Show frame `frame` of the current case on the board. */
export async function seek(frame: number, check?: number): Promise<void> {
  const s = useDebug.getState().session;
  if (!s?.trace || s.loading) return;
  const f = Math.max(0, Math.min(s.trace.frames.length - 1, Math.round(frame)));
  const c = check ?? checkFor(s.trace, f);
  if (f === s.frame && c === s.check) return;
  const my = ++seekToken;
  useDebug.setState({ session: { ...s, frame: f, check: c } });
  if (useEditor.getState().snapshot?.running) await sim.pause();
  await sim.debugSeek(f);
  if (my !== seekToken) return;
}

/** Re-run the current case from scratch, keeping the place on the timeline. */
export function rerun(): Promise<void> {
  const s = useDebug.getState().session;
  if (!s) return Promise.resolve();
  return debugColumn(s.target.column, { frame: s.frame, check: s.check });
}

/** Leave the debugger: the board goes back to normal (ROM program and replay removed). */
export async function closeDebug(): Promise<void> {
  token++;
  const had = !!useDebug.getState().session;
  useDebug.setState({ session: null, focusOutput: null });
  clearFlash();
  if (!had) return;
  await sim.debugEnd();
  const { board, chips } = useEditor.getState();
  await sim.load(board, chips);
}

/**
 * Before a test run: a program case has its program in the live ROM, which
 * the run's other tests must not see. Returns true when the case should be
 * re-run afterwards.
 */
export async function suspendForTestRun(): Promise<boolean> {
  const s = useDebug.getState().session;
  if (!s || s.target.kind !== 'program') return false;
  token++;
  await sim.debugEnd();
  const { board, chips } = useEditor.getState();
  await sim.load(board, chips);
  return true;
}

export function setFocusOutput(label: string): void {
  useDebug.setState({ focusOutput: label });
}

// ---------- canvas highlight and live re-runs ----------

let flashed: string[] | null = null;

function clearFlash(): void {
  if (flashed && useEditor.getState().flashIds === flashed) useEditor.getState().set({ flashIds: [] });
  flashed = null;
}

/** Ids of the focused output's cone, or null when nothing should be highlighted. */
export function pathIds(board: Board, chips: Parameters<typeof fanInCone>[2], label: string | null): string[] | null {
  if (!label) return null;
  const lamp = board.parts.find((p) => p.label === label && p.type === 'lamp');
  if (!lamp) return null;
  const cone = fanInCone(board, lamp.id, chips);
  return [...cone.wires, ...cone.parts];
}

function syncFlash(): void {
  const { session, focusOutput, showPath } = useDebug.getState();
  const { board, chips, level } = useEditor.getState();
  if (!session || !showPath || level?.id !== session.levelId) {
    clearFlash();
    return;
  }
  const ids = pathIds(board, chips, focusOutput);
  if (!ids) {
    clearFlash();
    return;
  }
  const cur = useEditor.getState().flashIds;
  if (flashed && cur === flashed && ids.length === flashed.length && ids.every((id, i) => id === flashed![i])) return;
  flashed = ids;
  useEditor.getState().set({ flashIds: ids });
}

let synced = false;
let rerunTimer: ReturnType<typeof setTimeout> | null = null;

/** Keep the highlight current, re-run after board edits, and close on level changes. */
function ensureSync(): void {
  if (synced) return;
  synced = true;
  useDebug.subscribe(syncFlash);
  let lastBoard = useEditor.getState().board;
  let lastLevel = useEditor.getState().level;
  useEditor.subscribe((st) => {
    const s = useDebug.getState().session;
    if (st.level !== lastLevel) {
      lastLevel = st.level;
      if (s && st.level?.id !== s.levelId) void closeDebug();
      return;
    }
    if (st.board === lastBoard) return;
    lastBoard = st.board;
    syncFlash();
    if (!s || st.editStack.length) return;
    // Fix a wire, see the case again: re-run once the edit settles (after the board reload).
    if (rerunTimer) clearTimeout(rerunTimer);
    rerunTimer = setTimeout(() => {
      rerunTimer = null;
      const cur = useDebug.getState().session;
      if (cur && cur.board !== useEditor.getState().board) void rerun();
    }, 350);
  });
}
