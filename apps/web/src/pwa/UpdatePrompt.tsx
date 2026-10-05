import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { IconAlert, IconClose, IconRotateCw } from '../ui/icons';
import { applyUpdate } from './register';
import { getStatus, setStatus, subscribe } from './state';
import './pwa.css';

/**
 * "A new version is ready — Reload" toast (FND-09, E-DATA-09). It stays until
 * the player acts: an update never reloads the page on its own.
 */
export function UpdatePrompt() {
  const status = useSyncExternalStore(subscribe, getStatus);
  if (status === 'idle') return null;

  if (status === 'incompatible') {
    return (
      <div className="bac-update island gu-toast gu-toast--error" role="alert">
        <span className="gu-toast__icon">
          <IconAlert size={16} />
        </span>
        <span className="gu-toast__text">{t('pwa.update.incompatible')}</span>
        <button
          type="button"
          className="gu-icon-btn gu-icon-btn--sm"
          aria-label={t('toasts.dismiss')}
          onClick={() => setStatus('idle')}
        >
          <IconClose size={14} />
        </button>
      </div>
    );
  }

  const busy = status === 'reloading';
  return (
    <div className="bac-update island gu-toast" role="status" aria-live="polite">
      <span className="gu-toast__icon">
        <IconRotateCw size={16} />
      </span>
      <span className="gu-toast__text">
        {t(status === 'activated' ? 'pwa.update.activated' : 'pwa.update.ready')}
      </span>
      <button
        type="button"
        className="gu-btn bac-update__reload"
        disabled={busy}
        onClick={() => void applyUpdate()}
      >
        {t(busy ? 'pwa.update.reloading' : 'pwa.update.reload')}
      </button>
      <button
        type="button"
        className="gu-icon-btn gu-icon-btn--sm"
        aria-label={t('pwa.update.later')}
        title={t('pwa.update.later')}
        disabled={busy}
        onClick={() => setStatus('idle')}
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}
