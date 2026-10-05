import { useState, type ReactNode } from 'react';
import type { Part } from '@ground-up/schema';
import { deleteSelection, duplicateSelection, flipSelection, rotateSelection, setPartLabel } from '../editor/actions';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { IconDuplicate, IconFlip, IconLock, IconRotateCcw, IconRotateCw, IconTrash, PartSymbol } from './icons';
import { kbd } from './shortcuts';
import './ui.css';

/** Left island with the selection's properties, shown only when something is selected. */
export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  const board = useEditor((s) => s.board);
  const readOnly = useEditor((s) => s.readOnly);

  if (!selection.length) return null;
  const ids = new Set(selection);
  const parts = board.parts.filter((p) => ids.has(p.id));
  const wireCount = board.wires.reduce((n, w) => n + (ids.has(w.id) ? 1 : 0), 0);
  if (!parts.length && !wireCount) return null;

  const single = parts.length === 1 && wireCount === 0 ? parts[0]! : null;
  const allLocked = parts.length > 0 && wireCount === 0 && parts.every((p) => p.locked);
  const editableParts = parts.filter((p) => !p.locked).length > 0;
  const summary = [
    parts.length ? (parts.length === 1 ? t('props.part') : t('props.parts', { n: parts.length })) : null,
    wireCount ? (wireCount === 1 ? t('props.wire') : t('props.wires', { n: wireCount })) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <section className="island gu-props" aria-label={t('props.label')}>
      {single ? (
        <div className="gu-props__head">
          <span className="gu-mini-tile" aria-hidden="true">
            <PartSymbol type={single.type} size={16} />
          </span>
          <div className="gu-props__title">
            <strong>{t(`part.${single.type}`)}</strong>
            {single.locked && (
              <span className="gu-props__locked">
                <IconLock size={12} /> {t('props.locked')}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="gu-props__head">
          <strong>{summary}</strong>
        </div>
      )}

      {single && <LabelField key={`${single.id}:${single.label ?? ''}`} part={single} disabled={readOnly} />}

      {parts.length > 0 && (
        <>
          <h3 className="gu-props__section">{t('props.arrange')}</h3>
          <div className="gu-btn-row">
            <IconAction label={t('action.rotateLeft')} shortcut="Shift+R" disabled={readOnly || !editableParts} onClick={() => rotateSelection(-1)}>
              <IconRotateCcw size={16} />
            </IconAction>
            <IconAction label={t('action.rotate')} shortcut="R" disabled={readOnly || !editableParts} onClick={() => rotateSelection(1)}>
              <IconRotateCw size={16} />
            </IconAction>
            <IconAction label={t('action.flip')} shortcut="F" disabled={readOnly || !editableParts} onClick={flipSelection}>
              <IconFlip size={16} />
            </IconAction>
          </div>
        </>
      )}

      <h3 className="gu-props__section">{t('props.actions')}</h3>
      <div className="gu-btn-row">
        <IconAction label={t('action.duplicate')} shortcut={kbd('Mod+D')} disabled={readOnly || allLocked} onClick={duplicateSelection}>
          <IconDuplicate size={16} />
        </IconAction>
        <IconAction label={t('action.delete')} shortcut="Delete" danger disabled={readOnly || allLocked} onClick={deleteSelection}>
          <IconTrash size={16} />
        </IconAction>
      </div>
    </section>
  );
}

function LabelField({ part, disabled }: { part: Part; disabled: boolean }) {
  const [value, setValue] = useState(part.label ?? '');
  const commit = () => {
    if ((part.label ?? '') !== value.trim()) setPartLabel(part.id, value);
  };
  return (
    <label className="gu-field">
      <span className="gu-props__section">{t('props.labelField')}</span>
      <input
        className="gu-input"
        type="text"
        value={value}
        maxLength={40}
        placeholder={t('props.labelPlaceholder')}
        disabled={disabled || part.locked}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setValue(part.label ?? '');
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function IconAction({
  label,
  shortcut,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`gu-icon-btn gu-icon-btn--boxed${danger ? ' gu-icon-btn--danger' : ''}`}
      aria-label={label}
      title={`${label} — ${shortcut}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
