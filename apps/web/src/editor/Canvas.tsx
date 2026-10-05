import { useEffect, useRef, useState } from 'react';
import { NumberInputPopover, openNumberInput } from '../ui/NumberInputPopover';
import { Probe, type ProbeState } from '../ui/Probe';
import { PartType } from '@ground-up/schema';
import { t } from '../i18n';
import { sim } from '../sim/client';
import { setPartLabel } from './actions';
import { viewport, worldToScreen, zoomBy } from './camera';
import { partRect } from './geometry';
import { Interaction, type PointerInput, type ProbeTarget } from './interaction';
import { placeChip } from './chips';
import { canPlaceChip } from './partProps';
import { createRenderer } from './renderer';
import { installShortcuts } from './shortcuts';
import { useEditor } from './store';
import { isPartAllowed } from './tools';
import './Canvas.css';

/** MIME type the library sidebar uses when dragging a part onto the board. */
const PART_MIME = 'application/x-ground-up-part';
/** With part type 'chip': the ChipDef id being dragged. */
const CHIP_MIME = 'application/x-ground-up-chip';
/** Hover time before a wire probe appears (plan: Probe). Alt+hover on a pin shows at once. */
const PROBE_DELAY_MS = 300;

const probeKey = (p: ProbeTarget | undefined | null): string =>
  !p ? '' : p.kind === 'wire' ? `w:${p.id}` : `p:${p.ref.part}:${p.ref.pin}`;

// The canvas fills the window; seed the viewport before boot code calls zoomToFit,
// which runs before the first ResizeObserver callback.
if (typeof window !== 'undefined') {
  viewport.width = window.innerWidth || 1;
  viewport.height = window.innerHeight || 1;
}

/**
 * The full-window board. Draws through the Renderer and turns pointer,
 * wheel, touch and keyboard input into editor actions.
 */
