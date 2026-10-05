/**
 * Achievements runtime: wires the pure engine to the app. It listens to the
 * event bus (events.ts), watches the editor store for things it can see on
 * its own (lamps, buses, chips, the level being opened), runs events through
 * the engine one at a time, saves unlocks to IndexedDB and queues toasts.
 *
 * Startup and imports re-check progress quietly: milestones the player had
 * already earned are recorded without a burst of toasts.
 */
import { create } from 'zustand';
import { LEVELS, loadLevel } from '@build-a-computer/content';
import { useEditor, type EditorState } from '../editor/store';
import { useBest } from '../community/best';
import { useCommunityUi } from '../community/ui';
import { achievementById, isGateLevel } from './definitions';
import { achievementDb, persistSaved } from './db';
import {
  chipDepth,
  emptyState,
  evaluate,
  mergeSaved,
  newlyUnlocked,
  type EngineEvent,
  type EngineState,
  type SavedAchievements,
} from './engine';
import { onAchievementSignal, type AchievementSignal } from './events';

export interface AchievementToast {
  key: number;
  /** One achievement, or several at once (shown as a summary). */
  ids: string[];
}

interface AchievementsUi extends EngineState {
  ready: boolean;
  dialogOpen: boolean;
  toasts: AchievementToast[];
  /** Unlocks from the latest completion, for the success card. */
  lastCompletion: { levelId: string; ids: string[] } | null;
}

export const useAchievements = create<AchievementsUi>()(() => ({
  ...emptyState(),
  ready: false,
  dialogOpen: false,
  toasts: [],
  lastCompletion: null,
}));

const get = () => useAchievements.getState();
const editor = () => useEditor.getState();

export const openAchievements = (): void => useAchievements.setState({ dialogOpen: true });
export const closeAchievements = (): void => useAchievements.setState({ dialogOpen: false });

const TOAST_MS = 5000;
let toastKey = 0;

export function dismissAchievementToast(key: number): void {
  useAchievements.setState((s) => ({ toasts: s.toasts.filter((t) => t.key !== key) }));
}

function showToast(ids: string[]): void {
  if (!ids.length) return;
  const key = ++toastKey;
  // More than three at once (an import, say) collapse into one summary toast.
  const groups = ids.length > 3 ? [ids] : ids.map((id) => [id]);
  useAchievements.setState((s) => ({
    toasts: [...s.toasts, ...groups.map((g, i) => ({ key: key + i / 10, ids: g }))].slice(-4),
  }));
  for (let i = 0; i < groups.length; i++)
    setTimeout(() => dismissAchievementToast(key + i / 10), TOAST_MS + i * 600);
}

// ---------------------------------------------------------------- processing

let chain: Promise<void> = Promise.resolve();
let loaded: Promise<void> | null = null;

/** Run one event through the engine, in order after every earlier one. */
function process(
  event: EngineEvent | (() => Promise<EngineEvent | null>),
  opts: { quiet?: boolean } = {},
): Promise<void> {
  chain = chain
    .then(async () => {
      await loaded;
      const e = typeof event === 'function' ? await event() : event;
      if (!e) return;
      const before = get();
      const { state, unlocked } = evaluate({ saved: before.saved, session: before.session }, e, {
        levels: LEVELS,
        completed: new Set(editor().completed),
        now: new Date(),
      });
      if (state.saved === before.saved && state.session === before.session) {
        if (e.type === 'level-completed')
          useAchievements.setState({ lastCompletion: { levelId: e.levelId, ids: [] } });
        return;
      }
      useAchievements.setState({
        saved: state.saved,
        session: state.session,
        ...(e.type === 'level-completed'
          ? { lastCompletion: { levelId: e.levelId, ids: unlocked } }
          : {}),
      });
      if (!opts.quiet) showToast(unlocked);
      if (state.saved !== before.saved) await save(state.saved);
    })
    .catch((err: unknown) => console.error(err));
  return chain;
}

async function save(saved: SavedAchievements): Promise<void> {
  const merged = await persistSaved(saved);
  // Another tab may have unlocked something meanwhile: take it in without toasts.
  if (newlyUnlocked(get().saved, merged).length)
    useAchievements.setState((s) => ({ saved: mergeSaved(s.saved, merged) }));
}

// ---------------------------------------------------------------- signals

/** When each level was last opened (this page load). */
const openedAt = new Map<string, number>();

