/**
 * EDIT-01 benchmark: draws a synthetic board (2,000 parts by default) with a
 * moving camera and reports renderer frame time and fps.
 *
 * Query parameters: n (part count), theme (dark|light), zoom (fixed zoom,
 * default fits the whole board), still (no camera motion), nosnap (no
 * simulation values), diag (contention rings), flush (read back a pixel each
 * frame so draw time includes GPU raster), sel (select a few parts), only
 * (parts|wires: draw a single layer), dpr (force a device pixel ratio),
 * ov (show every overlay kind), cx / cy (camera center in cells),
 * board (gates: the classic 1-bit board; mixed: CPU-ish clusters of blocks,
 * custom chips, buses and splitters; show: one of every part, for review).
 */
import '../styles/tokens.css';
import { SpatialIndex } from '../editor/hit';
import { geomOf, setChipRegistry } from '../editor/parts';
import { createRenderer } from '../editor/renderer';
import type { Scene } from '../editor/render-types';
import { GRID, type Theme } from '../editor/store';
import type { Board } from '@build-a-computer/schema';
import type { Snapshot } from '@build-a-computer/worker';
import { BENCH_CHIPS, benchBoard, benchSnapshot, mixedBoard, mixedSnapshot, PITCH_X, PITCH_Y } from './board';
import { showcaseBoard, showcaseSnapshot } from './showcase';
import './bench.css';

const q = new URLSearchParams(location.search);
const count = Number(q.get('n') ?? 2000);
let theme: Theme = q.get('theme') === 'light' ? 'light' : 'dark';
const kind = q.get('board') ?? 'gates';
let moving = !q.has('still') && kind !== 'show';
let simulate = !q.has('nosnap');
const diag = q.has('diag');
const flush = q.has('flush');
const fixedZoom = q.has('zoom') ? Number(q.get('zoom')) : undefined;

if (kind !== 'gates') setChipRegistry(BENCH_CHIPS);
let board: Board;
let cols: number;
let rows: number;
let worldW: number;
let worldH: number;
if (kind === 'mixed') {
  const m = mixedBoard(count);
  ({ board, cols, rows } = m);
  worldW = m.w;
  worldH = m.h;
} else if (kind === 'show') {
  board = showcaseBoard();
  cols = rows = 1;
  worldW = 50;
  worldH = 50;
} else {
  ({ board, cols, rows } = benchBoard(count));
  worldW = cols * PITCH_X;
  worldH = rows * PITCH_Y;
}
const index = new SpatialIndex(board);
const pinWidth = (ref: { part: string; pin: string }): number => {
  const p = index.parts.get(ref.part);
  return p ? (geomOf(p).pins.find((x) => x.name === ref.pin)?.width ?? 1) : 1;
};
const makeSnapshot = (seed: number): Snapshot =>
  kind === 'mixed' ? mixedSnapshot(board, seed, pinWidth) : kind === 'show' ? showcaseSnapshot(board) : benchSnapshot(board, seed, diag);
// Diagnostic: ?only=parts or ?only=wires draws one layer, to tell which one costs.
if (q.get('only') === 'parts') index.paths.clear();
if (q.get('only') === 'wires') index.partsIn = () => [];

const canvas = document.getElementById('board') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const renderer = createRenderer(canvas);

let width = 0;
let height = 0;
function resize(): void {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  renderer.resize(width, height, Number(q.get('dpr')) || window.devicePixelRatio || 1);
}
resize();
window.addEventListener('resize', resize);

const selection = new Set<string>();
const mid = (dr: number, dc: number): string => `p${Math.floor(rows / 2) + dr}_${Math.floor(cols / 2) + dc}`;
if (q.has('sel')) {
  for (const dc of [-3, -2]) selection.add(mid(0, dc));
  const w = board.wires.find((x) => x.to.part === mid(-1, 1));
  if (w) selection.add(w.id);
}
/** ?ov shows every overlay kind near the center, for visual review. */
const overlay: Scene['overlay'] = {};
if (q.has('ov')) {
  const cx = Math.floor(cols / 2) * PITCH_X;
  const cy = Math.floor(rows / 2) * PITCH_Y;
  overlay.hoverId = mid(1, 0);
  overlay.flashIds = [mid(1, 2)];
  overlay.box = { x: cx + 3.5, y: cy - 4.8, w: 7, h: 3.4 };
  overlay.hoverPin = { x: cx - 2 * PITCH_X + 3, y: cy + PITCH_Y + 1 };
  overlay.wirePreview = [
    { x: cx - 2 * PITCH_X + 3, y: cy + PITCH_Y + 1 },
    { x: cx - 2 * PITCH_X + 4, y: cy + PITCH_Y + 1 },
    { x: cx - 2 * PITCH_X + 4, y: cy + PITCH_Y + 3 },
  ];
  overlay.ghost = { type: 'xor', x: cx + PITCH_X * 2 + 0, y: cy + PITCH_Y * 2 + 2 };
}

