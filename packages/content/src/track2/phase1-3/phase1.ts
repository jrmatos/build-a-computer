import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../../define';
import { MODULES, base, code, eq, jsSetup } from './common';

/**
 * Track 2, Phase 1 (Numbers): vectors and the dot product, matrix multiply,
 * broadcasting and softmax, all on plain JavaScript arrays (no library yet).
 * DRAFT text (owner approves). CNT-12.
 */

type Vec = number[];
type Mat = number[][];
type Arr = number | Vec | Mat;

// Models: the tests' expected values come from these.
const vadd = (a: Vec, b: Vec): Vec => a.map((x, i) => x + b[i]!);
const vscale = (k: number, a: Vec): Vec => a.map((x) => k * x);
const vdot = (a: Vec, b: Vec): number => a.reduce((s, x, i) => s + x * b[i]!, 0);
const vnorm = (a: Vec): number => Math.sqrt(vdot(a, a));
const transpose = (A: Mat): Mat => (A.length === 0 ? [] : A[0]!.map((_, j) => A.map((r) => r[j]!)));
const matmul = (A: Mat, B: Mat): Mat => A.map((r) => transpose(B).map((c) => vdot(r, c)));

/** NumPy broadcasting for rank 0, 1 and 2 (shapes aligned from the right). */
function bshape(x: Arr): number[] {
  if (typeof x === 'number') return [];
  if (x.length > 0 && Array.isArray(x[0])) return [x.length, (x[0] as Vec).length];
  return [x.length];
}
function as2d(x: Arr): Mat {
  if (typeof x === 'number') return [[x]];
  if (x.length > 0 && Array.isArray(x[0])) return x as Mat;
  return [x as Vec];
}
export function broadcast(a: Arr, b: Arr, op: (x: number, y: number) => number): Arr {
  const sa = bshape(a);
  const sb = bshape(b);
  const rank = Math.max(sa.length, sb.length);
  const A = as2d(a);
  const B = as2d(b);
  const rows = Math.max(A.length, B.length);
  const cols = Math.max(A[0]!.length, B[0]!.length);
  const out: Mat = [];
  for (let i = 0; i < rows; i++) {
    const r: Vec = [];
    for (let j = 0; j < cols; j++) r.push(op(A[A.length === 1 ? 0 : i]![A[0]!.length === 1 ? 0 : j]!, B[B.length === 1 ? 0 : i]![B[0]!.length === 1 ? 0 : j]!));
    out.push(r);
  }
  return rank === 0 ? out[0]![0]! : rank === 1 ? out[0]! : out;
}

