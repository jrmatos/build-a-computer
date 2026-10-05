/**
 * Structured expected-vs-actual diff for Track 2 checks. `compareValues`
 * answers "does it match, and where is the first difference"; `diffValues`
 * keeps the whole picture for the debugger: a tree the UI can collapse, every
 * mismatching tensor index, and a flat list of readable mismatches such as
 * `result.weights[2]: expected 0.5 ± 1e-6, got 0.47`. Both use the same
 * matching rules (`closeEnough`, tensors as {shape, data}, extra keys ignored).
 */

import { closeEnough, NAN_MESSAGE } from './compare';

/** Most mismatching indices kept per tensor, and most mismatches listed. */
const MAX_BAD = 256;
const MAX_MISMATCHES = 50;
/** Most numbers kept per tensor in a diff (bigger tensors are cut; `truncated` says so). */
const MAX_DATA = 4096;

export type JsDiffNode =
  | { kind: 'number'; path: string; ok: boolean; expected: number; actual: unknown; tolerance: number }
  | {
      kind: 'tensor';
      path: string;
      ok: boolean;
      expectedShape: number[];
      /** null when the result is not numeric. */
      actualShape: number[] | null;
      /** Flat row-major values (cut at MAX_DATA). null entries are NaN/Infinity sent as null. */
      expected: number[];
      actual: (number | null)[] | null;
      /** Flat indices of mismatching values (at most MAX_BAD). */
      bad: number[];
      /** How many values mismatch in all. */
      badCount: number;
      tolerance: number;
      truncated?: boolean;
      message?: string;
    }
  | { kind: 'array'; path: string; ok: boolean; items: JsDiffNode[]; expectedLength: number; actualLength: number | null; message?: string }
  | { kind: 'object'; path: string; ok: boolean; entries: { key: string; node: JsDiffNode }[]; message?: string }
  | { kind: 'value'; path: string; ok: boolean; expected: unknown; actual: unknown; message?: string };

export interface JsMismatch {
  path: string;
  message: string;
}

/** What a 'js' test checked, with its actual values (case results and "Debug this test"). */
export interface JsCaseDetail {
  /** The `expect` diff tree (absent for metric-only tests). */
  diff?: JsDiffNode;
  /** Readable mismatches, first 50: "result.w[2]: expected 0.5 ± 1e-6, got 0.47". */
  mismatches: JsMismatch[];
  /** Metric tests: the value and its allowed range. */
  metric?: { name: string; value: number | null; min?: number; max?: number; ok: boolean };
  /** Path of the first NaN/Infinity in the result (tests with neither expect nor metric). */
  nonFinite?: string;
}

interface Shaped {
  shape: number[];
  data: (number | null)[];
}

const isShaped = (v: unknown): v is Shaped =>
  !!v && typeof v === 'object' && Array.isArray((v as Shaped).shape) && Array.isArray((v as Shaped).data);

const isNum = (v: unknown): v is number => typeof v === 'number';

/** Shape and flat data of a rectangular nested array of numbers (or a number); undefined otherwise. */
export function numericShape(v: unknown): Shaped | undefined {
  if (isNum(v)) return { shape: [], data: [v] };
  if (isShaped(v)) return v.data.every((x) => isNum(x) || x === null) ? v : undefined;
  if (!Array.isArray(v) || v.length === 0) return undefined;
  if (v.every(isNum)) return { shape: [v.length], data: v };
  const parts = v.map(numericShape);
  const first = parts[0];
  if (!first || first.shape.length === 0) return undefined;
  for (const p of parts) if (!p || p.shape.length !== first.shape.length || p.shape.some((d, i) => d !== first.shape[i])) return undefined;
  return { shape: [v.length, ...first.shape], data: parts.flatMap((p) => p!.data) };
}

/** Multi-index of a flat row-major index: 5 in [2, 3] → [1, 2]. */
export function unflatIndex(flat: number, shape: readonly number[]): number[] {
  const out: number[] = [];
  let rest = flat;
  for (let k = shape.length - 1; k >= 0; k--) {
    const d = shape[k]!;
    out.unshift(d > 0 ? rest % d : 0);
    rest = d > 0 ? Math.floor(rest / d) : 0;
  }
  return out;
}

