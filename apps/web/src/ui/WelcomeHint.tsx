import { useEditor } from '../editor/store';
import { useModeUi } from '../modes';
import { t } from '../i18n';
import { paletteKeys } from './shortcuts';
import './ui.css';

/** Faint centered welcome, shown until the player places their first part. */
export function WelcomeHint() {
  const building = useEditor((s) => s.board.parts.some((p) => !p.locked));
  // Level starter parts sit mid-board, so then only a compact hint strip shows at the bottom.
  const compact = useEditor((s) => s.board.parts.length > 0);
  const readOnly = useEditor((s) => s.readOnly);
  // Code levels (Phase 6+) and Track 2 js levels have no board to welcome the player to.
  const { welcome } = useModeUi();
  const hidden = building || readOnly || !welcome;
  const keys = [...paletteKeys(useEditor((s) => s.level)).values()];
  const range = keys.length > 1 ? `${keys[0]}–${keys[keys.length - 1]}` : keys.length ? String(keys[0]) : '';

  return (
    <div
      className={`welcome-hint gu-welcome${compact ? ' gu-welcome--compact' : ''}${hidden ? ' is-hidden' : ''}`}
      aria-hidden={hidden}
    >
      <div className="gu-welcome__logo" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 8h7M2 16h7" />
          <path d="M9 4h7a8 8 0 0 1 0 16H9z" />
          <circle cx="26" cy="12" r="2" />
          <path d="M28 12h2" />
        </svg>
      </div>
      <h1 className="gu-welcome__title">{t('app.name')}</h1>
      <p className="gu-welcome__tagline">{t('welcome.tagline')}</p>
      <ul className="gu-welcome__hints">
        <li>{range ? t('welcome.hint1', { keys: range }) : t('welcome.hint1NoKeys')}</li>
        <li>{t('welcome.hint2')}</li>
        <li>{t('welcome.hint3')}</li>
      </ul>
    </div>
  );
}
