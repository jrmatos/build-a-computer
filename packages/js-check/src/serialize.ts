/**
 * Converting values that cross the sandbox boundary. Results become JSON-safe
 * (tensors as `{ shape, data }`, typed arrays as plain arrays); NaN and
 * Infinity are kept so the checker can report them (E-ML-03).
 */

const MAX_DEPTH = 32;
const MAX_ITEMS = 5_000_000;

interface TensorLike {
  shape: ArrayLike<number>;
  data: ArrayLike<number>;
}

/** Duck-typed tensor check: a `shape` array plus a numeric `data` array. */
export function isTensorLike(v: unknown): v is TensorLike {
  if (!v || typeof v !== 'object') return false;
  const t = v as { shape?: unknown; data?: unknown };
  return Array.isArray(t.shape) && (ArrayBuffer.isView(t.data) || (Array.isArray(t.data) && t.data.every((x) => typeof x === 'number')));
}

/** Plain-data copy of a result: tensors -> {shape, data}, typed arrays -> arrays, Maps -> objects. */
export function toSafe(value: unknown): unknown {
  let items = 0;
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (++items > MAX_ITEMS) throw new RangeError('The result is too large to check.');
    if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (v === undefined) return undefined;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v !== 'object') return undefined; // functions, symbols
    if (depth > MAX_DEPTH) throw new RangeError('The result is nested too deeply to check.');
    if (seen.has(v)) throw new TypeError('The result contains a cycle.');
    seen.add(v);
    try {
      if (isTensorLike(v)) {
        items += v.data.length;
        return { shape: Array.from(v.shape), data: Array.from(v.data) };
      }
      if (ArrayBuffer.isView(v)) {
        const arr = Array.from(v as unknown as ArrayLike<number>);
        items += arr.length;
        return arr;
      }
      if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
      if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), walk(x, depth + 1)]));
      if (v instanceof Set) return [...v].map((x) => walk(x, depth + 1));
      if (v instanceof Error) return { name: v.name, message: v.message };
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v)) {
        const x = walk((v as Record<string, unknown>)[k], depth + 1);
        if (x !== undefined) out[k] = x;
      }
      return out;
    } finally {
      seen.delete(v);
    }
  };
  return walk(value, 0);
}

/** Marker for tensors inside a checkpoint. */
export interface SavedTensor {
  $tensor: 1;
  shape: number[];
  data: Float32Array | Float64Array;
  requiresGrad: boolean;
}

/**
 * Structured-clone-safe copy of a checkpoint: tensors become SavedTensor
 * (their data copied), typed arrays are copied, functions dropped.
 */
export function toCheckpoint(value: unknown): unknown {
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== 'object') return typeof v === 'function' || typeof v === 'symbol' ? undefined : v;
    if (depth > MAX_DEPTH) throw new RangeError('checkpoint(): the state is nested too deeply.');
    if (isTensorLike(v) && (v.data instanceof Float32Array || v.data instanceof Float64Array)) {
      const t = v as unknown as { shape: number[]; data: Float32Array | Float64Array; requiresGrad?: boolean };
      return { $tensor: 1, shape: [...t.shape], data: t.data.slice(), requiresGrad: !!t.requiresGrad } satisfies SavedTensor;
    }
    if (ArrayBuffer.isView(v)) return (v as unknown as { slice(): unknown }).slice();
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const x = walk((v as Record<string, unknown>)[k], depth + 1);
      if (x !== undefined) out[k] = x;
    }
    return out;
  };
  return walk(value, 0);
}

/** Rebuilds a checkpoint, turning SavedTensor records back into tensors with `makeTensor`. */
export function fromCheckpoint(value: unknown, makeTensor: (t: SavedTensor) => unknown): unknown {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
    if ((v as { $tensor?: unknown }).$tensor === 1) return makeTensor(v as SavedTensor);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = walk((v as Record<string, unknown>)[k]);
    return out;
  };
  return walk(value);
}
