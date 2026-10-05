import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { useDock } from './dockState';
import { selectedWire, wireName } from './names';
import { dockSource } from './source';
import { useCssColors } from './useCssColors';
import {
  EMPTY_HISTORY,
  LANE_H,
  RULER_H,
  clampView,
  drawWaves,
  findClockWire,
  formatValue,
  panView,
  zoomView,
  type History,
  type Lane,
  type View,
} from './waveform';

const POLL_MS = 100; // ≤ 10 Hz

/** Waveform (EDIT-11): pinned wires as lanes over the last 4,096 ticks, with a scrub cursor. */
export function WaveformPanel() {
  const board = useEditor((s) => s.board);
  const selection = useEditor((s) => s.selection);
  const ticks = useEditor((s) => s.snapshot?.ticks ?? 0);
  const running = useEditor((s) => !!s.snapshot?.running);
  const pinned = useDock((s) => s.pinned);
  const { pin, unpin, movePin, setPinned } = useDock.getState();
  const colors = useCssColors();

  const clockWire = useMemo(() => findClockWire(board), [board]);
  const wireIds = useMemo(() => new Set(board.wires.map((w) => w.id)), [board]);
  const lanes: Lane[] = useMemo(() => {
    const out: Lane[] = [];
    if (clockWire) out.push({ id: clockWire, label: t('panels.wave.clock'), clock: true });
    for (const id of pinned) if (id !== clockWire && wireIds.has(id)) out.push({ id, label: wireName(board, id), clock: false });
    return out;
  }, [board, clockWire, pinned, wireIds]);

  // Forget lanes whose wire was deleted.
  useEffect(() => {
    const keep = pinned.filter((id) => wireIds.has(id));
    if (keep.length !== pinned.length) setPinned(keep);
  }, [pinned, wireIds, setPinned]);

  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [view, setView] = useState<View>({ start: 0, span: 128, follow: true });
  const [cursor, setCursor] = useState<number | null>(null);
  const count = history.ticks.length;
  const shown = clampView(view, count);

  // Tell the worker what to record; a board reload resets recording, so re-send on board change.
  const watchKey = lanes.map((l) => l.id).join(',');
  useEffect(() => {
    void dockSource.watch(watchKey ? watchKey.split(',') : []);
  }, [watchKey, board]);

  // Poll while running; otherwise refresh after each step.
  useEffect(() => {
    if (!running && !dockSource.live()) return;
    let busy = false;
    const id = setInterval(() => {
      if (busy) return;
      busy = true;
      void dockSource
        .history()
        .then((h) => h && setHistory(h))
        .finally(() => (busy = false));
    }, POLL_MS);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    let alive = true;
    void dockSource.history().then((h) => alive && h && setHistory(h));
    return () => {
      alive = false;
    };
  }, [ticks, watchKey]);

  // Canvas sizing and drawing.
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(50, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = RULER_H + Math.max(1, lanes.length) * LANE_H + 4;
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const raf = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWaves(ctx, width, height, lanes, history, shown, cursor, colors);
    });
    return () => cancelAnimationFrame(raf);
  }, [width, height, lanes, history, shown, cursor, colors]);

  // Pointer: hover scrubs, drag pans, wheel zooms (Shift or horizontal wheel pans).
  const drag = useRef<{ x: number; start: number } | null>(null);
  const sampleAt = (clientX: number): number => {
    const r = canvasRef.current!.getBoundingClientRect();
    return Math.floor(shown.start + ((clientX - r.left) / r.width) * shown.span);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: shown.start };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drag.current && e.buttons) {
      const r = e.currentTarget.getBoundingClientRect();
      const dSamples = ((drag.current.x - e.clientX) / r.width) * shown.span;
      setView(panView({ ...shown, start: drag.current.start }, dSamples, count));
      return;
    }
    const i = sampleAt(e.clientX);
    setCursor(i >= 0 && i < count ? i : null);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const anchor = (e.clientX - r.left) / r.width;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = (e.shiftKey ? e.deltaY : e.deltaX) / r.width;
        setView((v) => panView(clampView(v, count), d * v.span, count));
      } else setView((v) => zoomView(clampView(v, count), Math.exp(e.deltaY * 0.002), anchor, count));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [count]);

  /** Move the keyboard cursor, scrolling the view to keep it visible. */
  const moveCursor = (i: number) => {
    setCursor(i);
    if (i < shown.start || i >= shown.start + shown.span) setView({ ...shown, start: i - shown.span / 2, follow: false });
  };
  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const last = count - 1;
    const cur = cursor ?? last;
    const step = e.shiftKey ? 10 : 1;
    let handled = true;
    if (count === 0) handled = false;
    else if (e.key === 'ArrowLeft') moveCursor(Math.max(0, cur - step));
    else if (e.key === 'ArrowRight') moveCursor(Math.min(last, cur + step));
    else if (e.key === 'Home') moveCursor(0);
    else if (e.key === 'End') moveCursor(last);
    else if (e.key === '+' || e.key === '=') setView((v) => zoomView(clampView(v, count), 0.8, 0.5, count));
    else if (e.key === '-') setView((v) => zoomView(clampView(v, count), 1.25, 0.5, count));
    else if (e.key === 'Escape') setCursor(null);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const sel = selectedWire(board, selection);
  const at = cursor ?? count - 1;
  const atTick = history.ticks[at];

  return (
    <div className="dk-wave">
      <div className="dk-toolbar" role="toolbar" aria-label={t('panels.wave.tools')}>
        <button
          type="button"
          className="dk-btn"
          disabled={!sel || pinned.includes(sel)}
          onClick={() => sel && pin(sel)}
          title={`${t('panels.wave.pin')} — Shift+W`}
        >
          {t('panels.wave.pin')}
          <kbd>⇧W</kbd>
        </button>
        <span className="dk-spacer" />
        <span className="dk-readout" aria-live="off">
          {atTick !== undefined ? t('panels.wave.atTick', { tick: atTick }) : t('panels.wave.noData')}
        </span>
        <button
          type="button"
          className={`dk-btn ${shown.follow ? 'is-active' : ''}`}
          aria-pressed={shown.follow}
          onClick={() => setView({ ...shown, follow: !shown.follow })}
          title={t('panels.wave.followHelp')}
        >
          {t('panels.wave.follow')}
        </button>
        <button type="button" className="dk-btn icon" aria-label={t('panels.wave.zoomOut')} title={t('panels.wave.zoomOut')} onClick={() => setView(zoomView(shown, 1.5, 0.5, count))}>
          −
        </button>
        <button type="button" className="dk-btn icon" aria-label={t('panels.wave.zoomIn')} title={t('panels.wave.zoomIn')} onClick={() => setView(zoomView(shown, 1 / 1.5, 0.5, count))}>
          +
        </button>
        <button type="button" className="dk-btn" disabled={!pinned.length} onClick={() => setPinned([])}>
          {t('panels.wave.clear')}
        </button>
      </div>
      {lanes.length === 0 ? (
        <p className="dk-empty">{t('panels.wave.empty')}</p>
      ) : (
        <div className="dk-wave-body">
          <ul className="dk-lanes" style={{ paddingTop: RULER_H }} aria-label={t('panels.wave.lanes')}>
            {lanes.map((l, i) => (
              <li key={l.id} className={`dk-lane ${l.clock ? 'is-clock' : ''}`} style={{ height: LANE_H }}>
                <span className="dk-lane-name" title={l.label}>
                  {l.label}
                </span>
                <span className="dk-lane-value">{formatValue(history.values[l.id]?.[at])}</span>
                {!l.clock && (
                  <span className="dk-lane-actions">
                    <button type="button" className="dk-mini" aria-label={t('panels.wave.up')} title={t('panels.wave.up')} disabled={i <= (clockWire ? 1 : 0)} onClick={() => movePin(l.id, -1)}>
                      ↑
                    </button>
                    <button type="button" className="dk-mini" aria-label={t('panels.wave.down')} title={t('panels.wave.down')} disabled={i === lanes.length - 1} onClick={() => movePin(l.id, 1)}>
                      ↓
                    </button>
                    <button type="button" className="dk-mini" aria-label={t('panels.wave.unpin')} title={t('panels.wave.unpin')} onClick={() => unpin(l.id)}>
                      ×
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="dk-wave-plot" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              style={{ width, height }}
              tabIndex={0}
              role="img"
              aria-label={t('panels.wave.plot', { n: lanes.length, ticks: count })}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKey}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Shift+W pins the selected wire to the waveform (and opens the tab). */
export function useWaveformShortcut(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code !== 'KeyW' && e.key !== 'W') return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      const { board, selection } = useEditor.getState();
      const id = selectedWire(board, selection);
      if (!id) return;
      e.preventDefault();
      useDock.getState().pin(id);
      useDock.getState().setTab('waveform');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
