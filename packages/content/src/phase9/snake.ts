/**
 * A model of the final project's snake game (os-final-game): given the keys
 * typed, the picture it leaves on the framebuffer, what it prints and its
 * exit code. The level's expected framebuffer hashes are this model's
 * pictures; phase9.test.ts checks that the reference program draws the same.
 */

export const SNAKE = {
  W: 32,
  H: 20,
  CELL: 10,
  BACKGROUND: 0,
  BODY: 10,
  HEAD: 14,
  FOOD: 12,
  SEED: 12345,
} as const;

export const SNAKE_BANNER = 'snake! w a s d to turn, q to quit\n';

export interface SnakeResult {
  /** 320 x 200 palette indexes, row by row. */
  pixels: Uint8Array;
  uart: string;
  score: number;
  /** 'bye' after q, 'over' after a crash, 'waiting' when the keys ran out first. */
  ending: 'bye' | 'over' | 'waiting';
}

export function snakeModel(keys: string): SnakeResult {
  const { W, H, CELL, BACKGROUND, BODY, HEAD, FOOD } = SNAKE;
  const pixels = new Uint8Array(320 * 200).fill(BACKGROUND);
  let seed: number = SNAKE.SEED;
  const random = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 16) & 0x7fff;
  };
  const fill = (x: number, y: number, color: number): void => {
    for (let i = 0; i < CELL; i++)
      pixels.fill(color, (y * CELL + i) * 320 + x * CELL, (y * CELL + i) * 320 + x * CELL + CELL);
  };
  const xs = [5, 4, 3];
  const ys = [10, 10, 10];
  let dx = 1;
  let dy = 0;
  let score = 0;
  let food = [0, 0];
  const onSnake = (x: number, y: number): boolean => xs.some((sx, i) => sx === x && ys[i] === y);
  const placeFood = (): void => {
    do food = [random() % W, random() % H];
    while (onSnake(food[0]!, food[1]!));
    fill(food[0]!, food[1]!, FOOD);
  };
  xs.forEach((x, i) => fill(x, ys[i]!, BODY));
  fill(xs[0]!, ys[0]!, HEAD);
  placeFood();
  const uart = SNAKE_BANNER;
  for (const k of keys) {
    if (k === 'q') return { pixels, uart: uart + `bye! score ${score}\n`, score, ending: 'bye' };
    if (k === 'w' && dy !== 1) [dx, dy] = [0, -1];
    else if (k === 's' && dy !== -1) [dx, dy] = [0, 1];
    else if (k === 'a' && dx !== 1) [dx, dy] = [-1, 0];
    else if (k === 'd' && dx !== -1) [dx, dy] = [1, 0];
    const nx = xs[0]! + dx;
    const ny = ys[0]! + dy;
    const crash =
      nx < 0 ||
      nx >= W ||
      ny < 0 ||
      ny >= H ||
      xs.some((x, i) => i < xs.length - 1 && x === nx && ys[i] === ny);
    if (crash) return { pixels, uart: uart + `game over! score ${score}\n`, score, ending: 'over' };
    const grow = nx === food[0] && ny === food[1];
    if (grow) {
      xs.push(0);
      ys.push(0);
    } else fill(xs.at(-1)!, ys.at(-1)!, BACKGROUND);
    for (let i = xs.length - 1; i > 0; i--) {
      xs[i] = xs[i - 1]!;
      ys[i] = ys[i - 1]!;
    }
    fill(xs[0]!, ys[0]!, BODY);
    xs[0] = nx;
    ys[0] = ny;
    fill(nx, ny, HEAD);
    if (grow) {
      score++;
      placeFood();
    }
  }
  return { pixels, uart, score, ending: 'waiting' };
}

/** Keys that eat the first n foods (vertical first, then across), from the start. */
const EAT_TWO = 'wwdddddddddddddddddddddddssssssssssaaaaaaaaaaaaaaaaaaaaaaa';

/** The game tests: name and keys typed. */
export const SNAKE_CASES: { name: string; keys: string }[] = [
  { name: 'quit at once', keys: 'q' },
  { name: 'other keys go straight on', keys: 'd.x d?dq' },
  { name: 'a turn straight back is ignored', keys: 'aaawq' },
  { name: 'into the wall', keys: 'wwwwwwwwwwwq' },
  { name: 'eat one', keys: 'wwddddddddddddddddddddddddq' },
  { name: 'eat four', keys: EAT_TWO + 'wwwwwwwwwwwwwddddddddddddddddddddddddddwwwaaq' },
  { name: 'bite yourself', keys: EAT_TWO + 'wdsq' },
];