export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState<ProbeState | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = createRenderer(canvas);
    const ctrl = new Interaction({
      toggleSwitch: (id) => void sim.toggleSwitch(id),
      press: (id, down) => void sim.press(id, down),
      openNumberInput,
    });
    let rect = canvas.getBoundingClientRect();
    let raf = 0;
    let selArr: string[] | null = null;
    let selSet: ReadonlySet<string> = new Set();

    const frame = (time: number) => {
      raf = 0;
      const s = useEditor.getState();
      if (s.selection !== selArr) {
        selArr = s.selection;
        selSet = new Set(selArr);
      }
      renderer.draw({
        board: s.board,
        index: ctrl.index(s.board),
        camera: s.camera,
        theme: s.theme,
        showGrid: s.showGrid,
        selection: selSet,
        snapshot: s.snapshot,
        // Diagnostics panel flashes parts through the store; interaction owns the rest.
        overlay: s.flashIds?.length ? { ...ctrl.overlay, flashIds: s.flashIds } : ctrl.overlay,
        width: viewport.width,
        height: viewport.height,
        time,
      });
      if (renderer.animating) request();
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    // Probe: show after the pointer rests on the same wire (or Alt+pin) for a moment.
    let probeShown = '';
    let probeTimer = 0;
    let pendingKey = '';
    const syncProbe = () => {
      const p = ctrl.probe;
      const key = probeKey(p?.target);
      if (key === probeShown || (probeTimer && key === pendingKey)) return;
      window.clearTimeout(probeTimer);
      probeTimer = 0;
      if (probeShown) {
        probeShown = '';
        setProbe(null);
      }
      pendingKey = key;
      if (!p) return;
      probeTimer = window.setTimeout(
        () => {
          probeTimer = 0;
          const now = ctrl.probe;
          if (!now || probeKey(now.target) !== key) return;
          probeShown = key;
          setProbe({ target: now.target, x: now.x + rect.left, y: now.y + rect.top });
        },
        p.target.kind === 'pin' ? 0 : PROBE_DELAY_MS,
      );
    };
    ctrl.onChange = () => {
      canvas.style.cursor = ctrl.cursor;
      syncProbe();
      request();
    };
    const onAltKey = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      // Keep Alt from focusing the browser menu bar while probing.
      if (e.type === 'keyup' && ctrl.probe?.target.kind === 'pin') e.preventDefault();
      ctrl.setAlt(e.type === 'keydown');
    };
    const onWinBlur = () => ctrl.setAlt(false);
    window.addEventListener('keydown', onAltKey);
    window.addEventListener('keyup', onAltKey);
    window.addEventListener('blur', onWinBlur);

    const resize = () => {
      rect = canvas.getBoundingClientRect();
      viewport.width = Math.max(1, rect.width);
      viewport.height = Math.max(1, rect.height);
      renderer.resize(viewport.width, viewport.height, window.devicePixelRatio || 1);
      request();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // Moving between screens changes the pixel ratio without resizing the element.
    let dprQuery: MediaQueryList | null = null;
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', onDpr);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    };
    const onDpr = () => {
      resize();
      watchDpr();
    };
    watchDpr();
    resize();

    let lastBoard = useEditor.getState().board;
    let lastTool = useEditor.getState().tool;
    const unsub = useEditor.subscribe((s) => {
      // Board or tool changed elsewhere (undo, toolbar): refresh hover and ghost.
      if (s.board !== lastBoard || s.tool !== lastTool) {
        lastBoard = s.board;
        lastTool = s.tool;
        if (!ctrl.busy) ctrl.update();
      }
      request();
    });

    const input = (e: PointerEvent): PointerInput => ({
      id: e.pointerId,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      button: e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.ctrlKey || e.metaKey,
      pointerType: e.pointerType,
    });

    const onDown = (e: PointerEvent) => {
      // Clicking the board takes focus from fields and buttons, so keys reach the editor.
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) active.blur();
      if (e.button !== 2) {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* pointer already gone */
        }
      }
      if (e.button === 1) e.preventDefault(); // no autoscroll
      ctrl.down(input(e));
    };
    const onMove = (e: PointerEvent) => {
      if (e.altKey !== ctrl.altHeld) ctrl.altHeld = e.altKey;
      const events = e.getCoalescedEvents?.() ?? [];
      const last = events.length ? events[events.length - 1]! : e;
      ctrl.move({ ...input(e), x: last.clientX - rect.left, y: last.clientY - rect.top });
    };
    const onUp = (e: PointerEvent) => ctrl.up(input(e));
    const onCancel = (e: PointerEvent) => {
      ctrl.up(input(e));
    };
    const onLeave = () => ctrl.leave();
    const onDblClick = (e: MouseEvent) => ctrl.doubleClick(e.clientX - rect.left, e.clientY - rect.top);
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      ctrl.contextMenu(e.clientX - rect.left, e.clientY - rect.top, e.clientX, e.clientY);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      ctrl.wheel(
        {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          mod: e.ctrlKey || e.metaKey,
          shift: e.shiftKey,
        },
        viewport.height,
      );
    };

    // Safari reports trackpad pinch as gesture events instead of ctrl+wheel.
    let gestureScale = 1;
    type Gesture = UIEvent & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = (e as Gesture).scale || 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Gesture;
      if (!g.scale) return;
      zoomBy(g.scale / gestureScale, g.clientX - rect.left, g.clientY - rect.top);
      gestureScale = g.scale;
    };

    const dragType = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes(PART_MIME);
    let dragGhost: PartType | null = null;
    const onDragEnter = (e: DragEvent) => {
      if (!dragType(e)) return;
      e.preventDefault();
    };
    const onDragOver = (e: DragEvent) => {
      if (!dragType(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = useEditor.getState().readOnly ? 'none' : 'copy';
      // Data is unreadable during dragover; show the ghost once a drop names the part,
      // or when the sidebar stashed the type in the drag type list.
      const typed = e.dataTransfer?.types.find((x) => x.startsWith(`${PART_MIME}+`));
      const parsed = typed ? PartType.safeParse(typed.slice(PART_MIME.length + 1)) : null;
      dragGhost = parsed?.success ? parsed.data : null;
      ctrl.dragOver(dragGhost, e.clientX - rect.left, e.clientY - rect.top);
    };
    const onDragLeave = () => ctrl.dragOver(null, 0, 0);
    const onDrop = (e: DragEvent) => {
      if (!dragType(e)) return;
      e.preventDefault();
      ctrl.dragOver(null, e.clientX - rect.left, e.clientY - rect.top);
      const parsed = PartType.safeParse(e.dataTransfer?.getData(PART_MIME));
      if (!parsed.success) return;
      const st = useEditor.getState();
      if (parsed.data === 'chip') {
        // Handled here; keep the chips library's document-level drop from placing it twice.
        e.stopPropagation();
        const chipId = e.dataTransfer?.getData(CHIP_MIME) ?? '';
        if (st.readOnly || !st.chips[chipId]) return;
        if (!canPlaceChip(st.chips, chipId, st.editStack.map((f) => f.chipId))) {
          st.toast(t('canvas.chipRecursive', { chip: st.chips[chipId]!.name }), 'error');
          return;
        }
        if (placeChip(chipId, ctrl.lastWorld) && !st.toolLocked) st.setTool('select');
        return;
      }
      if (!isPartAllowed(st.level, parsed.data)) {
        st.toast(t('canvas.notAllowed', { part: t(`part.${parsed.data}`) }), 'error');
        return;
      }
      ctrl.place(parsed.data, ctrl.lastWorld);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    canvas.addEventListener('dragenter', onDragEnter);
    canvas.addEventListener('dragover', onDragOver);
    canvas.addEventListener('dragleave', onDragLeave);
    canvas.addEventListener('drop', onDrop);
    const removeShortcuts = installShortcuts(ctrl);
    ctrl.update();
    request();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(probeTimer);
      window.removeEventListener('keydown', onAltKey);
      window.removeEventListener('keyup', onAltKey);
      window.removeEventListener('blur', onWinBlur);
      ro.disconnect();
      dprQuery?.removeEventListener('change', onDpr);
      unsub();
      removeShortcuts();
      ctrl.cancel();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
      canvas.removeEventListener('dragenter', onDragEnter);
      canvas.removeEventListener('dragover', onDragOver);
      canvas.removeEventListener('dragleave', onDragLeave);
      canvas.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <>
      <canvas ref={ref} className="board-canvas" aria-label={t('canvas.aria')} role="application" tabIndex={-1} />
      <LabelEditor />
      <Probe probe={probe} />
      <NumberInputPopover />
    </>
  );
}

/** Inline label field over the part being renamed (double-click a part). */
function LabelEditor() {
  const id = useEditor((s) => s.editingLabel);
  const exists = useEditor((s) => (s.editingLabel ? s.board.parts.some((p) => p.id === s.editingLabel) : false));

  useEffect(() => {
    // The part was deleted (or undone away) while editing.
    if (id && !exists) useEditor.getState().set({ editingLabel: null });
  }, [id, exists]);

  // Keyed by part id, so each edit starts fresh from that part's label.
  return id && exists ? <LabelField key={id} id={id} /> : null;
}

function LabelField({ id }: { id: string }) {
  const part = useEditor((s) => s.board.parts.find((p) => p.id === id));
  const camera = useEditor((s) => s.camera);
  const [value, setValue] = useState(() => part?.label ?? '');
  const done = useRef(false);

  if (!part) return null;
  const r = partRect(part);
  const a = worldToScreen(camera, r.x, r.y);
  const b = worldToScreen(camera, r.x + r.w, r.y + r.h);
  const width = Math.max(120, b.x - a.x);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) setPartLabel(id, value);
    useEditor.getState().set({ editingLabel: null });
  };

  return (
    <input
      className="label-editor"
      autoFocus
      value={value}
      maxLength={40}
      placeholder={t('canvas.labelPlaceholder')}
      aria-label={t('canvas.labelAria')}
      style={{ left: (a.x + b.x) / 2 - width / 2, top: (a.y + b.y) / 2 - 16, width }}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
    />
  );
}
