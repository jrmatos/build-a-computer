/**
 * A development-only Track 2 level so the JavaScript workspace can be used
 * before the real Neuron-to-LLM levels ship. `?devjs=1` (or `#level=dev-js`)
 * opens it; production builds never see it (import.meta.env.DEV).
 *
 * Kept free of heavy imports: level/persist.ts (main chunk) imports it.
 */
import { Level } from '@build-a-computer/schema';

export const DEV_JS_LEVEL_ID = 'dev-js';

const HELPERS = `// helpers.js: read-only, comes with the level.
// Import it from main.js: import { sigmoid, dot } from './helpers.js';

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
`;

const STARTER = `// main.js: a single neuron that learns OR.
// Run calls predict(); Train calls train(steps) and plots what you report().
import { sigmoid, dot } from './helpers.js';

const X = [[0, 0], [0, 1], [1, 0], [1, 1]];
const Y = [0, 1, 1, 1];

export function predict(x = [1, 0]) {
  const w = [0.5, 0.5];
  return sigmoid(dot(w, x));
}

export function train(steps = 400, lr = 1.0) {
  let w = [0, 0];
  let b = 0;
  let loss = 0;
  let acc = 0;
  for (let step = 1; step <= steps; step++) {
    const gw = [0, 0];
    let gb = 0;
    loss = 0;
    acc = 0;
    for (let i = 0; i < X.length; i++) {
      const p = sigmoid(dot(w, X[i]) + b);
      loss -= Y[i] * Math.log(p) + (1 - Y[i]) * Math.log(1 - p);
      acc += (p > 0.5) === (Y[i] === 1) ? 1 : 0;
      const d = p - Y[i];
      gw[0] += d * X[i][0];
      gw[1] += d * X[i][1];
      gb += d;
    }
    loss /= X.length;
    acc /= X.length;
    w = [w[0] - lr * gw[0] / X.length, w[1] - lr * gw[1] / X.length];
    b -= lr * gb / X.length;
    globalThis.report?.({ step, loss, acc, total: steps });
    if (step % 50 === 0) globalThis.checkpoint?.({ step, w, b });
  }
  console.log('final weights', w, 'bias', b);
  return { loss, acc, w, b };
}
`;

let cached: Level | null = null;

/** The dev js level, or undefined for any other id and outside development. */
export function devJsLevelById(id: string): Level | undefined {
  if (!import.meta.env.DEV || id !== DEV_JS_LEVEL_ID) return undefined;
  cached ??= Level.parse({
    id: DEV_JS_LEVEL_ID,
    version: 1,
    track: 'neuron-to-llm',
    phase: 2,
    order: 99,
    title: 'Dev: JavaScript workspace',
    goal: 'Development level for the Track 2 workspace. Train a single neuron until it predicts OR with accuracy 1.',
    tutorial: 'Edit **main.js**. `helpers.js` is a read-only library file; the **API** tab lists the modules you can import.',
    palette: [],
    starter: { parts: [], wires: [] },
    mode: 'js',
    js: {
      starter: STARTER,
      modules: ['tensor', 'autograd', 'nn', 'optim', 'data'],
      datasets: [],
      library: [{ name: 'helpers.js', text: HELPERS }],
      training: true,
    },
    tests: [
      { kind: 'js', name: 'predict([1, 0])', entry: 'predict', args: [[1, 0]], expect: 0.6224593312, tolerance: 1e-6 },
      { kind: 'js', name: 'learns OR', entry: 'train', args: [400, 1.0], metric: { name: 'acc', min: 1 }, timeoutMs: 20_000 },
    ],
    draft: true,
  });
  return cached;
}

/** `?devjs=1` opens the dev js level (development only). */
export function devJsLevelFromUrl(url: URL): string | null {
  if (!import.meta.env.DEV) return null;
  return url.searchParams.get('devjs') ? DEV_JS_LEVEL_ID : null;
}
