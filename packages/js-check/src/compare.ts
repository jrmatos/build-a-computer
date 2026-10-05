/**
 * Numeric comparison for Track 2 checks (E-ML-02: never exact equality for
 * floats; E-ML-03: NaN and Infinity explain exploding gradients).
 */

/** Message shown when a result or a reported value is NaN or infinite (E-ML-03). */
export const NAN_MESSAGE = 'loss became NaN — try a lower learning rate';

export interface CompareResult {
  ok: boolean;
  /** Where the first difference is, e.g. 'result[2].w'. */
  path?: string;
  message?: string;
  /** True when the first difference is a NaN/Infinity where a finite number was expected. */
  nonFinite?: boolean;
}

/** Two numbers match when |a - e| <= tolerance * max(1, |e|) (absolute near 0, relative for large values). */
export function closeEnough(actual: number, expected: number, tolerance: number): boolean {
  if (Number.isNaN(expected)) return Number.isNaN(actual);
  if (!Number.isFinite(expected)) return actual === expected;
  if (!Number.isFinite(actual)) return false;
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

interface Shaped {
  shape: number[];
  data: number[];
}

const isShaped = (v: unknown): v is Shaped =>
  !!v && typeof v === 'object' && Array.isArray((v as Shaped).shape) && Array.isArray((v as Shaped).data);

/** Nested arrays for a {shape, data} value (a number for shape []). */
function nest(t: Shaped): unknown {
  if (t.shape.length === 0) return t.data[0];
  const build = (axis: number, offset: number): unknown[] => {
    const n = t.shape[axis]!;
    const stride = t.shape.slice(axis + 1).reduce((a, b) => a * b, 1);
    return Array.from({ length: n }, (_, i) => (axis === t.shape.length - 1 ? t.data[offset + i] : build(axis + 1, offset + i * stride)));
  };
  return build(0, 0);
}

const show = (v: unknown): string => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(8)));
  const s = JSON.stringify(v, (_k, x: unknown) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x));
  return s === undefined ? String(v) : s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

/**
 * Deep comparison of a sandbox result (already JSON-safe: tensors are
 * {shape, data}) with the expected value. Numbers compare within tolerance.
 * A tensor result matches an expected nested array or number; objects must
 * have every expected key (extra keys in the result are ignored).
 */
export function compareValues(actual: unknown, expected: unknown, tolerance: number, path = 'result'): CompareResult {
  const fail = (message: string, nonFinite = false): CompareResult => ({ ok: false, path, message: `${path}: ${message}`, nonFinite });
  if (isShaped(actual) && !isShaped(expected)) {
    if (typeof expected === 'number' && actual.data.length === 1) return compareValues(actual.data[0], expected, tolerance, path);
    if (Array.isArray(expected) || typeof expected === 'number') return compareValues(nest(actual), expected, tolerance, path);
  }
  if (typeof expected === 'number') {
    if (typeof actual !== 'number') return fail(`expected ${show(expected)}, got ${show(actual)}`);
    if (closeEnough(actual, expected, tolerance)) return { ok: true };
    if (!Number.isFinite(actual)) return fail(`expected ${show(expected)}, got ${actual}`, true);
    return fail(`expected ${show(expected)}, got ${show(actual)} (tolerance ${tolerance > 0 && tolerance < 1e-3 ? tolerance.toExponential() : tolerance})`);
  }
  if (isShaped(expected)) {
    if (!isShaped(actual)) return fail(`expected a tensor of shape [${expected.shape.join(', ')}], got ${show(actual)}`);
    if (actual.shape.length !== expected.shape.length || actual.shape.some((d, i) => d !== expected.shape[i]))
      return fail(`expected shape [${expected.shape.join(', ')}], got [${actual.shape.join(', ')}]`);
    for (let i = 0; i < expected.data.length; i++) {
      const r = compareValues(actual.data[i], expected.data[i], tolerance, `${path}.data[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return fail(`expected an array of ${expected.length}, got ${show(actual)}`);
    if (actual.length !== expected.length) return fail(`expected ${expected.length} items, got ${actual.length}`);
    for (let i = 0; i < expected.length; i++) {
      const r = compareValues(actual[i], expected[i], tolerance, `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return fail(`expected an object, got ${show(actual)}`);
    for (const k of Object.keys(expected)) {
      if (!(k in actual)) return fail(`missing key '${k}'`);
      const r = compareValues((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], tolerance, `${path}.${k}`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (actual === expected || (expected === null && actual === undefined)) return { ok: true };
  return fail(`expected ${show(expected)}, got ${show(actual)}`);
}

/** Path of the first NaN or infinite number inside a value, or undefined. */
export function findNonFinite(value: unknown, path = 'result'): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : path;
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = findNonFinite(value[i], `${path}[${i}]`);
      if (p) return p;
    }
    return undefined;
  }
  for (const k of Object.keys(value)) {
    const p = findNonFinite((value as Record<string, unknown>)[k], `${path}.${k}`);
    if (p) return p;
  }
  return undefined;
}

/** Checks result[metric.name] against [min, max]. */
export function checkMetric(result: unknown, metric: { name: string; min?: number; max?: number }): CompareResult {
  const path = `result.${metric.name}`;
  if (!result || typeof result !== 'object') return { ok: false, path, message: `The function must return an object with '${metric.name}', got ${show(result)}.` };
  let v = (result as Record<string, unknown>)[metric.name];
  if (isShaped(v) && v.data.length === 1) v = v.data[0];
  if (typeof v !== 'number') return { ok: false, path, message: `The returned object has no number '${metric.name}' (got ${show(v)}).` };
  if (!Number.isFinite(v)) return { ok: false, path, nonFinite: true, message: `${metric.name} is ${v}: ${NAN_MESSAGE}.` };
  const range = `${metric.min !== undefined ? `>= ${metric.min}` : ''}${metric.min !== undefined && metric.max !== undefined ? ' and ' : ''}${metric.max !== undefined ? `<= ${metric.max}` : ''}`;
  if ((metric.min !== undefined && v < metric.min) || (metric.max !== undefined && v > metric.max))
    return { ok: false, path, message: `${metric.name} is ${show(v)}; it must be ${range}.` };
  return { ok: true, message: `${metric.name} is ${show(v)} (needs ${range || 'any value'}).` };
}
