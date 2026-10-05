import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChipUsage } from '@build-a-computer/sim-logic';
import { chipUsages, deleteChip, recolorChip, renameChip } from '../../editor/chips';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { Dialog } from '../Dialog';
import { ChipPreview } from './ChipPreview';
import { ColorPicker, MakeChipDialog } from './MakeChipDialog';
import { useChipUi } from './state';
import './chips.css';

/** All chip dialogs, rendered over everything. Mounted once (from Breadcrumbs). */
export function ChipDialogs() {
  const make = useChipUi((s) => s.make);
  const edit = useChipUi((s) => s.edit);
  const remove = useChipUi((s) => s.remove);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {make && <MakeChipDialog />}
      {edit && <EditChipDialog id={edit} />}
      {remove && <DeleteChipDialog id={remove} />}
    </>,
    document.body,
  );
}

function EditChipDialog({ id }: { id: string }) {
  const def = useEditor((s) => s.chips[id]);
  const [name, setName] = useState(def?.name ?? '');
  const [color, setColor] = useState(def?.color);
  const close = () => useChipUi.getState().set({ edit: null });
  if (!def) return null;
  const save = () => {
    if (!name.trim()) return;
    if (name.trim() !== def.name) renameChip(id, name);
    if (color !== def.color) recolorChip(id, color);
    close();
  };
  return (
    <Dialog
      title={t('chips.edit.title')}
      onClose={close}
      footer={
        <>
          <button type="button" className="gu-btn" onClick={close}>
            {t('chips.make.cancel')}
          </button>
          <button
            type="button"
            className="gu-btn gu-btn--primary"
            disabled={!name.trim()}
            onClick={save}
          >
            {t('chips.edit.save')}
          </button>
        </>
      }
    >
      <form
        className="gu-chipedit"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="gu-field">
          <span>{t('chips.make.name')}</span>
          <input
            className="gu-input"
            data-autofocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="gu-field gu-chip-colors">
          <legend>{t('chips.make.color')}</legend>
          <ColorPicker value={color} onChange={setColor} />
        </fieldset>
        <div className="gu-chipmake__preview">
          <ChipPreview
            def={{ ...def, name: name.trim() || def.name, ...(color ? { color } : {}) }}
            maxWidth={300}
            maxHeight={220}
            maxScale={2}
          />
        </div>
      </form>
    </Dialog>
  );
}

/** E-DATA-08: list usages first, then tombstone. */
function DeleteChipDialog({ id }: { id: string }) {
  const def = useEditor((s) => s.chips[id]);
  const [usages, setUsages] = useState<ChipUsage[] | null>(null);
  const close = () => useChipUi.getState().set({ remove: null });
  useEffect(() => {
    let live = true;
    void chipUsages(id).then(
      (u) =>
        live &&
        setUsages(
          u.filter(
            (x) => x.kind === 'board' || !useEditor.getState().chips[x.chipId ?? '']?.deleted,
          ),
        ),
    );
    return () => {
      live = false;
    };
  }, [id]);
  if (!def) return null;
  const confirm = () => {
    if (deleteChip(id))
      useEditor.getState().toast(t('chips.delete.done', { name: def.name }), 'info');
    close();
  };
  const chips = useEditor.getState().chips;
  return (
    <Dialog
      title={t('chips.delete.title', { name: def.name })}
      onClose={close}
      footer={
        <>
          <button type="button" className="gu-btn" data-autofocus onClick={close}>
            {t('chips.make.cancel')}
          </button>
          <button
            type="button"
            className="gu-btn gu-btn--danger"
            disabled={!usages}
            onClick={confirm}
          >
            {t('chips.delete.confirm')}
          </button>
        </>
      }
    >
      {!usages ? (
        <p>{t('chips.delete.loading')}</p>
      ) : !usages.length ? (
        <p>{t('chips.delete.unused')}</p>
      ) : (
        <>
          <p>{t('chips.delete.used')}</p>
          <ul className="gu-usages">
            {usages.map((u) => (
              <li key={`${u.kind}:${u.chipId ?? u.name}`}>
                <strong>
                  {t(u.kind === 'board' ? 'chips.delete.board' : 'chips.delete.chip', {
                    name: u.name,
                  })}
                </strong>{' '}
                <span className="gu-muted">
                  {t('chips.delete.count', { count: u.parts.length })}
                  {u.via?.length
                    ? ` · ${t('chips.delete.via', { via: u.via.map((v) => chips[v]?.name ?? v).join(', ') })}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
