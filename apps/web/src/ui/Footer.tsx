import { resetZoom, zoomIn, zoomOut } from '../editor/camera';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { IconMinus, IconPlus, IconRedo, IconUndo } from './icons';
import { kbd } from './shortcuts';
import './ui.css';

/** Bottom-left islands: zoom and undo/redo. */
export function Footer() {
  const zoom = useEditor((s) => s.camera.zoom);
  const canUndo = useEditor((s) => s.past.length > 0 && !s.readOnly);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.readOnly);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  return (
    <div className="gu-footer">
      <div className="island gu-group" role="group" aria-label={t('footer.zoom')}>
        <button type="button" className="gu-icon-btn" aria-label={t('zoom.out')} title={`${t('zoom.out')} — ${kbd('Mod+-')}`} onClick={zoomOut}>
          <IconMinus size={16} />
        </button>
        <button
          type="button"
          className="gu-zoom-value"
          aria-label={`${t('zoom.reset')} (${Math.round(zoom * 100)}%)`}
          title={`${t('zoom.reset')} — ${kbd('Mod+0')}`}
          onClick={resetZoom}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="gu-icon-btn" aria-label={t('zoom.in')} title={`${t('zoom.in')} — ${kbd('Mod+=')}`} onClick={zoomIn}>
          <IconPlus size={16} />
        </button>
      </div>
      <div className="island gu-group" role="group" aria-label={t('footer.history')}>
        <button
          type="button"
          className="gu-icon-btn"
          aria-label={t('action.undo')}
          title={`${t('action.undo')} — ${kbd('Mod+Z')}`}
          disabled={!canUndo}
          onClick={undo}
        >
          <IconUndo size={16} />
        </button>
        <button
          type="button"
          className="gu-icon-btn"
          aria-label={t('action.redo')}
          title={`${t('action.redo')} — ${kbd('Mod+Shift+Z')}`}
          disabled={!canRedo}
          onClick={redo}
        >
          <IconRedo size={16} />
        </button>
      </div>
    </div>
  );
}
