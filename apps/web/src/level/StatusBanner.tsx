import type { ReactElement } from 'react';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { LockIcon, WarnIcon } from './icons';
import { exportBoardFile, takeOver } from './persist';
import { useLevelUi } from './ui';
import './level.css';

/** Top banners: read-only tab (E-DATA-01), newer save (E-DATA-04), memory-only storage (E-DATA-02). */
export function StatusBanner() {
  const readOnly = useEditor((s) => s.readOnly);
  const storageMode = useEditor((s) => s.storageMode);
  const { lock, newerSave, memoryReason } = useLevelUi();

  const banners: ReactElement[] = [];
  if (readOnly && lock !== 'held') {
    banners.push(
      <div key="lock" className="island lv-banner" role="status">
        <LockIcon size={16} />
        <span>{lock === 'stolen' ? t('level.banner.stolen') : t('level.banner.elsewhere')}</span>
        <button type="button" className="lv-btn primary small" onClick={() => void takeOver()}>
          {t('level.banner.takeOver')}
        </button>
      </div>,
    );
  }
  if (newerSave) {
    banners.push(
      <div key="newer" className="island lv-banner warn" role="alert">
        <WarnIcon />
        <span>{t('level.banner.newer')}</span>
        <button type="button" className="lv-btn ghost small" onClick={() => location.reload()}>
          {t('level.banner.reload')}
        </button>
      </div>,
    );
  }
  if (storageMode === 'memory') {
    banners.push(
      <div key="memory" className="island lv-banner warn" role="alert">
        <WarnIcon />
        <span>{memoryReason === 'quota' ? t('level.banner.quota') : t('level.banner.memory')}</span>
        <button type="button" className="lv-btn ghost small" onClick={exportBoardFile}>
          {t('level.banner.export')}
        </button>
      </div>,
    );
  }
  if (!banners.length) return null;
  return <div className="status-banner">{banners}</div>;
}