/** Shows a number for messages: integers as is, others to 8 significant digits, NaN and infinities by name. */
export function showNumber(v: unknown): string {
  if (v === null) return 'NaN';
  if (typeof v !== 'number') return showAny(v);
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(8)));
}

function showAny(v: unknown): string {
  if (typeof v === 'number') return showNumber(v);
  if (v === undefined) return 'undefined';
  const s = JSON.stringify(v, (_k, x: unknown) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x));
  return s === undefined ? String(v) : s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

const shapeText = (s: readonly number[]): string => `[${s.join(', ')}]`;
/** "1e-6" rather than "0.000001". */
export const showTolerance = (t: number): string => (t > 0 && t < 1e-3 ? t.toExponential() : String(t));
const tol = (t: number): string => `± ${showTolerance(t)}`;

/**
 * Diff a sandbox result (JSON-safe; tensors as {shape, data}) with the
 * expected value. `ok` on the root is exactly `compareValues(...).ok`.
 */
export function diffValues(actual: unknown, expected: unknown, tolerance: number, path = 'result'): JsDiffNode {
  // Numbers and numeric arrays/tensors: compare as tensors when either side is a tensor or the expected value is a numeric array.
  const expShape = numericShape(expected);
  const actShaped = isShaped(actual);
  if (expShape && (isShaped(expected) || (Array.isArray(expected) && (actShaped || Array.isArray(actual))) || (actShaped && isNum(expected) && actual.data.length === 1))) {
    if (isNum(expected) && actShaped) return diffNumber(actual.data[0], expected, tolerance, path);
    return diffTensor(actual, expShape, tolerance, path, isShaped(expected));
  }
  if (isNum(expected)) {
    if (actShaped && actual.data.length === 1) return diffNumber(actual.data[0], expected, tolerance, path);
    return diffNumber(actual, expected, tolerance, path);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual))
      return { kind: 'array', path, ok: false, items: [], expectedLength: expected.length, actualLength: null, message: `expected an array of ${expected.length}, got ${showAny(actual)}` };
    const items = expected.map((e, i) => diffValues(actual[i], e, tolerance, `${path}[${i}]`));
    const sameLength = actual.length === expected.length;
    return {
      kind: 'array',
      path,
      ok: sameLength && items.every((n) => n.ok),
      items,
      expectedLength: expected.length,
      actualLength: actual.length,
      ...(sameLength ? {} : { message: `expected ${expected.length} items, got ${actual.length}` }),
    };
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual))
      return { kind: 'object', path, ok: false, entries: [], message: `expected an object, got ${showAny(actual)}` };
    const entries = Object.keys(expected).map((key) => {
      const p = `${path}.${key}`;
      const node: JsDiffNode = !(key in actual)
        ? { kind: 'value', path: p, ok: false, expected: (expected as Record<string, unknown>)[key], actual: undefined, message: `missing key '${key}'` }
        : diffValues((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], tolerance, p);
      return { key, node };
    });
    return { kind: 'object', path, ok: entries.every((e) => e.node.ok), entries };
  }
  const ok = actual === expected || (expected === null && actual === undefined);
  return { kind: 'value', path, ok, expected, actual, ...(ok ? {} : { message: `expected ${showAny(expected)}, got ${showAny(actual)}` }) };
}

function diffNumber(actual: unknown, expected: number, tolerance: number, path: string): JsDiffNode {
  return { kind: 'number', path, ok: isNum(actual) && closeEnough(actual, expected, tolerance), expected, actual, tolerance };
}

