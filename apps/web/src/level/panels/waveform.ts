import type { Board } from '@ground-up/schema';
import type { BusValue } from '@ground-up/worker';

/** Ticks kept by the worker; the waveform scrubs over at most this many. */
export const HISTORY_TICKS = 4096;

export interface History {
  ticks: number[];
  values: Record<string, BusValue[]>;
}

export const EMPTY_HISTORY: History = { ticks: [], values: {} };

/** A run of identical values in one lane, [from, to) in sample indexes. */
export interface Segment {
  from: number;
  to: number;
  value: BusValue;
}

export const sameValue = (a: BusValue, b: BusValue): boolean => a.v === b.v && a.x === b.x && a.w === b.w;

/** Collapse samples [start, end) into runs of equal values. */
export function segments(values: readonly BusValue[], start = 0, end = values.length): Segment[] {
  const out: Segment[] = [];
  const s = Math.max(0, Math.floor(start));
  const e = Math.min(values.length, Math.ceil(end));
  for (let i = s; i < e; i++) {
    const v = values[i]!;
    const last = out[out.length - 1];
    if (last && sameValue(last.value, v)) last.to = i + 1;
    else out.push({ from: i, to: i + 1, value: v });
  }
  return out;
}

/** Hex text of a bus value; unknown nibbles show as X. */
export function formatBus(b: BusValue): string {
  const digits = Math.max(1, Math.ceil(b.w / 4));
  let s = '';
  for (let i = digits - 1; i >= 0; i--) {
    const mask = 0xf << (i * 4);
    const nib = ((b.v & mask) >>> (i * 4)) & 0xf;
    s += (b.x & mask) !== 0 ? 'X' : nib.toString(16).toUpperCase();
  }
  return s;
}

/** Full text for the cursor readout: 1-bit as 0/1/X, buses as hex. */
export function formatValue(b: BusValue | undefined): string {
  if (!b) return '–';
  if (b.w <= 1) return b.x & 1 ? 'X' : String(b.v & 1);
  return `0x${formatBus(b)}`;
}

/** The wire driven by the first clock on the board: the waveform's top lane. */
export function findClockWire(board: Board): string | undefined {
  const clocks = new Set(board.parts.filter((p) => p.type === 'clock').map((p) => p.id));
  return board.wires.find((w) => clocks.has(w.from.part) || clocks.has(w.to.part))?.id;
}

/** Visible window over the sample indexes. `follow` keeps the newest sample at the right edge. */
export interface View {
  /** First visible sample (fractional). */
  start: number;
  /** Samples across the plot. */
  span: number;
  follow: boolean;
}

export const MIN_SPAN = 8;

export function clampView(v: View, count: number): View {
  const span = Math.max(MIN_SPAN, Math.min(HISTORY_TICKS, v.span));
  const maxStart = Math.max(0, count - span);
  const start = v.follow ? maxStart : Math.max(0, Math.min(maxStart, v.start));
  return { start, span, follow: v.follow };
}

/** Zoom by `factor` around the sample under `anchor` (0..1 across the plot). */
export function zoomView(v: View, factor: number, anchor: number, count: number): View {
  const span = Math.max(MIN_SPAN, Math.min(HISTORY_TICKS, v.span * factor));
  const at = v.start + v.span * anchor;
  return clampView({ start: at - span * anchor, span, follow: v.follow }, count);
}

export function panView(v: View, samples: number, count: number): View {
  const next = clampView({ ...v, start: v.start + samples, follow: false }, count);
  // Panning to the newest edge resumes following.
  return { ...next, follow: next.start >= Math.max(0, count - next.span) - 0.5 };
}

/** Lane of the waveform: a pinned wire, or the clock on top. */
export interface Lane {
  id: string;
  label: string;
  clock: boolean;
}

export interface WaveColors {
  text: string;
  muted: string;
  faint: string;
  grid: string;
  high: string;
  low: string;
  x: string;
  accent: string;
  bg: string;
}

export const LANE_H = 28;
export const RULER_H = 18;

/**
 * Draw the plot (no label column): a tick ruler, then one lane per wire.
 * 1-bit lanes are digital traces; buses are hex-labelled segments; X is hatched.
 */
