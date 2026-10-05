import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { IconAlert, IconCheck, IconClose, IconInfo } from './icons';
import './ui.css';

/** Bottom-center notification stack. */
export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const set = useEditor((s) => s.set);
  const dismiss = (id: number) => set({ toasts: useEditor.getState().toasts.filter((x) => x.id !== id) });

  return (
    <div className="gu-toasts" role="region" aria-label={t('toasts.label')}>
      <div role="status" aria-live="polite" className="gu-toasts__stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`island gu-toast gu-toast--${toast.tone}`}>
            <span className="gu-toast__icon">
              {toast.tone === 'error' ? <IconAlert size={16} /> : toast.tone === 'success' ? <IconCheck size={16} /> : <IconInfo size={16} />}
            </span>
            <span className="gu-toast__text">{toast.text}</span>
            <button type="button" className="gu-icon-btn gu-icon-btn--sm" aria-label={t('toasts.dismiss')} onClick={() => dismiss(toast.id)}>
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
