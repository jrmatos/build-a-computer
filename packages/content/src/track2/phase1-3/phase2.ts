import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../../define';
import { MODULES, base, code, eq, jsSetup, metric } from './common';

/**
 * Track 2, Phase 2 (Learning): a neuron, loss functions, gradient descent in
 * 1D, the chain rule by hand, and a tiny scalar autograd engine with a
 * gradient check. Plain JavaScript; the 'tensor' module is unlocked as a
 * convenience from here on. DRAFT text (owner approves). CNT-12.
 */

type Vec = number[];

// Models: the tests' expected values come from these.
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const dot = (a: Vec, b: Vec): number => a.reduce((s, x, i) => s + x * b[i]!, 0);
const neuron = (x: Vec, w: Vec, b: number): number => sigmoid(dot(x, w) + b);
const layer = (x: Vec, W: Vec[], b: Vec): Vec => W.map((w, i) => neuron(x, w, b[i]!));

const mse = (p: Vec, t: Vec): number => p.reduce((s, x, i) => s + (x - t[i]!) ** 2, 0) / p.length;
const EPS = 1e-7;
const bce = (p: Vec, y: Vec): number =>
  -p.reduce((s, x, i) => {
    const q = Math.min(Math.max(x, EPS), 1 - EPS);
    return s + y[i]! * Math.log(q) + (1 - y[i]!) * Math.log(1 - q);
  }, 0) / p.length;
function crossEntropy(logits: Vec, label: number): number {
  const m = Math.max(...logits);
  const lse = m + Math.log(logits.reduce((s, x) => s + Math.exp(x - m), 0));
  return lse - logits[label]!;
}

function descend(x0: number, lr: number, steps: number): { x: number; loss: number } {
  let x = x0;
  for (let i = 0; i < steps; i++) x -= lr * 2 * (x - 3);
  return { x, loss: (x - 3) ** 2 };
}
function fitSlope(xs: Vec, ys: Vec, lr: number, steps: number): number {
  let w = 0;
  for (let s = 0; s < steps; s++) {
    let g = 0;
    for (let i = 0; i < xs.length; i++) g += 2 * (w * xs[i]! - ys[i]!) * xs[i]!;
    w -= (lr * g) / xs.length;
  }
  return w;
}

function forwardBackward(x: number, w: number, b: number, y: number) {
  const a = sigmoid(w * x + b);
  const dz = 2 * (a - y) * a * (1 - a);
  return { loss: (a - y) ** 2, dw: dz * x, db: dz, dx: dz * w };
}
function twoLayer(x: number, w1: number, w2: number, y: number) {
  const h = Math.tanh(w1 * x);
  const out = w2 * h;
  const dout = 2 * (out - y);
  return { loss: (out - y) ** 2, dw2: dout * h, dw1: dout * w2 * (1 - h * h) * x };
}

function exprA(a: number, b: number) {
  const L = Math.tanh(a * b + b * b);
  return { value: L, da: (1 - L * L) * b, db: (1 - L * L) * (a + 2 * b) };
}
const exprB = (x: number) => (3 * x - 1 > 0 ? { value: (3 * x - 1) * x, dx: 6 * x - 1 } : { value: 0, dx: 0 });
const exprC = (x: number) => ({ value: x * x + x, dx: 2 * x + 1 });
function exprD(x1: number, x2: number, w1: number, w2: number, b: number) {
  const o = Math.tanh(x1 * w1 + x2 * w2 + b);
  const d = 1 - o * o;
  return { value: o, dx1: d * w1, dx2: d * w2, dw1: d * x1, dw2: d * x2, db: d };
}

