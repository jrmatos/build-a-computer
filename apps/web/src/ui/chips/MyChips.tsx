import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  currentChipId,
  duplicateChip,
  liveChips,
  openChipDef,
  openMakeChip,
  placeBlocker,
  placeChip,
} from '../../editor/chips';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { IconChip, IconDuplicate, IconMore, IconPlus, IconTrash } from '../icons';
import { ChipPreview } from './ChipPreview';
import { startChipDrag } from './drop';
import { useChipUi } from './state';
import './chips.css';

/** "My chips" section of the library: place, open, rename/recolor, duplicate, delete. */
export function MyChips({ query, onPlaced }: { query: string; onPlaced?: () => void }) {
  const chips = useEditor((s) => s.chips);
  const readOnly = useEditor((s) => s.readOnly);
  // Subscribed so tiles re-check self-inclusion when the edited chip changes.
  useEditor((s) => currentChipId(s));
  const [menu, setMenu] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const list = liveChips(chips).filter((c) => !q || c.name.toLowerCase().includes(q));
  if (q && !list.length) return null;

  return (
    <section className="gu-library__group gu-mychips" aria-label={t('chips.library.title')}>
      <h3 className="gu-mychips__head">
        <span>{t('chips.library.title')}</span>
        <button
          type="button"
          className="gu-icon-btn gu-icon-btn--sm"
          title={`${t('chips.make.open')} — Ctrl+Shift+M`}
          aria-label={t('chips.make.open')}
          disabled={readOnly}
          onClick={openMakeChip}
        >
          <IconPlus size={14} />
        </button>
      </h3>
      {!list.length && <p className="gu-muted gu-mychips__empty">{t('chips.library.empty')}</p>}
      <ul className="gu-tiles gu-tiles--chips">
        {list.map((c) => {
          const blocked = placeBlocker(c.id);
          const ins = c.ports.inputs.length;
          const outs = c.ports.outputs.length;
          return (
            <li key={c.id} className="gu-chiptile">
              <button
                type="button"
                className="gu-tile"
                aria-disabled={!!blocked || undefined}
                aria-label={
                  blocked ? `${c.name} — ${blocked}` : t('chips.library.place', { name: c.name })
                }
                title={
                  blocked ??
                  `${t('chips.library.place', { name: c.name })} · ${t('chips.library.pins', { ins, outs })}`
                }
                draggable={!blocked}
                onDragStart={(e) => startChipDrag(e, c.id)}
                onDoubleClick={() => openChipDef(c.id)}
                onClick={() => {
                  if (placeChip(c.id) && window.innerWidth < 760) onPlaced?.();
                }}
              >
                <span
                  className={`gu-tile__face gu-chiptile__face${blocked ? ' is-blocked' : ''}`}
                  style={{ ['--chip' as string]: c.color ?? '#4c6ef5' }}
                >
                  <ChipPreview def={c} maxWidth={56} maxHeight={42} maxScale={3} compact />
                </span>
                <span className="gu-tile__name">{c.name}</span>
                <span className="gu-tile__note">{t('chips.library.pins', { ins, outs })}</span>
              </button>
              <button
                type="button"
                className="gu-icon-btn gu-icon-btn--sm gu-chiptile__more"
                aria-label={t('chips.library.actions', { name: c.name })}
                aria-haspopup="menu"
                aria-expanded={menu === c.id}
                onClick={() => setMenu(menu === c.id ? null : c.id)}
              >
                <IconMore size={14} />
              </button>
              {menu === c.id && <ChipMenu id={c.id} onClose={() => setMenu(null)} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ChipMenu({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const readOnly = useEditor((s) => s.readOnly);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', away, true);
    ref.current?.addEventListener('keydown', key);
    const el = ref.current;
    return () => {
      document.removeEventListener('pointerdown', away, true);
      el?.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const ui = useChipUi.getState();
  const item = (
    label: string,
    icon: ReactNode,
    fn: () => void,
    disabled = false,
    danger = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      className={`gu-menu-item${danger ? ' gu-menu-item--danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        onClose();
        fn();
      }}
    >
      <span className="gu-menu-item__icon">{icon}</span>
      <span className="gu-menu-item__label">{label}</span>
    </button>
  );
  return (
    <div ref={ref} className="island gu-chipmenu" role="menu">
      {item(t('chips.library.open'), <IconChip size={16} />, () => openChipDef(id))}
      {item(t('chips.library.edit'), <IconMore size={16} />, () => ui.set({ edit: id }), readOnly)}
      {item(
        t('chips.library.duplicate'),
        <IconDuplicate size={16} />,
        () => void duplicateChip(id),
        readOnly,
      )}
      {item(
        t('chips.library.delete'),
        <IconTrash size={16} />,
        () => ui.set({ remove: id }),
        readOnly,
        true,
      )}
    </div>
  );
}
