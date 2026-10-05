import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  paste,
  rotateSelection,
  selectAll,
} from '../editor/actions';
import { zoomToFit } from '../editor/camera';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import {
  IconClipboard,
  IconCopy,
  IconDuplicate,
  IconFit,
  IconFlip,
  IconRotateCcw,
  IconRotateCw,
  IconScissors,
  IconSelectAll,
  IconTrash,
} from './icons';
import { MenuItem } from './MainMenu';
import { focusFirstItem, onMenuKeyDown } from './menuNav';
import { kbd } from './shortcuts';
import './ui.css';

interface Item {
  key: string;
  icon: ReactNode;
  label: string;
  shortcut: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** Right-click menu at store.contextMenu; items depend on the selection. */
export function ContextMenu() {
  const menu = useEditor((s) => s.contextMenu);
  const selection = useEditor((s) => s.selection);
  const board = useEditor((s) => s.board);
  const readOnly = useEditor((s) => s.readOnly);
  const set = useEditor((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const close = () => set({ contextMenu: null });

  // Clamp inside the viewport once the menu has a size.
  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    focusFirstItem(ref.current);
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) set({ contextMenu: null });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        set({ contextMenu: null });
      }
    };
    const onScroll = () => set({ contextMenu: null });
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('blur', onScroll);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('blur', onScroll);
      if (previous && previous !== document.body) previous.focus?.();
    };
  }, [menu, set]);

  if (!menu) return null;

  const ids = new Set(selection);
  const selParts = board.parts.filter((p) => ids.has(p.id));
  const hasSel = selection.length > 0;
  const hasParts = selParts.some((p) => !p.locked);
  const onlyLocked = hasSel && selParts.length === selection.length && selParts.every((p) => p.locked);
  const editDisabled = readOnly || onlyLocked;

  const editItems: Item[] = hasSel
    ? [
        { key: 'cut', icon: <IconScissors />, label: t('action.cut'), shortcut: kbd('Mod+X'), run: () => void cutSelection(), disabled: editDisabled },
        { key: 'copy', icon: <IconCopy />, label: t('action.copy'), shortcut: kbd('Mod+C'), run: () => void copySelection() },
        { key: 'paste', icon: <IconClipboard />, label: t('action.paste'), shortcut: kbd('Mod+V'), run: () => paste(undefined, menu.world), disabled: readOnly },
        { key: 'dup', icon: <IconDuplicate />, label: t('action.duplicate'), shortcut: kbd('Mod+D'), run: duplicateSelection, disabled: editDisabled },
        { key: 'rot', icon: <IconRotateCw />, label: t('action.rotate'), shortcut: 'R', run: () => rotateSelection(1), disabled: readOnly || !hasParts },
        { key: 'rotl', icon: <IconRotateCcw />, label: t('action.rotateLeft'), shortcut: kbd('Shift+R'), run: () => rotateSelection(-1), disabled: readOnly || !hasParts },
        { key: 'flip', icon: <IconFlip />, label: t('action.flip'), shortcut: 'F', run: flipSelection, disabled: readOnly || !hasParts },
        { key: 'del', icon: <IconTrash />, label: t('action.delete'), shortcut: 'Del', run: deleteSelection, disabled: editDisabled, danger: true },
      ]
    : [{ key: 'paste', icon: <IconClipboard />, label: t('action.paste'), shortcut: kbd('Mod+V'), run: () => paste(undefined, menu.world), disabled: readOnly }];

  const viewItems: Item[] = [
    { key: 'all', icon: <IconSelectAll />, label: t('action.selectAll'), shortcut: kbd('Mod+A'), run: selectAll },
    { key: 'fit', icon: <IconFit />, label: t('zoom.fit'), shortcut: kbd('Shift+1'), run: () => zoomToFit() },
  ];

  const renderItem = (it: Item) => (
    <MenuItem
      key={it.key}
      icon={it.icon}
      label={it.label}
      shortcut={it.shortcut}
      danger={it.danger}
      disabled={it.disabled}
      onSelect={() => {
        close();
        it.run();
      }}
    />
  );

  return (
    <div
      ref={ref}
      className="island gu-dropdown gu-context"
      role="menu"
      aria-label={t('context.label')}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y }}
      onKeyDown={onMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {editItems.map(renderItem)}
      <div className="gu-menu-sep" role="separator" />
      {viewItems.map(renderItem)}
    </div>
  );
}