const VALUE_STARTER = `// A Value holds one number and, after backward(), the gradient of the
// final result with respect to it.
export class Value {
  constructor(data, children = [], op = '') {
    this.data = data;
    this.grad = 0;
    this._children = children; // the Values this one was computed from
    this._backward = () => {}; // pushes this.grad into the children's grads
    this.op = op;
  }

  // Done for you: the sum, and how its gradient flows back (d(a+b)/da = 1).
  add(other) {
    other = other instanceof Value ? other : new Value(other);
    const out = new Value(this.data + other.data, [this, other], '+');
    out._backward = () => {
      this.grad += out.grad;
      other.grad += out.grad;
    };
    return out;
  }

  mul(other) {
    throw new Error('TODO: mul');
  }

  // this ** n, for a plain number n.
  pow(n) {
    throw new Error('TODO: pow');
  }

  tanh() {
    throw new Error('TODO: tanh');
  }

  relu() {
    throw new Error('TODO: relu');
  }

  neg() {
    return this.mul(-1);
  }

  sub(other) {
    return this.add(other instanceof Value ? other.neg() : -other);
  }

  // Set this.grad = 1, then call _backward on every Value in reverse topological order.
  backward() {
    throw new Error('TODO: backward');
  }
}

// Centered difference: the slope of f at xs along each coordinate.
// f takes an array of numbers and returns a number.
export function numericalGrad(f, xs, h = 1e-5) {
  return [];
}
`;

/** The level's check functions, appended to the starter and the reference (the tests call them). */
export const AUTOGRAD_CHECKS = `
// ---- Checks: the tests call these. Leave them as they are. ----

export function exprA(a, b) {
  const A = new Value(a), B = new Value(b);
  const L = A.mul(B).add(B.pow(2)).tanh();
  L.backward();
  return { value: L.data, da: A.grad, db: B.grad };
}

export function exprB(x) {
  const X = new Value(x);
  const y = X.mul(3).sub(1).relu().mul(X);
  y.backward();
  return { value: y.data, dx: X.grad };
}

export function exprC(x) {
  const X = new Value(x);
  const y = X.mul(X).add(X); // X is used three times: gradients must add up
  y.backward();
  return { value: y.data, dx: X.grad };
}

export function exprD(x1, x2, w1, w2, b) {
  const v = [x1, x2, w1, w2, b].map((n) => new Value(n));
  const o = v[0].mul(v[2]).add(v[1].mul(v[3])).add(v[4]).tanh();
  o.backward();
  return { value: o.data, dx1: v[0].grad, dx2: v[1].grad, dw1: v[2].grad, dw2: v[3].grad, db: v[4].grad };
}

// A small two-layer network as a function of its 9 parameters.
function net(p) {
  const x = [0.5, -1.5];
  const h1 = p[0].mul(x[0]).add(p[1].mul(x[1])).add(p[2]).tanh();
  const h2 = p[3].mul(x[0]).add(p[4].mul(x[1])).add(p[5]).relu();
  const out = p[6].mul(h1).add(p[7].mul(h2)).add(p[8]);
  return out.sub(0.25).pow(2);
}

// Compares backward() with numericalGrad() on random parameters (seeded).
export function gradCheck() {
  let maxError = 0;
  const known = numericalGrad(([a, b]) => a * a * b, [3, -2]);
  for (const [i, want] of [-12, 9].entries()) maxError = Math.max(maxError, Math.abs((known[i] ?? NaN) - want));
  for (let trial = 0; trial < 5; trial++) {
    const xs = Array.from({ length: 9 }, () => Math.random() * 2 - 1);
    xs[5] = Math.abs(xs[5]) + 2.5; // keeps the relu input above 0.5, away from its kink
    const params = xs.map((n) => new Value(n));
    net(params).backward();
    const numeric = numericalGrad((ys) => net(ys.map((n) => new Value(n))).data, xs);
    for (let i = 0; i < xs.length; i++) maxError = Math.max(maxError, Math.abs(params[i].grad - (numeric[i] ?? NaN)));
  }
  return { maxError: Number.isFinite(maxError) ? maxError : 1e9 };
}
`;

