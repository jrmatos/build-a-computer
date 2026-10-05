/**
 * Shape arithmetic shared by the tensor class and both backends.
 *
 * Tensors here are always stored contiguously in row-major ("C") order: the
 * last axis changes fastest. A shape of [2, 3] has strides [3, 1], so element
 * (i, j) lives at index i * 3 + j.
 */

export type Shape = readonly number[];

/** Number of elements in a tensor of this shape (1 for a scalar, shape []). */
export function sizeOf(shape: Shape): number {
  let n = 1;
  for (const d of shape) n *= d;
  return n;
}

/** Row-major strides: how far to jump in the flat array to move one step along each axis. */
export function stridesOf(shape: Shape): number[] {
  const strides = new Array<number>(shape.length);
  let s = 1;
  for (let i = shape.length - 1; i >= 0; i--) {
    strides[i] = s;
    s *= shape[i]!;
  }
  return strides;
}

export function shapesEqual(a: Shape, b: Shape): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function formatShape(shape: Shape): string {
  return `[${shape.join(', ')}]`;
}

/** Throws unless every dimension is a non-negative integer. */
export function checkShape(shape: Shape): void {
  for (const d of shape) {
    if (!Number.isInteger(d) || d < 0) {
      throw new RangeError(
        `Invalid shape ${formatShape(shape)}: dimensions must be non-negative integers.`,
      );
    }
  }
}

/** Turns a possibly negative axis (-1 = last) into a positive one, checking range. */
export function normalizeAxis(axis: number, rank: number): number {
  const a = axis < 0 ? axis + rank : axis;
  if (!Number.isInteger(a) || a < 0 || a >= rank) {
    throw new RangeError(`Axis ${axis} is out of range for a tensor with ${rank} dimension(s).`);
  }
  return a;
}

/**
 * Broadcasting (NumPy rules): line the shapes up from the right; each pair of
 * dimensions must be equal, or one of them must be 1 (it is stretched).
 * Missing leading dimensions count as 1.
 */
export function broadcastShapes(a: Shape, b: Shape): number[] {
  const rank = Math.max(a.length, b.length);
  const out = new Array<number>(rank);
  for (let i = 0; i < rank; i++) {
    const da = a[a.length - rank + i] ?? 1;
    const db = b[b.length - rank + i] ?? 1;
    if (da !== db && da !== 1 && db !== 1) {
      throw new RangeError(
        `Shapes ${formatShape(a)} and ${formatShape(b)} cannot be broadcast together (axis ${i}: ${da} vs ${db}).`,
      );
    }
    out[i] = da === 1 ? db : da;
  }
  return out;
}

/**
 * Strides for reading a tensor of `shape` as if it had the larger `target`
 * shape: stretched (broadcast) axes get stride 0, so every step re-reads the
 * same element.
 */
export function broadcastStrides(shape: Shape, target: Shape): number[] {
  const own = stridesOf(shape);
  const out = new Array<number>(target.length).fill(0);
  const offset = target.length - shape.length;
  for (let i = 0; i < shape.length; i++) {
    out[i + offset] = shape[i] === 1 ? 0 : own[i]!;
  }
  return out;
}

/** Resolves one `-1` entry in a reshape target from the total size. */
export function inferReshape(size: number, target: Shape): number[] {
  const out = [...target];
  const unknown = out.indexOf(-1);
  if (unknown !== out.lastIndexOf(-1))
    throw new RangeError('reshape: only one dimension can be -1.');
  if (unknown >= 0) {
    out[unknown] = 1;
    const known = sizeOf(out);
    if (known === 0 || size % known !== 0) {
      throw new RangeError(
        `reshape: cannot infer -1 to fit ${size} elements into ${formatShape(target)}.`,
      );
    }
    out[unknown] = size / known;
  }
  checkShape(out);
  if (sizeOf(out) !== size) {
    throw new RangeError(`reshape: ${size} elements do not fit shape ${formatShape(target)}.`);
  }
  return out;
}
