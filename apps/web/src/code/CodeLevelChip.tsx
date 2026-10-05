import { useEditor } from '../editor/store';
import { t } from '../i18n';
import './code.css';

/** Shown in the top toolbar instead of the board tools on code levels. */
export function CodeLevelChip() {
  const isC = useEditor((s) => s.level?.code?.language === 'c');
  return (
    <div className="island code-chip" role="note" title={t(isC ? 'code.chipTitleC' : 'code.chipTitle')}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
      <span>{t('code.chip')}</span>
      <span className="code-chip__lang">{isC ? 'C' : 'RV32'}</span>
    </div>
  );
}
