/**
 * Summary shown before a workspace is applied: how many boards, chips and
 * completed levels, and a Keep mine / Use file choice for every board that
 * differs (E-PLAT-01). Nothing changes until the player confirms.
 */
import { useState } from 'react';
import { levelById } from '@ground-up/content';
import { t } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { completedIds } from '../level/progress';
import { applyPreview, cancelPreview } from './controller';
import { defaultChoices, type SaveConflict, type Side } from './merge';
import { useFileUi, type ImportPreview } from './state';
import './storage.css';

export function ImportDialog() {
  const preview = useFileUi((s) => s.preview);
  if (!preview) return null;
  // Remount per preview so choices reset.
  return <ImportDialogBody key={`${preview.fileName}:${preview.workspace.exportedAt}`} preview={preview} />;
}

const when = (iso: string) => new Date(iso).toLocaleString();

function ImportDialogBody({ preview }: { preview: ImportPreview }) {
  const { merge, workspace, fileName, mode } = preview;
  const [choices, setChoices] = useState<Record<string, Side>>(() => defaultChoices(merge));
  const added = Object.keys(merge.added).length;
  const choose = (id: string, side: Side) => setChoices((c) => ({ ...c, [id]: side }));

  return (
    <Dialog
      title={t(mode === 'open' ? 'storage.dialog.titleOpen' : 'storage.dialog.titleImport', { file: fileName })}
      onClose={cancelPreview}
      footer={
        <>
          <button type="button" className="gu-btn" onClick={cancelPreview}>
            {t('storage.dialog.cancel')}
          </button>
          <button type="button" className="gu-btn gu-btn--primary" data-autofocus onClick={() => void applyPreview(preview, choices)}>
            {t(mode === 'open' ? 'storage.dialog.open' : 'storage.dialog.import')}
          </button>
        </>
      }
    >
      <div className="gu-import">
        <p>
          {t('storage.dialog.summary', {
            levels: Object.keys(workspace.saves).length,
            chips: Object.values(workspace.chips).filter((c) => !c.deleted).length,
            completed: completedIds(workspace.progress).length,
          })}
        </p>
        <ul className="gu-import__list">
          {added > 0 && <li>{t('storage.dialog.added', { n: added })}</li>}
          {merge.progressGained.length > 0 && <li>{t('storage.dialog.progress', { n: merge.progressGained.length })}</li>}
          {merge.chipsChanged.length > 0 && <li>{t('storage.dialog.chips', { n: merge.chipsChanged.length })}</li>}
          {merge.unchanged.length > 0 && <li>{t('storage.dialog.unchanged', { n: merge.unchanged.length })}</li>}
        </ul>
        {merge.conflicts.length > 0 && (
          <>
            <p className="gu-import__h">{t('storage.dialog.conflicts')}</p>
            <ul className="gu-import__conflicts">
              {merge.conflicts.map((c) => (
                <ConflictRow key={c.levelId} c={c} choice={choices[c.levelId] ?? 'local'} onChoose={(s) => choose(c.levelId, s)} />
              ))}
            </ul>
            <p className="gu-import__note">{t('storage.dialog.backupNote')}</p>
          </>
        )}
        {mode === 'open' && <p className="gu-import__note">{t('storage.dialog.openNote', { file: fileName })}</p>}
      </div>
    </Dialog>
  );
}

function ConflictRow({ c, choice, onChoose }: { c: SaveConflict; choice: Side; onChoose: (s: Side) => void }) {
  const title = levelById(c.levelId)?.title ?? c.levelId;
  const option = (side: Side) => {
    const save = side === 'local' ? c.local : c.incoming;
    return (
      <label className={`gu-import__opt${choice === side ? ' is-on' : ''}`}>
        <input type="radio" name={`conflict-${c.levelId}`} checked={choice === side} onChange={() => onChoose(side)} />
        <span>
          <strong>{t(side === 'local' ? 'storage.dialog.mine' : 'storage.dialog.theirs')}</strong>
          {c.newer === side && <em className="gu-import__badge">{t('storage.dialog.newer')}</em>}
          <small>
            {t('storage.dialog.edited', { time: when(save.updatedAt) })} · {save.board.parts.length} parts
          </small>
        </span>
      </label>
    );
  };
  return (
    <li className="gu-import__conflict">
      <span className="gu-import__level">{title}</span>
      <div className="gu-import__opts" role="radiogroup" aria-label={title}>
        {option('local')}
        {option('incoming')}
      </div>
    </li>
  );
}
