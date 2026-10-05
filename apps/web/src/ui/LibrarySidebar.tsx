import { useEffect, useRef, useState } from 'react';
import { PART_GROUPS } from '../editor/parts';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { IconClose, IconLock, IconSearch, PartSymbol } from './icons';
import { isPartAllowed, paletteKeys } from './shortcuts';
import { startPartDrag } from './Toolbar';
import './ui.css';

/** Right sliding panel with every part, grouped. Parts outside the level palette are locked. */
export function LibrarySidebar() {
  const open = useEditor((s) => s.libraryOpen);
  const level = useEditor((s) => s.level);
  const tool = useEditor((s) => s.tool);
  const readOnly = useEditor((s) => s.readOnly);
  const set = useEditor((s) => s.set);
  const setTool = useEditor((s) => s.setTool);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const close = () => set({ libraryOpen: false });

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useEditor.getState().helpOpen) {
        // Only claim Esc when focus is in the panel or nowhere in particular.
        const a = document.activeElement;
        if (a && a !== document.body && !panelRef.current?.contains(a)) return;
        e.preventDefault();
        set({ libraryOpen: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, set]);

  const keys = paletteKeys(level);
  const q = query.trim().toLowerCase();
  const groups = PART_GROUPS.map((g) => ({
    ...g,
    parts: g.parts.filter((p) => !q || t(`part.${p}`).toLowerCase().includes(q) || p.includes(q)),
  })).filter((g) => g.parts.length);

  return (
    <aside
      ref={panelRef}
      className={`island gu-library${open ? ' is-open' : ''}`}
      aria-label={t('library.title')}
      aria-hidden={!open}
      inert={!open}
    >
      <header className="gu-library__head">
        <h2>{t('library.title')}</h2>
        <button type="button" className="gu-icon-btn" aria-label={t('library.close')} title={`${t('library.close')} — Esc`} onClick={close}>
          <IconClose size={18} />
        </button>
      </header>
      <div className="gu-search">
        <IconSearch size={16} />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={t('library.search')}
          aria-label={t('library.search')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
        />
      </div>
      <div className="gu-library__body">
        {groups.length === 0 && <p className="gu-muted">{t('library.empty', { q: query })}</p>}
        {groups.map((g) => (
          <section key={g.key} className="gu-library__group">
            <h3>{t(g.key)}</h3>
            <ul className="gu-tiles">
              {g.parts.map((type) => {
                const ok = isPartAllowed(level, type) && !readOnly;
                const name = t(`part.${type}`);
                const key = keys.get(type);
                const active = tool === `place:${type}`;
                return (
                  <li key={type}>
                    <button
                      type="button"
                      className={`gu-tile${active ? ' is-active' : ''}`}
                      disabled={!ok}
                      aria-pressed={active}
                      aria-label={ok ? t('tool.place', { part: name }) : `${name} — ${t('library.locked')}`}
                      title={ok ? (key ? t('tool.shortcut', { name, key }) : name) : t('library.locked')}
                      draggable={ok}
                      onDragStart={(e) => startPartDrag(e, type)}
                      onClick={() => {
                        setTool(`place:${type}`);
                        if (window.innerWidth < 760) close();
                      }}
                    >
                      <span className="gu-tile__face">
                        <PartSymbol type={type} size={28} />
                        {!isPartAllowed(level, type) && (
                          <span className="gu-tile__lock">
                            <IconLock size={12} />
                          </span>
                        )}
                        {key && ok && <span className="gu-tile__key">{key}</span>}
                      </span>
                      <span className="gu-tile__name">{name}</span>
                      {!isPartAllowed(level, type) && <span className="gu-tile__note">{t('library.locked')}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <p className="gu-library__foot gu-muted">{t('library.hint')}</p>
    </aside>
  );
}