function diffTensor(actual: unknown, exp: Shaped, tolerance: number, path: string, expectedIsTensor: boolean): JsDiffNode {
  // An expected tensor needs a tensor result (compareValues does not accept nested arrays there).
  const act = isShaped(actual) ? actual : expectedIsTensor ? undefined : numericShape(actual);
  const expected = exp.data.slice(0, MAX_DATA) as number[];
  const truncated = exp.data.length > MAX_DATA || (act ? act.data.length > MAX_DATA : false);
  const base = { kind: 'tensor' as const, path, expectedShape: exp.shape, expected, tolerance, ...(truncated ? { truncated } : {}) };
  if (!act)
    return {
      ...base,
      ok: false,
      actualShape: null,
      actual: null,
      bad: [],
      badCount: exp.data.length,
      message: expectedIsTensor ? `expected a tensor of shape ${shapeText(exp.shape)}, got ${showAny(actual)}` : `expected an array of ${exp.shape[0] ?? 0}, got ${showAny(actual)}`,
    };
  const actualData = act.data.slice(0, MAX_DATA);
  if (act.shape.length !== exp.shape.length || act.shape.some((d, i) => d !== exp.shape[i]))
    return {
      ...base,
      ok: false,
      actualShape: act.shape,
      actual: actualData,
      bad: [],
      badCount: exp.data.length,
      message:
        !expectedIsTensor && !isShaped(actual) && exp.shape.length === 1 && act.shape.length === 1
          ? `expected ${exp.shape[0]} items, got ${act.shape[0]}`
          : `expected shape ${shapeText(exp.shape)}, got ${shapeText(act.shape)}`,
    };
  const bad: number[] = [];
  let badCount = 0;
  for (let i = 0; i < exp.data.length; i++) {
    const a = act.data[i];
    const e = exp.data[i];
    const match = isNum(a) && isNum(e) ? closeEnough(a, e, tolerance) : a === e;
    if (!match) {
      badCount++;
      if (bad.length < MAX_BAD) bad.push(i);
    }
  }
  return { ...base, ok: badCount === 0, actualShape: act.shape, actual: actualData, bad, badCount };
}

/** Readable mismatches of a diff tree, first `max`. */
export function listMismatches(node: JsDiffNode, max = MAX_MISMATCHES): JsMismatch[] {
  const out: JsMismatch[] = [];
  const add = (path: string, message: string): boolean => {
    out.push({ path, message: `${path}: ${message}` });
    return out.length < max;
  };
  const walk = (n: JsDiffNode): boolean => {
    if (n.ok) return true;
    switch (n.kind) {
      case 'number': {
        const got = n.actual;
        if (!isNum(got)) return add(n.path, `expected ${showNumber(n.expected)}, got ${showAny(got)}`);
        return add(n.path, `expected ${showNumber(n.expected)} ${tol(n.tolerance)}, got ${showNumber(got)}${Number.isFinite(got) ? '' : ` — ${NAN_MESSAGE}`}`);
      }
      case 'tensor': {
        if (n.message) return add(n.path, n.message);
        for (const i of n.bad) {
          const idx = n.expectedShape.length ? unflatIndex(i, n.expectedShape).map((k) => `[${k}]`).join('') : '';
          const got = n.actual?.[i];
          if (got === undefined) continue;
          if (!add(`${n.path}${idx}`, `expected ${showNumber(n.expected[i])} ${tol(n.tolerance)}, got ${showNumber(got)}`)) return false;
        }
        return true;
      }
      case 'array':
        if (n.message && n.actualLength === null) return add(n.path, n.message);
        if (n.message && !add(n.path, n.message)) return false;
        for (const it of n.items) if (!walk(it)) return false;
        return true;
      case 'object':
        if (n.message) return add(n.path, n.message);
        for (const e of n.entries) if (!walk(e.node)) return false;
        return true;
      case 'value':
        return add(n.path, n.message ?? `expected ${showAny(n.expected)}, got ${showAny(n.actual)}`);
    }
  };
  walk(node);
  return out;
}

/** Metric detail: result[name] (number or 1-element tensor) against [min, max]. */
export function metricDetail(result: unknown, metric: { name: string; min?: number; max?: number }): NonNullable<JsCaseDetail['metric']> {
  let v: unknown = result && typeof result === 'object' ? (result as Record<string, unknown>)[metric.name] : undefined;
  if (isShaped(v) && v.data.length === 1) v = v.data[0];
  const value = isNum(v) ? v : null;
  const ok = value !== null && Number.isFinite(value) && (metric.min === undefined || value >= metric.min) && (metric.max === undefined || value <= metric.max);
  return { name: metric.name, value, ...(metric.min !== undefined ? { min: metric.min } : {}), ...(metric.max !== undefined ? { max: metric.max } : {}), ok };
}
