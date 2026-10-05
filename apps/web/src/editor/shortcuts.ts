/**
 * Global keyboard shortcuts and clipboard events, Excalidraw style.
 * Installed by the Canvas; ignored while typing in a field.
 */
import { Board, parseUntrustedJson } from '@ground-up/schema';
import { t } from '../i18n';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  isClip,
  paste,
  rotateSelection,
  selectAll,
} from './actions';
import { resetZoom, zoomIn, zoomOut, zoomToFit } from './camera';
import type { Interaction } from './interaction';
import { moveIds, type Clip } from './ops';
import { useEditor, type Tool } from './store';
import { paletteShortcuts } from './tools';

/** True when keys should go to a text field instead of the editor. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const h = el as HTMLElement;
  const tag = h.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select' || h.isContentEditable) return true;
  if (tag !== 'input') return false;
  const type = (h as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset'].includes(type);
}

export interface KeyInput {
  key: string;
  code: string;
  shift: boolean;
  alt: boolean;
  mod: boolean;
}

/** Shortcut command for a key press, or null. Pure so it can be tested. */
export type Command =
  | { kind: 'tool'; tool: Tool }
  | { kind: 'lock' }
  | { kind: 'escape' }
  | { kind: 'delete' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'selectAll' }
  | { kind: 'duplicate' }
  | { kind: 'rotate'; dir: 1 | -1 }
  | { kind: 'flip' }
  | { kind: 'fit' }
  | { kind: 'fitSelection' }
  | { kind: 'resetZoom' }
  | { kind: 'zoomIn' }
  | { kind: 'zoomOut' }
  | { kind: 'grid' }
  | { kind: 'theme' }
  | { kind: 'help' }
  | { kind: 'nudge'; dx: number; dy: number };

export function commandFor(k: KeyInput, level: Parameters<typeof paletteShortcuts>[0]): Command | null {
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  const digit = /^(Digit|Numpad)(\d)$/.exec(k.code)?.[2] ?? (/^\d$/.test(k.key) ? k.key : null);

  if (k.mod) {
    if (k.alt) return null;
    if (key === 'z') return k.shift ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'y') return { kind: 'redo' };
    if (key === 'a') return { kind: 'selectAll' };
    if (key === 'd') return { kind: 'duplicate' };
    if (digit === '0') return { kind: 'resetZoom' };
    if (key === '=' || key === '+' || k.code === 'Equal' || k.code === 'NumpadAdd') return { kind: 'zoomIn' };
    if (key === '-' || key === '_' || k.code === 'Minus' || k.code === 'NumpadSubtract') return { kind: 'zoomOut' };
    if (key === "'" || k.code === 'Quote') return { kind: 'grid' };
    return null;
  }
  if (k.alt) {
    if (k.shift && (key === 'd' || k.code === 'KeyD')) return { kind: 'theme' };
    return null;
  }
  if (key === '?' || (k.shift && k.code === 'Slash')) return { kind: 'help' };
  if (k.shift && digit === '1') return { kind: 'fit' };
  if (k.shift && digit === '2') return { kind: 'fitSelection' };

  const step = k.shift ? 5 : 1;
  switch (k.key) {
    case 'Escape':
      return { kind: 'escape' };
    case 'Delete':
    case 'Backspace':
      return { kind: 'delete' };
    case 'ArrowLeft':
      return { kind: 'nudge', dx: -step, dy: 0 };
    case 'ArrowRight':
      return { kind: 'nudge', dx: step, dy: 0 };
    case 'ArrowUp':
      return { kind: 'nudge', dx: 0, dy: -step };
    case 'ArrowDown':
      return { kind: 'nudge', dx: 0, dy: step };
  }
  if (key === 'r') return { kind: 'rotate', dir: k.shift ? -1 : 1 };
  if (key === 'f' || (k.shift && key === 'h')) return { kind: 'flip' };
  if (k.shift) return null;
  if (key === 'h') return { kind: 'tool', tool: 'hand' };
  if (key === 'v' || digit === '1') return { kind: 'tool', tool: 'select' };
  if (key === 'w' || digit === '2') return { kind: 'tool', tool: 'wire' };
  if (key === 'q') return { kind: 'lock' };
  if (digit) {
    const s = paletteShortcuts(level).find((p) => p.key === digit);
    if (s) return { kind: 'tool', tool: `place:${s.type}` };
  }
  return null;
}

