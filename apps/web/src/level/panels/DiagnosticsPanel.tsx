import { useMemo } from 'react';
import { zoomToFit } from '../../editor/camera';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { collectDiagnostics, type DiagEntry } from './diagnostics';

const FLASH_MS = 1600;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Pan and zoom to a diagnostic's parts and flash them. */
export function focusDiagnostic(d: DiagEntry): void {
  if (!d.ids.length) return;
  zoomToFit(d.ids);
  const { set } = useEditor.getState();
  set({ flashIds: d.ids });
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (useEditor.getState().flashIds === d.ids) set({ flashIds: [] });
  }, FLASH_MS);
}

/** Diagnostics for the current board: compile problems plus what the running simulation reports. */
export function useDiagnostics(): DiagEntry[] {
  const board = useEditor((s) => s.board);
  const compiled = useEditor((s) => s.diagnostics);
  // Only the pin lists matter from the snapshot, not every tick.
  const contention = useEditor((s) => s.snapshot?.contentionPins.join('|') ?? '');
  const unstable = useEditor((s) => s.snapshot?.unstablePins.join('|') ?? '');
  return useMemo(() => {
    const pins = (k: string) => (k ? k.split('|') : []);
    const live = { contentionPins: pins(contention), unstablePins: pins(unstable) };
    return collectDiagnostics(board, compiled, live);
  }, [board, compiled, contention, unstable]);
}

/** Diagnostics (EDIT-10): contention, unstable nets, floating inputs, width errors. */
export function DiagnosticsPanel({ entries }: { entries: DiagEntry[] }) {
  if (!entries.length) return <p className="dk-empty">{t('panels.diag.none')}</p>;
  return (
    <ul className="dk-diag-list" aria-label={t('panels.tab.diagnostics')}>
      {entries.map((d) => (
        <li key={d.key}>
          <button
            type="button"
            className={`dk-diag is-${d.severity}`}
            onClick={() => focusDiagnostic(d)}
            disabled={!d.ids.length}
            title={d.ids.length ? t('panels.diag.show') : undefined}
          >
            <span className="dk-diag-dot" aria-hidden="true" />
            <span className="dk-diag-kind">{t(`panels.diag.kind.${d.code}`) === `panels.diag.kind.${d.code}` ? d.code : t(`panels.diag.kind.${d.code}`)}</span>
            <span className="dk-diag-text">{d.text}</span>
            {d.live && <span className="dk-tag">{t('panels.diag.live')}</span>}
            <span className="visually-hidden">{d.severity === 'error' ? t('panels.diag.error') : t('panels.diag.warning')}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
