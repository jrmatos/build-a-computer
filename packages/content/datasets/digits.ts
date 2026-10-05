/**
 * `digits-8x8`: a small synthetic handwritten-style digit set, generated on
 * demand and deterministically from a seed. Each image is a 5×7 glyph of a
 * digit 0-9 drawn into an 8×8 grid at a random offset, with stroke dropout,
 * stray pixels and grey-level noise. Nothing is downloaded or copied: the
 * glyphs below were drawn for this project (license: CC0-1.0, see
 * LICENSES.md). Pure: no I/O, no clock, no Math.random.
 */

/** 5×7 glyphs, one string per row, '#' = ink. */
const GLYPHS: readonly (readonly string[])[] = [
  ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  ['..#..', '.##..', '#.#..', '..#..', '..#..', '..#..', '#####'],
  ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
];

export const DIGITS_SIDE = 8;
export const DIGITS_CLASSES = 10;

/** One split: `x[i]` is 64 grey levels in [0, 1] (row-major 8×8), `y[i]` the digit. */
export interface DigitSplit {
  x: number[][];
  y: number[];
}

export interface DigitsDataset {
  id: 'digits-8x8';
  /** Image side in pixels (8). */
  side: number;
  classes: number;
  train: DigitSplit;
  test: DigitSplit;
}

/** mulberry32: a tiny seeded PRNG, enough for data generation. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One noisy 8×8 image of `digit`. */
export function renderDigit(digit: number, rand: () => number): number[] {
  const img = new Array<number>(DIGITS_SIDE * DIGITS_SIDE).fill(0);
  const dx = Math.floor(rand() * 3); // 0..2: the glyph is 5 wide, centred ±1
  const dy = Math.floor(rand() * 2); // 0..1: the glyph is 7 tall
  const ink = 0.6 + 0.4 * rand(); // pen darkness for this sample
  const glyph = GLYPHS[digit]!;
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 5; c++) {
      if (glyph[r]![c] !== '#') continue;
      if (rand() < 0.08) continue; // a gap in the stroke
      img[(r + dy) * DIGITS_SIDE + c + dx] = ink;
    }
  }
  for (let i = 0; i < img.length; i++) {
    if (rand() < 0.03) img[i] = Math.max(img[i]!, 0.3 + 0.5 * rand()); // stray mark
    const v = img[i]! + (rand() - 0.5) * 0.2; // grey-level noise
    img[i] = Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  }
  return img;
}

function split(n: number, rand: () => number): DigitSplit {
  const x: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = i % DIGITS_CLASSES;
    x.push(renderDigit(d, rand));
    y.push(d);
  }
  // Shuffle so batches are not in label order (Fisher-Yates, same stream).
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [x[i], x[j]] = [x[j]!, x[i]!];
    [y[i], y[j]] = [y[j]!, y[i]!];
  }
  return { x, y };
}

/**
 * The dataset: 1,500 training and 300 held-out test images, balanced across
 * the 10 digits. The same seed always gives the same images; the test split
 * uses its own stream so its contents do not depend on the training size.
 */
export function digits(opts: { train?: number; test?: number; seed?: number } = {}): DigitsDataset {
  const seed = opts.seed ?? 2024;
  return {
    id: 'digits-8x8',
    side: DIGITS_SIDE,
    classes: DIGITS_CLASSES,
    train: split(opts.train ?? 1500, rng(seed)),
    test: split(opts.test ?? 300, rng(seed ^ 0x5eed)),
  };
}
