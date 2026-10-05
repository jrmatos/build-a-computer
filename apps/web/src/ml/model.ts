/**
 * Pure helpers for the Track 2 workspace: what Run and Train call, how results
 * print, and how training samples become chart series. No DOM, no store.
 */
import type { Level, TestSpec } from '@build-a-computer/schema';
import type { MlSample } from '@build-a-computer/worker';

type JsTest = Extract<TestSpec, { kind: 'js' }>;

/** One function call the workspace can make: `entry(...args)`. */
export interface CallTarget {
  entry: string;
  args: unknown[];
}

const jsTests = (level: Level | null | undefined): JsTest[] => (level?.tests ?? []).filter((t): t is JsTest => t.kind === 'js');

/** Calls offered by Run: each distinct entry+args among the level's tests, in test order (the first is the default). */
export function runTargets(level: Level | null | undefined): CallTarget[] {
  const seen = new Set<string>();
  const out: CallTarget[] = [];
  for (const t of jsTests(level)) {
    const key = `${t.entry}:${JSON.stringify(t.args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ entry: t.entry, args: t.args });
  }
  return out;
}

/**
 * The call Train makes: the first test that checks a metric (training tests),
 * else a test whose entry is `train`, else `train()`.
 */
export function trainTarget(level: Level | null | undefined): CallTarget {
  const tests = jsTests(level);
  const t = tests.find((x) => x.metric) ?? tests.find((x) => x.entry === 'train');
  return t ? { entry: t.entry, args: t.args } : { entry: 'train', args: [] };
}

/** `train(400, 1)` — how a call reads in buttons and menus. */
export function callLabel(c: CallTarget): string {
  const args = c.args.map((a) => compactJson(a, 24)).join(', ');
  return `${c.entry}(${args})`;
}

function compactJson(v: unknown, max: number): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  s = s.replace(/,/g, ', ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---------------------------------------------------------------- values

/** A tensor as the sandbox sends it (JSON-safe): shape plus flat row-major data. */
export interface TensorJson {
  shape: number[];
  data: number[];
}

/** True for `{shape, data}` whose data length matches the shape. */
export function isTensor(v: unknown): v is TensorJson {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.shape) || !Array.isArray(o.data)) return false;
  if (!o.shape.every((d) => Number.isInteger(d) && (d as number) >= 0)) return false;
  const size = (o.shape as number[]).reduce((a, b) => a * b, 1);
  return size === o.data.length && o.data.every((x) => typeof x === 'number' || x === null);
}

/** A number for display: integers as is, others to 6 significant digits; NaN and infinities by name. */
export function formatNumber(x: number | null): string {
  if (x === null) return 'NaN';
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-4 || a >= 1e9)) return x.toExponential(4).replace(/\.?0+e/, 'e');
  return String(Number(x.toPrecision(6)));
}

const MAX_ITEMS = 8;

/** Nested rows of a tensor, eliding the middle of long axes: [[1, 2, 3], [4, 5, 6]]. */
function tensorBody(t: TensorJson): string {
  const { shape, data } = t;
  if (shape.length === 0) return formatNumber(data[0] ?? null);
  const strides = shape.map((_, i) => shape.slice(i + 1).reduce((a, b) => a * b, 1));
  const cells = data.map((x) => formatNumber(x));
  const width = Math.min(12, Math.max(...cells.map((c) => c.length), 1));
  const rec = (dim: number, offset: number, indent: string): string => {
    const n = shape[dim]!;
    const idx = n > MAX_ITEMS ? [0, 1, 2, -1, n - 3, n - 2, n - 1] : Array.from({ length: n }, (_, i) => i);
    if (dim === shape.length - 1) {
      const parts = idx.map((i) => (i < 0 ? '…' : cells[offset + i]!.padStart(width)));
      return `[${parts.join(', ')}]`;
    }
    const sep = `,${'\n'.repeat(shape.length - dim - 1)}${indent} `;
    const parts = idx.map((i) => (i < 0 ? '…' : rec(dim + 1, offset + i * strides[dim]!, `${indent} `)));
    return `[${parts.join(sep)}]`;
  };
  return rec(0, 0, '');
}

/** Pretty-print a returned value: tensors with their shape, numbers rounded, objects as indented JSON. */
export function formatValue(v: unknown, depth = 0): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (isTensor(v)) return `Tensor shape [${v.shape.join(', ')}]\n${tensorBody(v)}`;
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const flat = v.every((x) => typeof x === 'number' || x === null);
    const shown = v.length > 50 ? [...v.slice(0, 50)] : v;
    const more = v.length > 50 ? `… ${v.length - 50} more` : '';
    if (flat) return `[${[...shown.map((x) => formatNumber(x as number | null)), ...(more ? [more] : [])].join(', ')}]`;
    return `[\n${[...shown.map((x) => pad + formatValue(x, depth + 1)), ...(more ? [pad + more] : [])].join(',\n')}\n${end}]`;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${formatValue(x, depth + 1)}`).join(',\n')}\n${end}}`;
  }
  return String(v);
}

// ---------------------------------------------------------------- training samples

/** Sample keys that are bookkeeping, not curves. */
const NOT_SERIES = new Set(['step', 'total', 'steps', 'epoch']);

/** Curve keys in first-seen order (so a series keeps its color as others appear). */
export function seriesKeys(samples: readonly MlSample[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of samples) {
    for (const k of Object.keys(s.values)) {
      if (seen.has(k) || NOT_SERIES.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Loss-like keys share the loss chart (and its log scale); everything else goes to the metrics chart. */
export const isLossKey = (k: string): boolean => /loss|perplexity|ppl|nll|mse|error/i.test(k);

/** Split keys into the loss chart and the metrics chart (one y-scale each, never two axes on one chart). */
export function splitSeries(keys: readonly string[]): { loss: string[]; metrics: string[] } {
  return { loss: keys.filter(isLossKey), metrics: keys.filter((k) => !isLossKey(k)) };
}

/** The first non-finite loss-like value (E-ML-03), or null. */
export function firstNonFinite(samples: readonly MlSample[]): { step: number; key: string; value: number } | null {
  for (const s of samples) {
    for (const [k, v] of Object.entries(s.values)) {
      if (NOT_SERIES.has(k)) continue;
      // JSON turns NaN into null on the way from the worker.
      const x = v as number | null;
      if ((x === null || !Number.isFinite(x)) && isLossKey(k)) return { step: s.step, key: k, value: x === null ? NaN : x };
    }
  }
  return null;
}

/** Last step and, when the code reports `total` (or `steps`), the planned number of steps. */
export function progressOf(samples: readonly MlSample[]): { step: number; total: number | null } {
  const last = samples[samples.length - 1];
  if (!last) return { step: 0, total: null };
  const total = last.values.total ?? last.values.steps;
  return { step: last.step, total: typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : null };
}

/** Keep at most `max` samples, evenly strided, always keeping the last one. */
export function downsample<T>(samples: readonly T[], max: number): T[] {
  if (samples.length <= max) return samples.slice();
  const out: T[] = [];
  const stride = samples.length / (max - 1);
  for (let i = 0; i < max - 1; i++) out.push(samples[Math.floor(i * stride)]!);
  out.push(samples[samples.length - 1]!);
  return out;
}

/** Samples from a resumed checkpoint followed by the live run's samples after it. */
export function mergeSamples(prefix: readonly MlSample[], live: readonly MlSample[]): MlSample[] {
  if (!prefix.length) return live.slice();
  const last = prefix[prefix.length - 1]!.step;
  return [...prefix, ...live.filter((s) => s.step > last)];
}

// ---------------------------------------------------------------- axes

/** About `count` round tick values covering [min, max] (1, 2, 5 × 10^k steps). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Powers of ten covering [min, max] (both > 0) for a log axis. */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > 0)) return [];
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) out.push(10 ** e);
  return out;
}

/** Short axis label: 1.2k, 0.05, 1e-4. */
export function tickLabel(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e6) return `${Number((v / 1e6).toPrecision(3))}M`;
  if (a >= 1e3) return `${Number((v / 1e3).toPrecision(3))}k`;
  if (a < 1e-3) return v.toExponential(0);
  return String(Number(v.toPrecision(3)));
}

// ---------------------------------------------------------------- checkpoints

/**
 * The checkpoint a run state carries, if the sandbox reports one (E-ML-06):
 * `checkpoint: { step, state }`. A bare state takes the last sample's step.
 */
export function checkpointOf(s: unknown): { step: number; state: unknown } | null {
  if (!s || typeof s !== 'object') return null;
  const cp = (s as { checkpoint?: unknown }).checkpoint;
  if (cp === undefined || cp === null) return null;
  const samples = (s as { samples?: MlSample[] }).samples ?? [];
  const lastStep = samples[samples.length - 1]?.step ?? 0;
  if (typeof cp === 'object' && 'state' in cp) {
    const c = cp as { step?: unknown; state: unknown };
    return { step: typeof c.step === 'number' && Number.isFinite(c.step) ? c.step : lastStep, state: c.state };
  }
  const step = typeof cp === 'object' && typeof (cp as { step?: unknown }).step === 'number' ? (cp as { step: number }).step : lastStep;
  return { step, state: cp };
}

/** "3 min ago" for a checkpoint time. */
export function ago(then: number, now: number): { key: string; n: number } {
  const min = Math.floor((now - then) / 60_000);
  if (min < 1) return { key: 'ml.train.justNow', n: 0 };
  if (min < 60) return { key: 'ml.train.minutesAgo', n: min };
  const h = Math.floor(min / 60);
  if (h < 48) return { key: 'ml.train.hoursAgo', n: h };
  return { key: 'ml.train.daysAgo', n: Math.floor(h / 24) };
}
