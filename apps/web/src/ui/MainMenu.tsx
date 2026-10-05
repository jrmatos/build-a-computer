import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { migrateSave, NewerVersionError, parseUntrustedJson, SAVE_VERSION, type Board, type Save } from '@ground-up/schema';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { Dialog } from './Dialog';
import {
  IconCheck,
  IconChip,
  IconDownload,
  IconFolderOpen,
  IconGrid,
  IconHelp,
  IconLevels,
  IconMenu,
  IconMoon,
  IconReset,
  IconSun,
} from './icons';
import { focusFirstItem, onMenuKeyDown } from './menuNav';
import { kbd } from './shortcuts';
import './ui.css';

/** Keep only level-owned parts and the wires between them. */
function lockedOnly(b: Board): Board {
  const parts = b.parts.filter((p) => p.locked);
  const ids = new Set(parts.map((p) => p.id));
  const wires = b.wires.filter((w) => ids.has(w.from.part) && ids.has(w.to.part));
  if (parts.length === b.parts.length && wires.length === b.wires.length) return b;
  return { parts, wires };
}

/** Top-left: hamburger main menu and the current level chip. */
export function MainMenu() {
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const theme = useEditor((s) => s.theme);
  const showGrid = useEditor((s) => s.showGrid);
  const level = useEditor((s) => s.level);
  const readOnly = useEditor((s) => s.readOnly);
  const set = useEditor((s) => s.set);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The store owns the theme; mirror it on <html> so tokens.css switches.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    focusFirstItem(menuRef.current);
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const run = (fn: () => void) => {
    close(false);
    fn();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { toast, commit, level: current } = useEditor.getState();
    let save: Save;
    try {
      save = migrateSave(parseUntrustedJson(await file.text()));
    } catch (err) {
      // E-DATA-04: a newer file is reported and never loaded over the board.
      if (err instanceof NewerVersionError) toast(err.message, 'error');
      else toast(t('menu.loadFailed', { reason: err instanceof Error ? err.message.split('\n')[0]! : String(err) }), 'error');
      return;
    }
    commit(() => save.board, []);
    if (current && save.levelId !== current.id) toast(t('menu.otherLevel', { id: save.levelId }), 'info');
    else toast(t('menu.loaded'), 'success');
  };

  const saveToFile = () => {
    const { board, level: current, toast } = useEditor.getState();
    const save: Save = {
      kind: 'ground-up/save',
      version: SAVE_VERSION as 2,
      chips: useEditor.getState().chips,
      levelId: current?.id ?? 'sandbox',
      levelVersion: current?.version ?? 1,
      updatedAt: new Date().toISOString(),
      board,
    };
    const name = `ground-up-${save.levelId}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('menu.saved', { file: name }), 'success');
  };

  const doReset = () => {
    const { commit, toast } = useEditor.getState();
    commit(lockedOnly, []);
    setConfirmReset(false);
    toast(t('menu.resetDone'), 'info');
  };

  const toggleTheme = () => set({ theme: theme === 'dark' ? 'light' : 'dark' });
  const title = level?.title ?? t('menu.noLevel');

  return (
    <div className="gu-mainmenu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="island gu-island-btn"
        aria-label={t('menu.open')}
        title={t('menu.open')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <IconMenu />
      </button>
      <button
        type="button"
        className="island gu-level-chip"
        aria-label={t('menu.level', { title })}
        title={t('menu.levels')}
        onClick={() => set({ levelsOpen: true })}
      >
        <IconChip size={15} />
        <span>{title}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="island gu-dropdown"
          role="menu"
          aria-label={t('menu.open')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            } else onMenuKeyDown(e);
          }}
        >
          <MenuItem icon={<IconFolderOpen />} label={t('menu.openFile')} disabled={readOnly} onSelect={() => run(() => fileRef.current?.click())} />
          <MenuItem icon={<IconDownload />} label={t('menu.saveFile')} onSelect={() => run(saveToFile)} />
          <MenuItem icon={<IconReset />} label={t('menu.reset')} danger disabled={readOnly} onSelect={() => run(() => setConfirmReset(true))} />
          <div className="gu-menu-sep" role="separator" />
          <MenuItem icon={<IconLevels />} label={t('menu.levels')} onSelect={() => run(() => set({ levelsOpen: true }))} />
          <MenuItem icon={<IconHelp />} label={t('menu.help')} shortcut="?" onSelect={() => run(() => set({ helpOpen: true }))} />
          <div className="gu-menu-sep" role="separator" />
          <MenuItem
            icon={theme === 'dark' ? <IconSun /> : <IconMoon />}
            label={theme === 'dark' ? t('menu.themeLight') : t('menu.themeDark')}
            shortcut={kbd('Shift+Alt+D')}
            onSelect={toggleTheme}
          />
          <MenuItem
            icon={<IconGrid />}
            label={t('menu.grid')}
            checked={showGrid}
            shortcut={kbd("Mod+'")}
            onSelect={() => set({ showGrid: !showGrid })}
          />
          <div className="gu-menu-sep" role="separator" />
          <p className="gu-menu-about">{t('menu.about', { app: t('app.name') })}</p>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />

      {confirmReset && (
        <Dialog
          title={t('confirm.resetTitle')}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button type="button" className="gu-btn" data-autofocus onClick={() => setConfirmReset(false)}>
                {t('confirm.cancel')}
              </button>
              <button type="button" className="gu-btn gu-btn--danger" onClick={doReset}>
                {t('confirm.reset')}
              </button>
            </>
          }
        >
          <p>{t('confirm.resetBody')}</p>
        </Dialog>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function MenuItem({ icon, label, shortcut, checked, danger, disabled, onSelect }: MenuItemProps) {
  const isCheck = checked !== undefined;
  return (
    <button
      type="button"
      role={isCheck ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={isCheck ? checked : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      className={`gu-menu-item${danger ? ' gu-menu-item--danger' : ''}`}
      onClick={() => !disabled && onSelect()}
    >
      <span className="gu-menu-item__icon">{icon}</span>
      <span className="gu-menu-item__label">{label}</span>
      {isCheck && <span className="gu-menu-item__check">{checked && <IconCheck size={16} />}</span>}
      {shortcut && <kbd className="gu-menu-item__kbd">{shortcut}</kbd>}
    </button>
  );
}
