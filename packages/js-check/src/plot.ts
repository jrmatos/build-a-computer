/**
 * The 'plot' module for Track 2 levels: helpers that make report() output
 * easy to read on the training panel's chart.
 */

/** Exponential moving average: returns a function that smooths each value it is given. */
export function ema(alpha = 0.1): (x: number) => number {
  let s: number | null = null;
  return (x: number) => {
    s = s === null ? x : s + alpha * (x - s);
    return s;
  };
}

/** Wraps `fn` so it only runs every `n`-th call (and on the first). */
export function every<A extends unknown[]>(n: number, fn: (...args: A) => void): (...args: A) => void {
  let calls = 0;
  return (...args: A) => {
    if (calls++ % Math.max(1, Math.floor(n)) === 0) fn(...args);
  };
}

/** Mean of a list of numbers (NaN for an empty list). */
export function mean(values: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]!;
  return s / values.length;
}

/** Fraction of positions where `predicted[i] === labels[i]`. */
export function accuracy(predicted: ArrayLike<number>, labels: ArrayLike<number>): number {
  if (predicted.length !== labels.length) throw new RangeError(`accuracy: ${predicted.length} predictions for ${labels.length} labels.`);
  let ok = 0;
  for (let i = 0; i < labels.length; i++) if (predicted[i] === labels[i]) ok++;
  return labels.length ? ok / labels.length : 0;
}

/** Counts of `values` in `bins` equal-width bins between their min and max. */
export function histogram(values: ArrayLike<number>, bins = 10): { edges: number[]; counts: number[] } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    lo = Math.min(lo, values[i]!);
    hi = Math.max(hi, values[i]!);
  }
  if (!values.length) return { edges: [], counts: [] };
  const width = hi > lo ? (hi - lo) / bins : 1;
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i++) counts[Math.min(bins - 1, Math.floor((values[i]! - lo) / width))]!++;
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * width), counts };
}

const BARS = '▁▂▃▄▅▆▇█';

/** A one-line text chart of the values, for console.log. */
export function sparkline(values: ArrayLike<number>): string {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    lo = Math.min(lo, values[i]!);
    hi = Math.max(hi, values[i]!);
  }
  let s = '';
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    s += Number.isFinite(v) ? BARS[hi > lo ? Math.round(((v - lo) / (hi - lo)) * (BARS.length - 1)) : 0] : '!';
  }
  return s;
}

/** Formats rows of objects as an aligned text table, for console.log. */
export function table(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toPrecision(4)) : String(v ?? ''));
  const grid = [cols, ...rows.map((r) => cols.map((c) => cell(r[c])))];
  const widths = cols.map((_, i) => Math.max(...grid.map((g) => g[i]!.length)));
  return grid.map((g) => g.map((v, i) => v.padEnd(widths[i]!)).join('  ')).join('\n');
}