export function drawWaves(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lanes: Lane[],
  history: History,
  view: View,
  cursor: number | null,
  c: WaveColors,
  scroll = 0,
): void {
  ctx.clearRect(0, 0, w, h);
  const count = history.ticks.length;
  const px = w / view.span;
  const xOf = (i: number) => (i - view.start) * px;
  const first = Math.max(0, Math.floor(view.start));
  const last = Math.min(count, Math.ceil(view.start + view.span) + 1);

  // Ruler: tick numbers at a readable stride.
  ctx.font = '10px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  const stride = niceStride(70 / px);
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  for (let i = Math.ceil(first / stride) * stride; i < last; i += stride) {
    const x = Math.round(xOf(i)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, RULER_H - 5);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillStyle = c.faint;
    ctx.fillText(String(history.ticks[i] ?? i), x + 3, RULER_H / 2);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_H, w, h - RULER_H);
  ctx.clip();
  lanes.forEach((lane, li) => {
    const top = RULER_H + li * LANE_H - scroll + 5;
    const bot = top + LANE_H - 10;
    if (bot < RULER_H || top > h) return;
    const vals = history.values[lane.id];
    if (!vals?.length) {
      ctx.fillStyle = c.faint;
      ctx.fillText('…', 6, (top + bot) / 2);
      return;
    }
    const segs = segments(vals, first, last);
    const oneBit = (vals[0]?.w ?? 1) <= 1;
    if (oneBit) drawDigital(ctx, segs, xOf, top, bot, lane.clock ? c.accent : c.high, c);
    else drawBus(ctx, segs, xOf, top, bot, w, c);
  });
  ctx.restore();

  if (cursor !== null && cursor >= first && cursor < last) {
    const x = Math.round(xOf(cursor + 0.5)) + 0.5;
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(xOf(cursor), RULER_H, px, h - RULER_H);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

export function niceStride(minSamples: number): number {
  const steps = [1, 2, 5];
  for (let p = 1; p < 1e6; p *= 10) for (const s of steps) if (s * p >= minSamples) return s * p;
  return 1e6;
}

function hatch(ctx: CanvasRenderingContext2D, x0: number, x1: number, top: number, bot: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, top, x1 - x0, bot - top);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(x0, top, x1 - x0, bot - top);
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const hgt = bot - top;
  for (let x = Math.floor(x0 / 6) * 6 - hgt; x < x1; x += 6) {
    ctx.moveTo(x, bot);
    ctx.lineTo(x + hgt, top);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDigital(
  ctx: CanvasRenderingContext2D,
  segs: Segment[],
  xOf: (i: number) => number,
  top: number,
  bot: number,
  high: string,
  c: WaveColors,
): void {
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  let prevY: number | null = null;
  for (const s of segs) {
    const x0 = xOf(s.from);
    const x1 = xOf(s.to);
    if (s.value.x & 1) {
      hatch(ctx, x0, x1, top, bot, c.x);
      prevY = null;
      continue;
    }
    const on = (s.value.v & 1) === 1;
    const y = on ? top : bot;
    if (on) {
      ctx.fillStyle = high;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x0, top, x1 - x0, bot - top);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = on ? high : c.low;
    ctx.beginPath();
    ctx.moveTo(x0, prevY ?? y);
    ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    prevY = y;
  }
}

function drawBus(
  ctx: CanvasRenderingContext2D,
  segs: Segment[],
  xOf: (i: number) => number,
  top: number,
  bot: number,
  w: number,
  c: WaveColors,
): void {
  const mid = (top + bot) / 2;
  ctx.lineWidth = 1.5;
  for (const s of segs) {
    const x0 = xOf(s.from);
    const x1 = xOf(s.to);
    const k = Math.min(4, (x1 - x0) / 2);
    const allX = s.value.x !== 0 && (s.value.x & mask(s.value.w)) === mask(s.value.w);
    if (allX) {
      hatch(ctx, x0 + k, x1 - k, top, bot, c.x);
      continue;
    }
    ctx.strokeStyle = s.value.x ? c.x : c.high;
    ctx.beginPath();
    ctx.moveTo(x0, mid);
    ctx.lineTo(x0 + k, top);
    ctx.lineTo(x1 - k, top);
    ctx.lineTo(x1, mid);
    ctx.lineTo(x1 - k, bot);
    ctx.lineTo(x0 + k, bot);
    ctx.closePath();
    ctx.stroke();
    const text = formatBus(s.value);
    const left = Math.max(x0 + k + 3, 3);
    const right = Math.min(x1 - k - 3, w - 3);
    const tw = ctx.measureText(text).width;
    if (right - left >= tw) {
      ctx.fillStyle = c.text;
      ctx.fillText(text, left, mid + 0.5);
    }
  }
}

const mask = (w: number): number => (w >= 32 ? 0xffffffff : 2 ** w - 1) | 0;