let snapSeed = 1;
let snapshot = simulate ? makeSnapshot(snapSeed) : null;
setInterval(() => {
  if (!simulate) return;
  snapshot = makeSnapshot(++snapSeed);
}, 500);

const drawTimes: number[] = [];
const intervals: number[] = [];
let last = 0;
let visible = 0;
let t0 = performance.now();

function camera(t: number): Scene['camera'] {
  const margin = kind === 'show' ? 1 : 2;
  const fit = Math.min(width / ((worldW + margin * 2) * GRID), height / ((worldH + margin * 2) * GRID));
  const zoom = (fixedZoom ?? fit) * (moving && fixedZoom === undefined ? 1 + 0.04 * Math.sin(t / 1300) : 1);
  const s = zoom * GRID;
  const cx = (q.has('cx') ? Number(q.get('cx')) : worldW / 2) + (moving ? Math.sin(t / 1700) * (fixedZoom ? worldW / 3 : 3) : 0);
  const cy = (q.has('cy') ? Number(q.get('cy')) : worldH / 2) + (moving ? Math.cos(t / 2100) * (fixedZoom ? worldH / 3 : 2) : 0);
  return { zoom, x: cx - width / 2 / s, y: cy - height / 2 / s };
}

function frame(now: number): void {
  if (last) intervals.push(now - last);
  last = now;
  const cam = camera(now - t0);
  const scene: Scene = {
    board,
    index,
    camera: cam,
    theme,
    showGrid: true,
    selection,
    snapshot,
    overlay,
    width,
    height,
    time: now,
  };
  const start = performance.now();
  renderer.draw(scene);
  if (flush) canvas.getContext('2d')!.getImageData(0, 0, 1, 1);
  drawTimes.push(performance.now() - start);
  if (drawTimes.length > 240) drawTimes.shift();
  if (intervals.length > 240) intervals.shift();
  const s = cam.zoom * GRID;
  visible = index.partsIn({ x: cam.x, y: cam.y, w: width / s, h: height / s }).length;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export interface BenchStats {
  parts: number;
  wires: number;
  visible: number;
  drawMean: number;
  drawP95: number;
  fps: number;
  frames: number;
}

function stats(): BenchStats {
  const sorted = [...drawTimes].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  const iv = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
  return {
    parts: board.parts.length,
    wires: board.wires.length,
    visible,
    drawMean: mean,
    drawP95: p95,
    fps: iv ? 1000 / iv : 0,
    frames: drawTimes.length,
  };
}
(window as unknown as { __bench: () => BenchStats }).__bench = stats;

function render(): void {
  const st = stats();
  const ok = st.drawP95 <= 16;
  hud.innerHTML = `
    <div class="title">Renderer bench <span class="tag">EDIT-01</span></div>
    <dl>
      <dt>Parts / wires</dt><dd>${st.parts.toLocaleString()} / ${st.wires.toLocaleString()}</dd>
      <dt>Visible parts</dt><dd>${st.visible.toLocaleString()}</dd>
      <dt>Draw mean</dt><dd>${st.drawMean.toFixed(2)} ms</dd>
      <dt>Draw p95</dt><dd class="${ok ? 'ok' : 'bad'}">${st.drawP95.toFixed(2)} ms</dd>
      <dt>Frame rate</dt><dd>${st.fps.toFixed(1)} fps</dd>
    </dl>
    <div class="verdict ${ok ? 'ok' : 'bad'}">${ok ? 'Within' : 'Over'} the 16 ms budget${flush ? ' (incl. GPU flush)' : ''}</div>
    <div class="row">
      <button data-act="theme">${theme === 'dark' ? 'Light' : 'Dark'} theme</button>
      <button data-act="move">${moving ? 'Stop' : 'Move'} camera</button>
      <button data-act="sim">${simulate ? 'No values' : 'Simulate'}</button>
    </div>`;
}
hud.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).dataset.act;
  if (act === 'theme') {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
  } else if (act === 'move') {
    moving = !moving;
    t0 = performance.now();
  } else if (act === 'sim') {
    simulate = !simulate;
    snapshot = simulate ? makeSnapshot(snapSeed) : null;
  }
  render();
});
document.documentElement.dataset.theme = theme;
if (q.has('nohud')) hud.hidden = true;
setInterval(render, 500);
render();