/** Apply a shortcut. Returns false if it did nothing, so the browser default can run. */
export function runCommand(c: Command, ctrl: Interaction): boolean {
  const st = useEditor.getState();
  const sel = st.selection;
  switch (c.kind) {
    case 'tool':
      if (st.readOnly && c.tool !== 'select' && c.tool !== 'hand') return true;
      ctrl.cancel();
      st.setTool(c.tool);
      ctrl.update();
      return true;
    case 'lock':
      st.set({ toolLocked: !st.toolLocked });
      return true;
    case 'escape':
      if (st.contextMenu) st.set({ contextMenu: null });
      else if (ctrl.cancel()) {
        /* cancelled a gesture */
      } else if (st.tool.startsWith('place:') || st.tool === 'wire') st.setTool('select');
      else if (sel.length) st.setSelection([]);
      else if (st.tool !== 'select') st.setTool('select');
      ctrl.update();
      return true;
    case 'delete':
      if (!sel.length) return false;
      deleteSelection();
      return true;
    case 'undo':
      ctrl.cancel();
      st.undo();
      return true;
    case 'redo':
      ctrl.cancel();
      st.redo();
      return true;
    case 'selectAll':
      selectAll();
      return true;
    case 'duplicate':
      duplicateSelection();
      return true;
    case 'rotate':
      rotateSelection(c.dir);
      return true;
    case 'flip':
      flipSelection();
      return true;
    case 'fit':
      zoomToFit();
      return true;
    case 'fitSelection':
      zoomToFit(sel);
      return true;
    case 'resetZoom':
      resetZoom();
      return true;
    case 'zoomIn':
      zoomIn();
      return true;
    case 'zoomOut':
      zoomOut();
      return true;
    case 'grid':
      st.set({ showGrid: !st.showGrid });
      return true;
    case 'theme': {
      const theme = st.theme === 'dark' ? 'light' : 'dark';
      st.set({ theme });
      if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
      return true;
    }
    case 'help':
      st.set({ helpOpen: true });
      return true;
    case 'nudge':
      if (!sel.length || ctrl.busy) return false;
      st.commit((b) => moveIds(b, new Set(sel), c.dx, c.dy));
      return true;
  }
}

/** Parse clipboard text into a clip; validates the board shape so bad pastes cannot corrupt the board. */
export function parseClip(text: string): Clip | null {
  try {
    const v = parseUntrustedJson(text);
    if (!isClip(v)) return null;
    const b = Board.safeParse({ parts: v.parts, wires: v.wires });
    return b.success ? { kind: 'ground-up/clipboard', parts: b.data.parts, wires: b.data.wires } : null;
  } catch {
    return null;
  }
}

export function installShortcuts(ctrl: Interaction): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    if (e.key === ' ') {
      // A focused button or menu item keeps Space for activation (keyboard access).
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest('button, [role="button"], [role="menuitem"], a, summary')) return;
      // Otherwise Space+drag pans; keep the page from scrolling.
      e.preventDefault();
      ctrl.setSpace(true);
      return;
    }
    if (e.isComposing) return;
    const c = commandFor(
      { key: e.key, code: e.code, shift: e.shiftKey, alt: e.altKey, mod: e.ctrlKey || e.metaKey },
      useEditor.getState().level,
    );
    if (!c) return;
    // Let dialogs handle their own Escape.
    if (c.kind === 'escape' && (useEditor.getState().helpOpen || useEditor.getState().levelsOpen)) return;
    if (runCommand(c, ctrl)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') ctrl.setSpace(false);
  };
  const onBlur = () => ctrl.setSpace(false);

  const onCopy = (e: ClipboardEvent) => {
    if (isTypingTarget(document.activeElement) || hasTextSelection()) return;
    const c = e.type === 'cut' ? cutSelection() : copySelection();
    if (!c) return;
    e.clipboardData?.setData('text/plain', JSON.stringify(c));
    e.preventDefault();
  };
  const onPaste = (e: ClipboardEvent) => {
    if (isTypingTarget(document.activeElement)) return;
    const st = useEditor.getState();
    if (st.readOnly) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    if (!text) {
      paste(undefined, ctrl.lastWorld);
      return;
    }
    const clip = parseClip(text);
    if (clip) paste(clip, ctrl.lastWorld);
    else st.toast(t('canvas.pasteInvalid'), 'error');
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  document.addEventListener('paste', onPaste);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCopy);
    document.removeEventListener('paste', onPaste);
  };
}

function hasTextSelection(): boolean {
  const s = window.getSelection();
  return !!s && !s.isCollapsed && s.toString().length > 0;
}