export const PHASE2: Level[] = [
  defineLevel({
    ...base,
    phase: 2,
    id: 'a-neuron',
    order: 1,
    title: 'A neuron',
    goal: 'Write sigmoid, relu, a single neuron (a dot product plus a bias, squashed by sigmoid) and a layer of neurons that share the same inputs.',
    tutorial:
      'A neuron takes inputs x, multiplies each by a weight, adds them up with a bias b, and passes the total z through an activation function:\n\n' +
      '```\nz = w[0]*x[0] + w[1]*x[1] + ... + b = dot(w, x) + b\noutput = sigmoid(z) = 1 / (1 + exp(-z))\n```\n\n' +
      'Sigmoid squashes any number into (0, 1): very negative z gives about 0, very positive about 1, and z = 0 gives exactly 0.5. ' +
      'ReLU is the other common activation: relu(z) = max(0, z).\n\n' +
      'With the right weights one neuron computes a logic gate. Weights [20, 20] and bias -30 make an AND gate: only when both inputs are 1 is z positive (z = 10).\n\n' +
      'A layer is several neurons reading the same inputs. Store their weights as a matrix W with one row per neuron and their biases as a vector b:\n\n' +
      code(`
export const layer = (x, W, b) => W.map((w, i) => neuron(x, w, b[i]));
`) +
      '\n\nFrom this level on the `tensor` module is unlocked (see the library tab), but plain arrays are all you need here.',
    hints: [
      'sigmoid is one line: `1 / (1 + Math.exp(-z))`. relu is `Math.max(0, z)`.',
      'neuron(x, w, b) is `sigmoid(dot(x, w) + b)`. Write dot again, or copy it from the first level.',
      'layer returns one number per row of W: neuron(x, W[0], b[0]), neuron(x, W[1], b[1]), ...',
      'Near-complete:\n' +
        code(`
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const relu = (z) => Math.max(0, z);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const neuron = (x, w, b) => sigmoid(dot(x, w) + b);
export const layer = (x, W, b) => W.map((w, i) => neuron(x, w, b[i]));
`),
    ],
    afterword:
      'A single neuron draws one straight line (a hyperplane) through its input space and says which side a point is on. ' +
      'That is why one neuron can compute AND and OR but never XOR, which needs two lines: you will fix that in Phase 3 with a second layer.',
    js: jsSetup({
      starter: `export function sigmoid(z) {
  return 0;
}

export function relu(z) {
  return 0;
}

// sigmoid(w · x + b)
export function neuron(x, w, b) {
  return 0;
}

// One neuron per row of W, all reading x: returns [neuron(x, W[0], b[0]), ...].
export function layer(x, W, b) {
  return [];
}
`,
      modules: MODULES.tensor,
    }),
    tests: [
      eq('sigmoid(0)', 'sigmoid', [0], 0.5),
      eq('sigmoid(2)', 'sigmoid', [2], sigmoid(2)),
      eq('sigmoid(-1000)', 'sigmoid', [-1000], 0),
      eq('relu(-3)', 'relu', [-3], 0),
      eq('relu(2.5)', 'relu', [2.5], 2.5),
      eq('neuron, AND of 1 and 1', 'neuron', [[1, 1], [20, 20], -30], neuron([1, 1], [20, 20], -30)),
      eq('neuron, AND of 1 and 0', 'neuron', [[1, 0], [20, 20], -30], neuron([1, 0], [20, 20], -30)),
      eq('neuron, 3 inputs', 'neuron', [[0.5, -1, 2], [0.1, 0.4, -0.3], 0.2], neuron([0.5, -1, 2], [0.1, 0.4, -0.3], 0.2)),
      eq('layer of 3 neurons', 'layer', [[1, 2], [[0.5, -0.5], [1, 1], [-2, 0.25]], [0, -3, 1]], layer([1, 2], [[0.5, -0.5], [1, 1], [-2, 0.25]], [0, -3, 1])),
    ],
    requires: ['softmax'],
  }),

  defineLevel({
    ...base,
    phase: 2,
    id: 'loss-functions',
    order: 2,
    title: 'Loss functions',
    goal: 'Write mean squared error, binary cross-entropy and softmax cross-entropy: the numbers that say how wrong a prediction is.',
    tutorial:
      'Learning needs a single number that is small when the network is right and large when it is wrong. That number is the loss.\n\n' +
      'Mean squared error, for predicting numbers:\n\n' +
      '```\nmse(pred, target) = mean of (pred[i] - target[i])^2\n```\n\n' +
      'Binary cross-entropy, for a probability p of a yes/no label y (0 or 1):\n\n' +
      '```\nbce(p, y) = -mean of ( y[i]*log(p[i]) + (1 - y[i])*log(1 - p[i]) )\n```\n\n' +
      'It is the surprise of seeing the true label. Saying 0.99 when the answer is no costs log(1/0.01) ≈ 4.6. log(0) is -Infinity, so clamp p into [1e-7, 1 - 1e-7] first.\n\n' +
      'Cross-entropy for many classes takes logits (raw scores) and the index of the true class: it is -log(softmax(logits)[label]). ' +
      'Expanding the softmax gives a form that never overflows:\n\n' +
      '```\ncrossEntropy(logits, label) = logsumexp(logits) - logits[label]\nlogsumexp(x) = m + log(sum of exp(x[i] - m)),   m = max of x\n```\n\n' +
      code(`
const m = Math.max(...logits);
const lse = m + Math.log(logits.reduce((s, x) => s + Math.exp(x - m), 0));
`),
    hints: [
      'mse: sum the squared differences in a loop, then divide by the length.',
      'bce: clamp first, `const q = Math.min(Math.max(p[i], 1e-7), 1 - 1e-7)`, then add `y*log(q) + (1-y)*log(1-q)`; negate the mean at the end.',
      'crossEntropy([1000, 0], 1) must be 1000, not Infinity or NaN. Computing softmax and then log loses that; use logsumexp.',
      'Near-complete:\n' +
        code(`
export const mse = (p, t) => p.reduce((s, x, i) => s + (x - t[i]) ** 2, 0) / p.length;
export function bce(p, y) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = Math.min(Math.max(p[i], 1e-7), 1 - 1e-7);
    s += y[i] * Math.log(q) + (1 - y[i]) * Math.log(1 - q);
  }
  return -s / p.length;
}
export function crossEntropy(logits, label) {
  const m = Math.max(...logits);
  return m + Math.log(logits.reduce((s, x) => s + Math.exp(x - m), 0)) - logits[label];
}
`),
    ],
    afterword:
      'Cross-entropy is the loss of every language model: the network outputs logits over the vocabulary and is scored by -log of the probability it gave the real next token. ' +
      'A uniform guess over V tokens costs log(V), a useful number to compare your first loss against.',
    js: jsSetup({
      starter: `// Mean of the squared differences.
export function mse(pred, target) {
  return 0;
}

// Binary cross-entropy of probabilities p against labels y (0 or 1). Clamp p to [1e-7, 1 - 1e-7].
export function bce(p, y) {
  return 0;
}

// -log(softmax(logits)[label]), computed without overflow.
export function crossEntropy(logits, label) {
  return 0;
}
`,
      modules: MODULES.tensor,
    }),
    tests: [
      eq('mse perfect', 'mse', [[1, 2, 3], [1, 2, 3]], 0),
      eq('mse', 'mse', [[1, 2, 3], [2, 2, 5]], mse([1, 2, 3], [2, 2, 5])),
      eq('bce', 'bce', [[0.9, 0.2, 0.6], [1, 0, 1]], bce([0.9, 0.2, 0.6], [1, 0, 1])),
      eq('bce, sure and wrong', 'bce', [[0], [1]], bce([0], [1])),
      eq('crossEntropy', 'crossEntropy', [[2, 1, 0.1], 0], crossEntropy([2, 1, 0.1], 0)),
      eq('crossEntropy, uniform over 4', 'crossEntropy', [[0, 0, 0, 0], 3], Math.log(4)),
      eq('crossEntropy, huge logits', 'crossEntropy', [[1000, 0], 1], crossEntropy([1000, 0], 1)),
    ],
    requires: ['a-neuron'],
  }),

  defineLevel({
    ...base,
    phase: 2,
    id: 'gradient-descent-1d',
    order: 3,
    title: 'Gradient descent in 1D',
    goal: 'Minimize f(x) = (x - 3)^2 by stepping downhill along its derivative, then use the same idea to fit the slope of a line to data.',
    tutorial:
      'The derivative f\'(x) is the slope of f at x. If it is positive, f goes up to the right, so a smaller x lowers f. Gradient descent takes a small step against the slope:\n\n' +
      '```\nx = x - lr * f\'(x)\n```\n\n' +
      'lr is the learning rate. For f(x) = (x - 3)^2 the derivative is f\'(x) = 2(x - 3), and the minimum is at x = 3.\n\n' +
      code(`
let x = x0;
for (let i = 0; i < steps; i++) x = x - lr * 2 * (x - 3);
`) +
      '\n\nToo small an lr crawls; too large overshoots. Here any lr above 1 makes every step land further away than the last: the loss explodes.\n\n' +
      'Fitting is the same thing. To fit y ≈ w·x to points (xs, ys), minimize the mean squared error L(w) = mean of (w·x[i] - y[i])^2. Its derivative is:\n\n' +
      '```\ndL/dw = mean of 2 * (w*x[i] - y[i]) * x[i]\n```\n\n' +
      'Start from w = 0 and step against that.',
    hints: [
      'descend returns an object: `{ x, loss: (x - 3) ** 2 }` after the loop.',
      'fitSlope: inside each step, sum 2 * (w*x[i] - y[i]) * x[i] over all points, divide by the number of points, then update w once.',
      'Do the whole sum with the current w before changing w. Updating w point by point is a different algorithm (stochastic descent) and gives different numbers.',
      'Near-complete:\n' +
        code(`
export function descend(x0, lr, steps) {
  let x = x0;
  for (let i = 0; i < steps; i++) x -= lr * 2 * (x - 3);
  return { x, loss: (x - 3) ** 2 };
}
export function fitSlope(xs, ys, lr, steps) {
  let w = 0;
  for (let s = 0; s < steps; s++) {
    let g = 0;
    for (let i = 0; i < xs.length; i++) g += 2 * (w * xs[i] - ys[i]) * xs[i];
    w -= lr * g / xs.length;
  }
  return w;
}
`),
    ],
    afterword:
      'Every network in this track learns this way: compute the loss, compute its derivative with respect to every weight, step downhill. ' +
      'The only hard part is the derivative when there are millions of weights. The next two levels solve that.',
    js: jsSetup({
      starter: `// f(x) = (x - 3)^2. Its derivative is 2 * (x - 3).

// Take \`steps\` gradient descent steps from x0 with learning rate lr.
// Return the final x and its loss f(x).
export function descend(x0, lr, steps) {
  let x = x0;
  // TODO: step downhill
  return { x, loss: (x - 3) ** 2 };
}

// Fit y ≈ w * x by gradient descent on the mean squared error, starting from w = 0.
export function fitSlope(xs, ys, lr, steps) {
  let w = 0;
  return w;
}
`,
      modules: MODULES.tensor,
    }),
    tests: [
      eq('descend(0, 0.1, 50)', 'descend', [0, 0.1, 50], descend(0, 0.1, 50)),
      eq('descend(10, 0.25, 20)', 'descend', [10, 0.25, 20], descend(10, 0.25, 20)),
      eq('descend(0, 0.5, 1): one perfect step', 'descend', [0, 0.5, 1], { x: 3, loss: 0 }),
      eq('descend(0, 1.1, 10): too large, diverges', 'descend', [0, 1.1, 10], descend(0, 1.1, 10), 1e-4),
      eq('fitSlope on y = 2x', 'fitSlope', [[1, 2, 3, 4], [2, 4, 6, 8], 0.02, 200], fitSlope([1, 2, 3, 4], [2, 4, 6, 8], 0.02, 200)),
      eq('fitSlope on noisy points', 'fitSlope', [[-1, 0.5, 2, 3], [-1.4, 0.6, 3.2, 4.4], 0.05, 100], fitSlope([-1, 0.5, 2, 3], [-1.4, 0.6, 3.2, 4.4], 0.05, 100)),
    ],
    requires: ['loss-functions'],
  }),

  defineLevel({
    ...base,
    phase: 2,
    id: 'chain-rule',
    order: 4,
    title: 'The chain rule by hand',
    goal: 'Compute the loss of a neuron and of a two-weight network, and the derivative of that loss with respect to every weight, by applying the chain rule step by step.',
    tutorial:
      'A network is a chain of simple steps. For one sigmoid neuron with squared error:\n\n' +
      '```\nz = w*x + b\na = sigmoid(z)\nL = (a - y)^2\n```\n\n' +
      'The chain rule says: the derivative of L with respect to an early variable is the product of the local derivatives along the way. Go backward from L:\n\n' +
      '```\ndL/da = 2(a - y)\ndL/dz = dL/da * da/dz = dL/da * a(1 - a)      (sigmoid\'s derivative is a(1 - a))\ndL/dw = dL/dz * x       dL/db = dL/dz * 1       dL/dx = dL/dz * w\n```\n\n' +
      'Compute the forward values first and keep them: the backward pass reuses a, and every gradient reuses dL/dz. ' +
      'The second function is two layers deep: h = tanh(w1*x), out = w2*h, L = (out - y)^2. The derivative of tanh is 1 - tanh^2.\n\n' +
      code(`
const h = Math.tanh(w1 * x);
const out = w2 * h;
const dout = 2 * (out - y);
// dL/dw2 = dout * h;  dL/dh = dout * w2;  dL/dw1 = dL/dh * (1 - h*h) * x
`),
    hints: [
      'Forward first: z, then a, then the loss. Then backward: dL/da, then dL/dz, then the three gradients.',
      'sigmoid\'(z) written in terms of its output a = sigmoid(z) is a * (1 - a). No exp needed in the backward pass.',
      'twoLayer: dL/dw1 multiplies four things: 2(out - y), w2, (1 - h^2) and x.',
      'Near-complete:\n' +
        code(`
export function forwardBackward(x, w, b, y) {
  const a = 1 / (1 + Math.exp(-(w * x + b)));
  const dz = 2 * (a - y) * a * (1 - a);
  return { loss: (a - y) ** 2, dw: dz * x, db: dz, dx: dz * w };
}
export function twoLayer(x, w1, w2, y) {
  const h = Math.tanh(w1 * x), out = w2 * h, dout = 2 * (out - y);
  return { loss: (out - y) ** 2, dw1: dout * w2 * (1 - h * h) * x, dw2: dout * h };
}
`),
    ],
    afterword:
      'You just ran backpropagation by hand. It is nothing more than the chain rule applied from the output backward, reusing each intermediate result once. ' +
      'Writing it out for every new network would be tedious and error prone, so next you will make the computer do it.',
    js: jsSetup({
      starter: `// z = w*x + b, a = sigmoid(z), L = (a - y)^2.
// Return the loss and dL/dw, dL/db, dL/dx.
export function forwardBackward(x, w, b, y) {
  return { loss: 0, dw: 0, db: 0, dx: 0 };
}

// h = tanh(w1*x), out = w2*h, L = (out - y)^2.
// Return the loss and dL/dw1, dL/dw2.
export function twoLayer(x, w1, w2, y) {
  return { loss: 0, dw1: 0, dw2: 0 };
}
`,
      modules: MODULES.tensor,
    }),
    tests: [
      eq('neuron, x=1 w=0.5 b=0 y=1', 'forwardBackward', [1, 0.5, 0, 1], forwardBackward(1, 0.5, 0, 1)),
      eq('neuron, x=-2 w=1.5 b=0.3 y=0', 'forwardBackward', [-2, 1.5, 0.3, 0], forwardBackward(-2, 1.5, 0.3, 0)),
      eq('neuron, x=3 w=-0.2 b=1 y=0.5', 'forwardBackward', [3, -0.2, 1, 0.5], forwardBackward(3, -0.2, 1, 0.5)),
      eq('two layers, x=1 w1=0.5 w2=2 y=1', 'twoLayer', [1, 0.5, 2, 1], twoLayer(1, 0.5, 2, 1)),
      eq('two layers, x=-0.7 w1=1.2 w2=-0.4 y=0.3', 'twoLayer', [-0.7, 1.2, -0.4, 0.3], twoLayer(-0.7, 1.2, -0.4, 0.3)),
    ],
    requires: ['gradient-descent-1d'],
  }),

  defineLevel({
    ...base,
    phase: 2,
    id: 'autograd',
    order: 5,
    title: 'An autograd engine',
    goal: 'Finish the Value class so that any expression built from add, mul, pow, tanh and relu can compute its own gradients with backward(), then prove it with a numerical gradient check.',
    tutorial:
      'Each Value remembers the Values it was made from and a small `_backward` function that knows the local derivative of its one operation. ' +
      'Calling backward() on the final result sets its grad to 1 and runs every `_backward` from the end to the start, so each one sees the finished gradient of its output.\n\n' +
      'The local rules, for out = ...:\n\n' +
      '```\na + b    a.grad += out.grad            b.grad += out.grad\na * b    a.grad += b.data * out.grad   b.grad += a.data * out.grad\na ** n   a.grad += n * a.data**(n-1) * out.grad\ntanh(a)  a.grad += (1 - out.data**2) * out.grad\nrelu(a)  a.grad += (out.data > 0 ? 1 : 0) * out.grad\n```\n\n' +
      'Always `+=`, never `=`: a Value used twice (x * x) receives gradient from both uses.\n\n' +
      'The order: a Value may only run its `_backward` after everything that uses it has. A depth-first topological sort gives exactly that:\n\n' +
      code(`
const topo = [], seen = new Set();
const build = (v) => {
  if (seen.has(v)) return;
  seen.add(v);
  for (const c of v._children) build(c);
  topo.push(v);
};
build(this);
`) +
      '\n\nHow do you know your gradients are right? Compare them with a numerical estimate. Nudge one input up and down by a tiny h and measure:\n\n' +
      '```\ndf/dx[i] ≈ ( f(x with x[i]+h) - f(x with x[i]-h) ) / (2h)\n```\n\n' +
      'The checks at the bottom of the file call your class and your numericalGrad; leave them unchanged. Gradient checks run in float64, where h = 1e-5 is accurate to about 1e-10.',
    hints: [
      'mul mirrors add: wrap a plain number in a Value, make `out = new Value(this.data * other.data, [this, other], \'*\')`, and set `out._backward`.',
      'tanh: compute `const t = Math.tanh(this.data)` once and use `(1 - t * t) * out.grad`. relu: `out.data > 0 ? out.grad : 0`.',
      'backward: build the topological order (see the tutorial), set `this.grad = 1`, then loop over `topo` from the last element to the first calling `v._backward()`.',
      'numericalGrad: for each i, copy xs into two arrays, add h to one and subtract h from the other, and push `(f(plus) - f(minus)) / (2 * h)`.',
      'Near-complete:\n' +
        code(`
mul(other) {
  other = other instanceof Value ? other : new Value(other);
  const out = new Value(this.data * other.data, [this, other], '*');
  out._backward = () => { this.grad += other.data * out.grad; other.grad += this.data * out.grad; };
  return out;
}
pow(n) {
  const out = new Value(this.data ** n, [this], '**');
  out._backward = () => { this.grad += n * this.data ** (n - 1) * out.grad; };
  return out;
}
backward() {
  const topo = [], seen = new Set();
  const build = (v) => { if (seen.has(v)) return; seen.add(v); v._children.forEach(build); topo.push(v); };
  build(this);
  this.grad = 1;
  for (let i = topo.length - 1; i >= 0; i--) topo[i]._backward();
}
`),
    ],
    afterword:
      'This is the whole idea behind PyTorch\'s autograd and JAX\'s grad, at the scale of single numbers. Real engines do the same thing with tensors as the nodes, ' +
      'so one node stands for millions of multiplications. From the next level on the `autograd` module gives you that, with the same backward().',
    js: jsSetup({
      starter: VALUE_STARTER + AUTOGRAD_CHECKS,
      modules: MODULES.tensor,
    }),
    tests: [
      eq('tanh(a*b + b^2) at a=2, b=-1', 'exprA', [2, -1], exprA(2, -1)),
      eq('tanh(a*b + b^2) at a=0.3, b=0.4', 'exprA', [0.3, 0.4], exprA(0.3, 0.4)),
      eq('relu(3x - 1) * x at x=2', 'exprB', [2], exprB(2)),
      eq('relu(3x - 1) * x at x=0.1', 'exprB', [0.1], exprB(0.1)),
      eq('x*x + x at x=3 (reuse)', 'exprC', [3], exprC(3)),
      eq('a tanh neuron', 'exprD', [2, 0, -3, 1, 6.8813735870195432], exprD(2, 0, -3, 1, 6.8813735870195432)),
      metric('gradient check: max error', 'gradCheck', [], { name: 'maxError', max: 1e-6 }, { seed: 7 }),
    ],
    requires: ['chain-rule'],
  }),
];
