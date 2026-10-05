/**
 * Excalidraw-style file status next to the main menu: the connected file's
 * name and "Saved" / "Saving…" / "Unsaved changes", a "Reconnect to <name>"
 * offer after a reload, or a reminder to export where files cannot autosave
 * (E-PLAT-03) or the browser may evict storage (E-PLAT-04).
 */
import { t } from '../i18n';
import { exportAll, fixError, reconnect, saveNow, saveToFile } from './controller';
import { IconFile } from './icons';
import { useFileUi } from './state';
import './storage.css';

export function FileStatus() {
  const fsa = useFileUi((s) => s.fsa);
  const sync = useFileUi((s) => s.sync);
  const again = useFileUi((s) => s.reconnect);
  const persist = useFileUi((s) => s.persist);

  if (sync.fileName) {
    const status = sync.status === 'error' ? 'error' : sync.status === 'none' ? 'saved' : sync.status;
    const text =
      status === 'error'
        ? t(`storage.status.fix.${sync.error ?? 'write-failed'}`)
        : t(status === 'dirty' ? 'storage.status.dirtyShort' : `storage.status.${status}`);
    const title = [
      t('storage.status.label', { file: sync.fileName, status: status === 'dirty' ? t('storage.status.dirty') : text }),
      status === 'error' ? t(`storage.status.fixHint.${sync.error ?? 'write-failed'}`) : '',
      sync.savedAt ? t('storage.status.savedAt', { time: new Date(sync.savedAt).toLocaleTimeString() }) : '',
    ]
      .filter(Boolean)
      .join('\n');
    return (
      <button
        type="button"
        className={`island gu-file-status gu-file-status--${status}`}
        title={title}
        aria-label={title}
        onClick={() => void (status === 'error' ? fixError() : saveNow())}
      >
        <span className="gu-file-status__dot" aria-hidden="true" />
        <span className="gu-file-status__name">{sync.fileName}</span>
        <span className="gu-file-status__state" aria-live="polite">
          {text}
        </span>
      </button>
    );
  }

  if (fsa && again) {
    return (
      <button
        type="button"
        className="island gu-file-status gu-file-status--reconnect"
        title={t('storage.status.reconnectHint', { file: again.name })}
        onClick={() => void reconnect()}
      >
        <IconFile size={15} />
        <span className="gu-file-status__name">{t('storage.status.reconnect', { file: again.name })}</span>
      </button>
    );
  }

  if (!fsa) {
    return (
      <button
        type="button"
        className="island gu-file-status gu-file-status--hint"
        title={t('storage.status.exportHintLong')}
        onClick={() => void exportAll()}
      >
        <IconFile size={15} />
        <span className="gu-file-status__name">{t('storage.status.exportHint')}</span>
      </button>
    );
  }

  if (persist === 'denied') {
    return (
      <button
        type="button"
        className="island gu-file-status gu-file-status--hint"
        title={t('storage.status.persistHintLong')}
        onClick={() => void saveToFile()}
      >
        <IconFile size={15} />
        <span className="gu-file-status__name">{t('storage.status.persistHint')}</span>
      </button>
    );
  }
  return null;
}