/** Parts in a level's reference solution that the player would place (mirrors community/best.ts measure). */
async function referenceParts(id: string): Promise<number | undefined> {
  try {
    const level = await loadLevel(id);
    if (!level) return undefined;
    const { referenceSolution } = await import('@build-a-computer/content/solutions');
    const board = referenceSolution(level);
    if (!board) return undefined;
    const starter = new Set(level.starter.parts.map((p) => p.id));
    return board.parts.filter((p) => !p.locked && !starter.has(p.id)).length;
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

function onSignal(s: AchievementSignal): void {
  if (s.type === 'tests-run') {
    // A shared board viewed read-only (COM-01) is not the player's work.
    if (!useCommunityUi.getState().shared) void process(s);
    return;
  }
  if (s.type === 'level-completed') {
    const now = Date.now();
    const opened = openedAt.get(s.levelId);
    const best = useBest.getState().last;
    void process(async () => {
      const level = LEVELS.find((l) => l.id === s.levelId);
      const parts = best?.levelId === s.levelId ? best.entry.parts : undefined;
      return {
        type: 'level-completed',
        levelId: s.levelId,
        first: s.first,
        ms: opened !== undefined ? now - opened : undefined,
        parts,
        referenceParts:
          level && isGateLevel(level) && parts !== undefined
            ? await referenceParts(level.id)
            : undefined,
        hour: new Date(now).getHours(),
      };
    });
    return;
  }
  void process(s);
}

// ---------------------------------------------------------------- store watching

function lampLit(s: EditorState): boolean {
  const snap = s.snapshot;
  if (!snap?.powered) return false;
  return s.board.parts.some(
    (p) =>
      p.type === 'lamp' &&
      (snap.pins[`${p.id}:in`] === 1 || (snap.busPins[`${p.id}:in`]?.v ?? 0) !== 0),
  );
}

function widestDrivenBus(s: EditorState): number {
  const snap = s.snapshot;
  if (!snap?.powered) return 0;
  let w = 0;
  for (const b of Object.values(snap.buses)) if (b.x === 0 && b.v !== 0) w = Math.max(w, b.w);
  return w;
}

const locked = (id: string) => !get().saved.unlocked[id];

function watchEditor(): void {
  const st = editor();
  if (st.level) openedAt.set(st.level.id, Date.now());
  void process(
    {
      type: 'chips',
      count: Object.values(st.chips).filter((c) => !c.deleted).length,
      depth: chipDepth(st.chips),
    },
    { quiet: true },
  );

  useEditor.subscribe((s, prev) => {
    if (s.level && s.level !== prev.level) openedAt.set(s.level.id, Date.now());
    if (s.completed !== prev.completed) {
      // A test pass on the open level arrives as a `level-completed` signal right after
      // (with toasts and the success card); anything else (an import) is re-checked quietly.
      const added = s.completed.filter((id) => !prev.completed.includes(id));
      if (!(added.length === 1 && added[0] === s.level?.id)) void process({ type: 'sync' }, { quiet: true });
    }
    if (s.chips !== prev.chips)
      void process({
        type: 'chips',
        count: Object.values(s.chips).filter((c) => !c.deleted).length,
        depth: chipDepth(s.chips),
      });
    if (
      s.level?.track === 'sandbox' &&
      s.board !== prev.board &&
      s.editStack.length === 0 &&
      locked('tinkerer')
    ) {
      void process({ type: 'sandbox-parts', count: s.board.parts.length });
    }
    if (s.snapshot && s.snapshot !== prev.snapshot) {
      if (locked('first-light') && lampLit(s)) void process({ type: 'lamp-lit' });
      if (locked('bus-driver')) {
        const w = widestDrivenBus(s);
        if (w >= 8) void process({ type: 'bus-driven', width: w });
      }
      if (
        locked('feedback-loop') &&
        s.snapshot.powered &&
        !s.snapshot.stable &&
        s.snapshot.unstablePins.length > 0
      )
        void process({ type: 'unstable' });
      if (locked('magic-smoke') && s.snapshot.contentionPins.length > 0)
        void process({ type: 'contention' });
    }
  });
}

// ---------------------------------------------------------------- public API

let started = false;

/** Load unlocks, re-check progress quietly, and start listening. Safe to call more than once. */
export function startAchievements(): Promise<void> {
  if (started) return loaded ?? Promise.resolve();
  started = true;
  loaded = achievementDb()
    .then((db) => db.get())
    .then((saved) =>
      useAchievements.setState((s) => ({ saved: mergeSaved(saved, s.saved), ready: true })),
    )
    .catch((e: unknown) => {
      console.error(e);
      useAchievements.setState({ ready: true });
    });
  void process({ type: 'sync' }, { quiet: true });
  watchEditor();
  onAchievementSignal(onSignal);
  return loaded;
}

/** Unlocks and facts for the workspace file. */
export async function achievementsForExport(): Promise<SavedAchievements> {
  if (started) await chain;
  return get().saved;
}

/**
 * Merge achievements from an imported workspace: union, earliest timestamp.
 * Quiet (they were earned elsewhere); returns how many are new here.
 */
export async function importAchievements(incoming: SavedAchievements | undefined): Promise<number> {
  if (!incoming) return 0;
  await startAchievements();
  await chain;
  const before = get().saved;
  const merged = mergeSaved(before, incoming);
  const gained = newlyUnlocked(before, merged).filter((id) => achievementById(id)).length;
  useAchievements.setState({ saved: merged });
  await save(merged);
  await process({ type: 'sync' }, { quiet: true });
  return gained;
}

/** Called whenever the saved achievements change (the connected workspace file autosaves). */
export function onAchievementsChange(fn: () => void): () => void {
  return useAchievements.subscribe((s, prev) => {
    if (s.saved !== prev.saved) fn();
  });
}