export function softmax(xs: Vec): Vec {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

const vecCase = (fn: 'add' | 'dot', a: Vec, b: Vec) =>
  eq(`${fn}([${a}], [${b}])`, fn, [a, b], fn === 'add' ? vadd(a, b) : vdot(a, b));

export const PHASE1: Level[] = [
  defineLevel({
    ...base,
    phase: 1,
    id: 'vectors-dot',
    order: 1,
    title: 'Vectors and the dot product',
    goal: 'Write add, scale, dot and norm for vectors stored as plain arrays of numbers. Every neural network is built from these four.',
    tutorial:
      'A vector is a list of numbers. In this track it is a plain JavaScript array: `[1, 2, 3]`. ' +
      'Adding two vectors adds them element by element, and scaling multiplies every element by one number:\n\n' +
      '```\n[1, 2, 3] + [10, 20, 30] = [11, 22, 33]\n2 * [1, 2, 3]            = [2, 4, 6]\n```\n\n' +
      'The dot product multiplies matching elements and adds the products up. It turns two vectors into one number:\n\n' +
      '```\ndot([1, 2, 3], [4, 5, 6]) = 1*4 + 2*5 + 3*6 = 32\n```\n\n' +
      'The dot product measures how much two vectors point the same way. A neuron is a dot product of its inputs with its weights, ' +
      'so you will write this loop many thousands of times, mostly without seeing it. The length (norm) of a vector is the square root of its dot product with itself: ' +
      'norm([3, 4]) = sqrt(9 + 16) = 5.\n\n' +
      code(`
export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    // ...
  }
  return sum;
}
`) +
      '\n\nTests call your exported functions with arrays and compare the result, allowing a tiny rounding error.',
    hints: [
      'Each function is one loop over the indexes 0 to a.length - 1. The two vectors in a test always have the same length.',
      'add and scale build a new array (push into `[]`, or use `a.map((x, i) => ...)`). dot and norm return a single number.',
      'norm(a) is `Math.sqrt(dot(a, a))`: you can call your own dot.',
      'Near-complete:\n' +
        code(`
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const scale = (k, a) => a.map((x) => k * x);
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const norm = (a) => Math.sqrt(dot(a, a));
`),
    ],
    afterword:
      'GPUs are, at heart, machines that do enormous numbers of dot products at once. Everything in the rest of this track, from a single neuron to attention in a transformer, ' +
      'is dot products arranged cleverly.',
    js: jsSetup({
      starter: `// Vectors are plain arrays of numbers, like [1, 2, 3].

// a + b, element by element: add([1, 2], [3, 4]) is [4, 6].
export function add(a, b) {
  return [];
}

// k times every element: scale(2, [1, 2]) is [2, 4].
export function scale(k, a) {
  return [];
}

// Sum of the products of matching elements: dot([1, 2, 3], [4, 5, 6]) is 32.
export function dot(a, b) {
  return 0;
}

// Length of the vector: norm([3, 4]) is 5.
export function norm(a) {
  return 0;
}
`,
      modules: MODULES.none,
    }),
    tests: [
      vecCase('add', [1, 2, 3], [10, 20, 30]),
      vecCase('add', [-1.5, 0], [0.5, 2]),
      eq('scale(2, [1, 2, 3])', 'scale', [2, [1, 2, 3]], vscale(2, [1, 2, 3])),
      eq('scale(-0.5, [4, -2])', 'scale', [-0.5, [4, -2]], vscale(-0.5, [4, -2])),
      vecCase('dot', [1, 2, 3], [4, 5, 6]),
      vecCase('dot', [1, 0], [0, 1]),
      vecCase('dot', [0.1, -0.2, 0.3, 0.4], [2, 3, -1, 0.5]),
      eq('norm([3, 4])', 'norm', [[3, 4]], vnorm([3, 4])),
      eq('norm([1, 1, 1, 1])', 'norm', [[1, 1, 1, 1]], vnorm([1, 1, 1, 1])),
    ],
    requires: [],
  }),

  defineLevel({
    ...base,
    phase: 1,
    id: 'matmul',
    order: 2,
    title: 'Matrix multiply',
    goal: 'Write transpose and matmul for matrices stored as arrays of rows. matmul(A, B) is every row of A dotted with every column of B.',
    tutorial:
      'A matrix is a grid of numbers. Here it is an array of rows: `[[1, 2, 3], [4, 5, 6]]` has 2 rows and 3 columns, its shape is 2×3.\n\n' +
      'The transpose flips a matrix over its diagonal: row i becomes column i. A 2×3 matrix becomes 3×2.\n\n' +
      'Matrix multiply C = A·B takes an m×k matrix A and a k×n matrix B and gives an m×n matrix C. ' +
      'Each entry is a dot product:\n\n' +
      '```\nC[i][j] = dot(row i of A, column j of B) = sum over t of A[i][t] * B[t][j]\n```\n\n' +
      'The inner sizes must match (k), and the outer sizes give the shape of the result. Three nested loops do it:\n\n' +
      code(`
for (let i = 0; i < m; i++)
  for (let j = 0; j < n; j++)
    for (let t = 0; t < k; t++)
      C[i][j] += A[i][t] * B[t][j];
`) +
      '\n\nA layer of a neural network is one matrix multiply: a batch of inputs (one per row) times a weight matrix (one column per neuron).',
    hints: [
      'Shapes first: A has A.length rows and A[0].length columns. The result has A.length rows and B[0].length columns.',
      'Make the result full of zeros before the loops: `Array.from({ length: m }, () => new Array(n).fill(0))`.',
      'transpose(A)[j][i] is A[i][j]. With it, C[i][j] is a dot product of A[i] and transpose(B)[j].',
      'Near-complete:\n' +
        code(`
export function transpose(A) {
  return A[0].map((_, j) => A.map((row) => row[j]));
}
export function matmul(A, B) {
  const m = A.length, k = B.length, n = B[0].length;
  const C = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++)
      for (let t = 0; t < k; t++) C[i][j] += A[i][t] * B[t][j];
  return C;
}
`),
    ],
    afterword:
      'The loop order matters for speed: the i-t-j order walks memory in a straight line and runs several times faster on large matrices. ' +
      'Libraries go much further (blocking, SIMD, GPUs), but they compute exactly this.',
    js: jsSetup({
      starter: `// A matrix is an array of rows: [[1, 2, 3], [4, 5, 6]] is 2 rows by 3 columns.

// Rows become columns: transpose([[1, 2, 3], [4, 5, 6]]) is [[1, 4], [2, 5], [3, 6]].
export function transpose(A) {
  return [];
}

// A is m×k, B is k×n; the result is m×n with C[i][j] = sum over t of A[i][t] * B[t][j].
export function matmul(A, B) {
  return [];
}
`,
      modules: MODULES.none,
    }),
    tests: [
      eq('transpose 2×3', 'transpose', [[[1, 2, 3], [4, 5, 6]]], transpose([[1, 2, 3], [4, 5, 6]])),
      eq('transpose 1×1', 'transpose', [[[7]]], [[7]]),
      eq('2×3 times 3×2', 'matmul', [[[1, 2, 3], [4, 5, 6]], [[7, 8], [9, 10], [11, 12]]], matmul([[1, 2, 3], [4, 5, 6]], [[7, 8], [9, 10], [11, 12]])),
      eq('identity', 'matmul', [[[1, 0], [0, 1]], [[3, -2], [0.5, 4]]], [[3, -2], [0.5, 4]]),
      eq('row times column', 'matmul', [[[1, 2, 3]], [[4], [5], [6]]], [[32]]),
      eq('column times row', 'matmul', [[[1], [2]], [[3, 4, 5]]], matmul([[1], [2]], [[3, 4, 5]])),
      eq('3×2 times 2×4', 'matmul', [[[0.5, -1], [2, 0], [1, 1]], [[1, 2, 3, 4], [-1, 0, 1, 0.25]]], matmul([[0.5, -1], [2, 0], [1, 1]], [[1, 2, 3, 4], [-1, 0, 1, 0.25]])),
    ],
    requires: ['vectors-dot'],
  }),

  defineLevel({
    ...base,
    phase: 1,
    id: 'broadcasting',
    order: 3,
    title: 'Broadcasting',
    goal: 'Write shape, add and mul so that a number, a vector and a matrix can be combined the way NumPy and PyTorch do: smaller shapes are stretched to fit.',
    tutorial:
      'Adding a bias to every row of a batch is so common that libraries let you write `X + b` with X of shape [m, n] and b of shape [n]. ' +
      'The rule that makes this work is called broadcasting:\n\n' +
      '1. Line the shapes up from the right. A number has shape [], a vector [n], a matrix [m, n].\n' +
      '2. A missing size counts as 1.\n' +
      '3. Two sizes are compatible when they are equal or one of them is 1. A size of 1 is stretched (the same value is reused).\n\n' +
      '```\n[2, 3] with [3]     -> [2, 3]   the vector is added to each row\n[2, 3] with [2, 1]  -> [2, 3]   the column is added to each column\n[2, 1] with [1, 3]  -> [2, 3]   an outer sum\n[]     with [2, 3]  -> [2, 3]   a number goes everywhere\n```\n\n' +
      'The result has the larger rank of the two inputs. One way to write it: turn both inputs into matrices (a number becomes [[x]], a vector becomes one row), ' +
      'loop over the output shape, and read index 0 wherever an input has size 1.\n\n' +
      code(`
const pick = (M, i, j) => M[M.length === 1 ? 0 : i][M[0].length === 1 ? 0 : j];
`),
    hints: [
      'shape: a number gives [], an array whose first element is an array gives [rows, cols], any other array gives [length].',
      'Write one helper `broadcast(a, b, f)` and define add and mul as `broadcast(a, b, (x, y) => x + y)` and `(x, y) => x * y`.',
      'Inside broadcast: make both inputs 2D, compute rows = max of row counts and cols = max of column counts, fill the output with f(pick(A, i, j), pick(B, i, j)), ' +
        'then unwrap: rank 0 returns out[0][0], rank 1 returns out[0].',
      'Near-complete:\n' +
        code(`
export const shape = (x) => typeof x === 'number' ? [] : Array.isArray(x[0]) ? [x.length, x[0].length] : [x.length];
const as2d = (x) => typeof x === 'number' ? [[x]] : Array.isArray(x[0]) ? x : [x];
const pick = (M, i, j) => M[M.length === 1 ? 0 : i][M[0].length === 1 ? 0 : j];
function broadcast(a, b, f) {
  const rank = Math.max(shape(a).length, shape(b).length);
  const A = as2d(a), B = as2d(b);
  const rows = Math.max(A.length, B.length), cols = Math.max(A[0].length, B[0].length);
  const out = [];
  for (let i = 0; i < rows; i++) {
    const r = [];
    for (let j = 0; j < cols; j++) r.push(f(pick(A, i, j), pick(B, i, j)));
    out.push(r);
  }
  return rank === 0 ? out[0][0] : rank === 1 ? out[0] : out;
}
export const add = (a, b) => broadcast(a, b, (x, y) => x + y);
export const mul = (a, b) => broadcast(a, b, (x, y) => x * y);
`),
    ],
    afterword:
      'Broadcasting never copies the small input; real libraries give it a stride of 0 along the stretched axis, so the same memory is read again. ' +
      'It is also the most common source of silent shape bugs: [3] + [3, 1] is a valid 3×3 matrix even when you meant a vector.',
    js: jsSetup({
      starter: `// Numbers, vectors (arrays) and matrices (arrays of rows).

// shape(5) is [], shape([1, 2, 3]) is [3], shape([[1, 2, 3], [4, 5, 6]]) is [2, 3].
export function shape(x) {
  return [];
}

// Element-wise a + b with broadcasting: add([[1, 2], [3, 4]], [10, 20]) is [[11, 22], [13, 24]].
export function add(a, b) {
  return 0;
}

// Element-wise a * b with broadcasting: mul(2, [1, 2]) is [2, 4].
export function mul(a, b) {
  return 0;
}
`,
      modules: MODULES.none,
    }),
    tests: [
      eq('shape of a number', 'shape', [5], []),
      eq('shape of a vector', 'shape', [[1, 2, 3]], [3]),
      eq('shape of a matrix', 'shape', [[[1, 2, 3], [4, 5, 6]]], [2, 3]),
      eq('[2, 3] + [3]', 'add', [[[1, 2, 3], [4, 5, 6]], [10, 20, 30]], broadcast([[1, 2, 3], [4, 5, 6]], [10, 20, 30], (x, y) => x + y)),
      eq('[2, 3] + [2, 1]', 'add', [[[1, 2, 3], [4, 5, 6]], [[100], [200]]], broadcast([[1, 2, 3], [4, 5, 6]], [[100], [200]], (x, y) => x + y)),
      eq('[2, 1] + [1, 3]', 'add', [[[1], [2]], [[10, 20, 30]]], broadcast([[1], [2]], [[10, 20, 30]], (x, y) => x + y)),
      eq('[] * [2, 2]', 'mul', [3, [[1, 2], [3, 4]]], broadcast(3, [[1, 2], [3, 4]], (x, y) => x * y)),
      eq('[3] * []', 'mul', [[1, -2, 0.5], -2], broadcast([1, -2, 0.5], -2, (x, y) => x * y)),
      eq('[3] * [3]', 'mul', [[1, 2, 3], [4, 5, 6]], [4, 10, 18]),
      eq('[] + []', 'add', [2, 3], 5),
    ],
    requires: ['matmul'],
  }),

  defineLevel({
    ...base,
    phase: 1,
    id: 'softmax',
    order: 4,
    title: 'Softmax',
    goal: 'Write softmax, which turns any list of scores into probabilities that add up to 1, without overflowing on large scores. Then apply it to every row of a matrix.',
    tutorial:
      'A classifier ends with one score per class, called logits. They can be any real numbers. Softmax turns them into probabilities:\n\n' +
      '```\nsoftmax(x)[i] = exp(x[i]) / (exp(x[0]) + exp(x[1]) + ... + exp(x[n-1]))\n```\n\n' +
      'Every output is positive and they add up to 1. The largest score gets the largest share, and adding the same number to every score changes nothing, ' +
      'because exp(x + c) = exp(x) * exp(c) and the exp(c) cancels.\n\n' +
      'That last fact saves you. `Math.exp(1000)` is Infinity, and Infinity / Infinity is NaN. Subtract the largest score first: the biggest exponent becomes exp(0) = 1, ' +
      'nothing overflows, and the answer is the same.\n\n' +
      code(`
const m = Math.max(...xs);
const e = xs.map((x) => Math.exp(x - m));
`),
    hints: [
      'Three steps: find the maximum, take exp(x - max) of every element, divide each by the sum of those.',
      'Test it on [1000, 1001, 1002]: the answer is the same as for [0, 1, 2]. If you see NaN, you forgot to subtract the maximum.',
      'softmaxRows(M) is `M.map(softmax)`: each row is its own distribution.',
      'Near-complete:\n' +
        code(`
export function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}
export const softmaxRows = (M) => M.map(softmax);
`),
    ],
    afterword:
      'Softmax appears twice in a transformer: at the output, to turn logits into next-token probabilities, and inside every attention head, ' +
      'to turn similarity scores into weights. The subtract-the-max trick is in every real implementation.',
    js: jsSetup({
      starter: `// Scores (any numbers) in, probabilities (positive, summing to 1) out.
export function softmax(xs) {
  const e = xs.map((x) => Math.exp(x));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s); // works for small scores, but try [1000, 1001, 1002]
}

// softmax applied to every row of a matrix.
export function softmaxRows(M) {
  return [];
}
`,
      modules: MODULES.none,
    }),
    tests: [
      eq('softmax([1, 2, 3])', 'softmax', [[1, 2, 3]], softmax([1, 2, 3])),
      eq('softmax([0, 0, 0, 0])', 'softmax', [[0, 0, 0, 0]], [0.25, 0.25, 0.25, 0.25]),
      eq('softmax([1000, 1001, 1002])', 'softmax', [[1000, 1001, 1002]], softmax([1000, 1001, 1002])),
      eq('softmax([-1000, 0])', 'softmax', [[-1000, 0]], softmax([-1000, 0])),
      eq('softmax([5])', 'softmax', [[5]], [1]),
      eq('softmaxRows', 'softmaxRows', [[[1, 2], [3, 3], [800, 0]]], [[1, 2], [3, 3], [800, 0]].map(softmax)),
    ],
    requires: ['broadcasting'],
  }),
];
