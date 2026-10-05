/**
 * Opening share links (COM-01): the shared board shows read-only over the
 * current level (nothing is saved while viewing); "Fork" copies it into the
 * current level's save or the sandbox, asking before replacing work.
 */
import { levelById } from '@build-a-computer/content';
import type { Board, SharedBoard } from '@build-a-computer/schema';
import { zoomToFit } from '../editor/camera';
import { exitChip, rootBoard } from '../editor/chips';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { adoptBoard, flushSave, openLevel } from '../level/persist';
import { isUnlocked } from '../level/progress';
import { communityLevelById } from './registry';
import { decodeShare, shareFromHash, ShareError } from './share';
import { useCommunityUi } from './ui';

const editor = () => useEditor.getState();
const ui = () => useCommunityUi.getState();

/**
 * Captured when this module first loads, before persistence rewrites the URL
 * to `#level=<id>` on startup.
 */
const initial = typeof location !== 'undefined' ? shareFromHash(location.hash) : null;

const fit = () => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
};

/** True when a board has anything besides level-owned parts. */
export const hasWork = (b: Board): boolean => b.wires.length > 0 || b.parts.some((p) => !p.locked);

/** Decode a fragment value and show it read-only. */
export async function openShareValue(value: string): Promise<void> {
  let payload: SharedBoard;
  try {
    payload = await decodeShare(value);
  } catch (e) {
    console.error(e);
    editor().toast(e instanceof ShareError ? t(`community.share.error.${e.code}`) : t('community.share.error.corrupt'), 'error');
    return;
  }
  if (!editor().level) return;
  if (editor().editStack.length) exitChip(0);
  await flushSave();
  const cur = editor();
  const existing = ui().shared;
  const prev = existing?.prev ?? { board: rootBoard(cur), past: cur.past, future: cur.future, readOnly: cur.readOnly };
  const board = adoptBoard({ board: payload.board, chips: payload.chips });
  ui().set({ shared: { payload, levelId: cur.level?.id, prev }, pendingFork: null });
  editor().set({ board, past: [], future: [], selection: [], testRun: null, transientBase: null, readOnly: true });
  fit();
}

/** Leave the read-only view and put the player's board back. */
export function closeShared(): void {
  const s = ui().shared;
  if (!s) return;
  ui().set({ shared: null });
  clearShareHash(s.levelId);
  if (editor().level?.id !== s.levelId) return;
  editor().set({ board: s.prev.board, past: s.prev.past, future: s.prev.future, readOnly: s.prev.readOnly, selection: [], testRun: null });
  fit();
}

/** Where a fork can go: the shared board's own level when it is open to the player, else the current level. */
export function forkTargets(): { level: { id: string; title: string } | null; sandbox: boolean } {
  const s = ui().shared;
  const cur = editor().level;
  const wanted = s?.payload.levelId ? (levelById(s.payload.levelId) ?? communityLevelById(s.payload.levelId)) : undefined;
  const target = wanted && wanted.mode === 'board' && isUnlocked(wanted, editor().completed) ? wanted : cur;
  const level = target && target.track !== 'sandbox' && target.mode === 'board' ? { id: target.id, title: target.title } : null;
  return { level, sandbox: true };
}

/** Fork into a level ('sandbox' or a level id): asks first when that board has work on it. */
export async function fork(targetId: string): Promise<void> {
  const s = ui().shared;
  if (!s) return;
  closeShared();
  if (editor().level?.id !== targetId) await openLevel(targetId);
  if (editor().level?.id !== targetId) return;
  if (editor().readOnly) {
    editor().toast(t('community.share.forkReadOnly'), 'error');
    return;
  }
  if (hasWork(rootBoard())) {
    ui().set({ pendingFork: s.payload });
    return;
  }
  applyFork(s.payload);
}

/** Replace the current board with the shared one (one undo step). */
export function applyFork(payload: SharedBoard): void {
  ui().set({ pendingFork: null });
  const { commit, toast } = editor();
  // Parts that match the level's starter by id stay level-owned (locked), as in the player's own saves.
  const starter = new Set((editor().level?.starter.parts ?? []).filter((p) => p.locked).map((p) => p.id));
  const board = adoptBoard({ board: payload.board, chips: payload.chips });
  commit(() => ({ ...board, parts: board.parts.map((p) => (starter.has(p.id) && !p.locked ? { ...p, locked: true } : p)) }), []);
  toast(t('community.share.forked', { title: editor().level?.title ?? '' }), 'success');
  fit();
}

/** Drop `#share=` from the address bar so a reload opens the level, not the link again. */
function clearShareHash(levelId: string | undefined): void {
  try {
    if (!shareFromHash(location.hash)) return;
    const url = new URL(location.href);
    url.hash = levelId && levelId !== 'sandbox' ? `level=${levelId}` : '';
    history.replaceState(history.state, '', url.href);
  } catch {
    /* sandboxed iframe or similar */
  }
}

let started = false;

/** Open the startup share link (if any) and any `#share=` pasted later. */
export function startShareLinks(): void {
  if (started) return;
  started = true;
  if (initial) void openShareValue(initial);
  window.addEventListener('hashchange', () => {
    const v = shareFromHash(location.hash);
    if (v) void openShareValue(v);
  });
  // Opening another level ends the view (that level's board replaced the shared one).
  useEditor.subscribe((st, prev) => {
    const s = ui().shared;
    if (s && st.level !== prev.level && st.level?.id !== s.levelId) ui().set({ shared: null });
  });
}
