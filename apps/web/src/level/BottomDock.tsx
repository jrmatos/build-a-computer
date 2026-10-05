import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { insets } from '../editor/camera';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { DiagnosticsPanel, useDiagnostics } from './panels/DiagnosticsPanel';
import { DOCK_TABS, MAX_HEIGHT, MIN_HEIGHT, useDock, type DockTab } from './panels/dockState';
import { MemoryPanel } from './panels/MemoryPanel';
import { ProgramPanel } from './panels/ProgramPanel';
import { WaveformPanel, useWaveformShortcut } from './panels/WaveformPanel';
import './panels/panels.css';

const ICONS: Record<DockTab, ReactNode> = {
  waveform: <path d="M3 12h3l2-6 4 12 3-9 2 3h4" />,
  diagnostics: (
    <>
      <path d="M12 4 21 19H3Z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  memory: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  program: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
};

function TabIcon({ tab }: { tab: DockTab }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[tab]}
    </svg>
  );
}

/**
 * Bottom dock, Turing Complete style: waveform, diagnostics, memory/CPU and
 * the machine-code editor as tabs. Collapsible and resizable; the open tab and
 * height are remembered per viewer.
 */
export function BottomDock() {
  useWaveformShortcut();
  const open = useDock((s) => s.open);
  const tab = useDock((s) => s.tab);
  const height = useDock((s) => s.height);
  const pinned = useDock((s) => s.pinned.length);
  const { setOpen, setTab, setHeight } = useDock.getState();
  const diags = useDiagnostics();
  const errors = diags.filter((d) => d.severity === 'error').length;
  const hasMemory = useEditor((s) => s.board.parts.some((p) => p.type === 'ram' || p.type === 'rom' || p.type === 'register' || p.type === 'counter'));
  const tabRefs = useRef<Partial<Record<DockTab, HTMLButtonElement | null>>>({});

  // While open, the dock covers the bottom of the board: keep zoom-to-fit (and diagnostic jumps) above it.
  useEffect(() => {
    const base = insets.bottom;
    if (open) insets.bottom = Math.max(base, height + 32);
    return () => {
      insets.bottom = base;
    };
  }, [open, height]);

  const badge = (k: DockTab): ReactNode => {
    if (k === 'diagnostics' && diags.length)
      return (
        <span className={`dk-badge ${errors ? 'is-error' : 'is-warning'}`} aria-label={t('panels.diag.count', { n: diags.length })}>
          {diags.length}
        </span>
      );
    if (k === 'waveform' && pinned) return <span className="dk-badge">{pinned}</span>;
    return null;
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = DOCK_TABS.indexOf(tab);
    let next: DockTab | undefined;
    if (e.key === 'ArrowRight') next = DOCK_TABS[(i + 1) % DOCK_TABS.length];
    else if (e.key === 'ArrowLeft') next = DOCK_TABS[(i - 1 + DOCK_TABS.length) % DOCK_TABS.length];
    else if (e.key === 'Home') next = DOCK_TABS[0];
    else if (e.key === 'End') next = DOCK_TABS[DOCK_TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  // Drag the top edge to resize; arrow keys on the handle do the same.
  const drag = useRef<{ y: number; h: number } | null>(null);
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: height };
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setHeight(drag.current.h + (drag.current.y - e.clientY));
  };
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.shiftKey ? 60 : 20;
    if (e.key === 'ArrowUp') setHeight(height + d);
    else if (e.key === 'ArrowDown') setHeight(height - d);
    else return;
    e.preventDefault();
  };

  const tabs = (
    <div className="dk-tabs" role="tablist" aria-label={t('panels.label')} onKeyDown={onTabKey}>
      {DOCK_TABS.map((k) => {
        const selected = open && tab === k;
        return (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[k] = el;
            }}
            type="button"
            role="tab"
            id={`dk-tab-${k}`}
            aria-selected={selected}
            aria-controls={open ? 'dk-panel' : undefined}
            tabIndex={tab === k ? 0 : -1}
            className={`dk-tab ${selected ? 'is-active' : ''} ${k === 'memory' && !hasMemory ? 'is-dim' : ''}`}
            onClick={() => (selected ? setOpen(false) : setTab(k))}
          >
            <TabIcon tab={k} />
            <span>{t(`panels.tab.${k}`)}</span>
            {badge(k)}
          </button>
        );
      })}
    </div>
  );

  return (
    <section className={`island dk ${open ? 'is-open' : ''}`} aria-label={t('panels.label')} style={open ? { height } : undefined}>
      {open && (
        <div
          className="dk-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('panels.resize')}
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={MAX_HEIGHT}
          aria-valuenow={height}
          tabIndex={0}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onHandleKey}
        />
      )}
      <header className="dk-head">
        {tabs}
        <button
          type="button"
          className="dk-collapse"
          aria-expanded={open}
          aria-label={open ? t('panels.collapse') : t('panels.expand')}
          title={open ? t('panels.collapse') : t('panels.expand')}
          onClick={() => setOpen(!open)}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={open ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} />
          </svg>
        </button>
      </header>
      {open && (
        <div className="dk-body" id="dk-panel" role="tabpanel" aria-labelledby={`dk-tab-${tab}`}>
          {tab === 'waveform' && <WaveformPanel />}
          {tab === 'diagnostics' && <DiagnosticsPanel entries={diags} />}
          {tab === 'memory' && <MemoryPanel />}
          {tab === 'program' && <ProgramPanel />}
        </div>
      )}
    </section>
  );
}
