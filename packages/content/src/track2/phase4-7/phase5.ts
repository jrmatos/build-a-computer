import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../../define';
import { base, code, eq, jsSetup } from './common';
import {
  attention,
  attentionWeights,
  layerNorm,
  matmul,
  mlp,
  multiHeadAttention,
  positionalEncoding,
  randMat,
  randVec,
  randomBlock,
  residualMlp,
  selfAttention,
  transformerBlock,
  type Mat,
} from './models';

/**
 * Track 2, Phase 5 (Transformer): positional encoding, single-head
 * self-attention, the causal mask, multi-head attention, layer norm with
 * residuals, and the full pre-norm block. Plain JavaScript matrices (arrays
 * of rows); every test compares with the models in models.ts within 1e-6.
 * DRAFT text (owner approves).
 */

const X = randMat(51, 4, 6);
const WQ = randMat(52, 6, 4);
const WK = randMat(53, 6, 4);
const WV = randMat(54, 6, 4);
const Q = randMat(55, 5, 3);
const K = randMat(56, 5, 3);
const V = randMat(57, 5, 2);
/** Q, K and V with the last two positions replaced: causal outputs at positions 0-2 must not change. */
const futureChanged = (m: Mat, seed: number): Mat => [...m.slice(0, 3), ...randMat(seed, 2, m[0]!.length)];

const MH_X = randMat(61, 5, 8);
const MH = { Wq: randMat(62, 8, 8), Wk: randMat(63, 8, 8), Wv: randMat(64, 8, 8), Wo: randMat(65, 8, 8) };

const LN_X = randMat(71, 3, 4);
const LN_P = { gamma: [1, 0.5, 2, -1], beta: [0, 0.1, -0.2, 0.3], W1: randMat(72, 4, 8), b1: randVec(73, 8), W2: randMat(74, 8, 4), b2: randVec(75, 4) };

const BLOCK_X = randMat(81, 5, 8);
const BLOCK = randomBlock(8, 8);
const BLOCK2 = randomBlock(9, 8);

/** Helpers a player copies between levels: shown in the tutorials of this phase. */
const MATMUL = `
function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}
`;

export const PHASE5: Level[] = [
  defineLevel({
    ...base,
    phase: 5,
    id: 'positional-encoding',
    order: 1,
    title: 'Positional encoding',
    goal:
      'Export positionalEncoding(T, d): a T x d matrix with PE[pos][2i] = sin(pos / 10000^(2i/d)) and PE[pos][2i+1] = cos(pos / 10000^(2i/d)). ' +
      'Also export addPositions(x), which adds it to a T x d matrix of embeddings.',
    tutorial:
      'Attention, which you build next, compares every token with every other token, but it does not know their order: shuffle the inputs and the outputs shuffle the same way. ' +
      'So the model adds information about position to each embedding before the first layer.\n\n' +
      'The original transformer uses waves. Column pair (2i, 2i + 1) is a sine and a cosine of the position at one frequency, and the frequency falls as i grows:\n\n' +
      code(`
const angle = pos / Math.pow(10000, (2 * i) / d);
pe[pos][2 * i] = Math.sin(angle);
pe[pos][2 * i + 1] = Math.cos(angle);
`) +
      '\n\nThe first columns change fast, like the seconds hand of a clock; the last ones barely move, like the hours hand. Together they give each position a unique pattern, ' +
      'and a fixed offset between two positions is a rotation, which a layer can learn to read. Position 0 is always [0, 1, 0, 1, ...].',
    hints: [
      'Loop pos from 0 to T - 1 and i from 0 in steps of 2 up to d - 1; then the exponent is i / d (i is already 2 times the pair index).',
      'Both columns of a pair use the same angle: sin goes in column i, cos in column i + 1.',
      'addPositions: build positionalEncoding(x.length, x[0].length) and add it element by element.',
    ],
    afterword:
      'GPT-2 learns its position table instead (one more embedding table, indexed by position), and newer models rotate queries and keys (RoPE), ' +
      'which uses these same sines and cosines inside attention. The tiny GPT you train in Phase 6 learns its positions.',
    js: jsSetup({
      starter: `// Sinusoidal positional encoding.

// T rows, d columns: sin in even columns, cos in odd columns.
export function positionalEncoding(T, d) {
  // TODO
  return [];
}

// x (T x d) plus the positional encoding.
export function addPositions(x) {
  // TODO
  return x;
}
`,
    }),
    tests: [
      eq('positionalEncoding(1, 4)', 'positionalEncoding', [1, 4], [[0, 1, 0, 1]]),
      eq('positionalEncoding(4, 6)', 'positionalEncoding', [4, 6], positionalEncoding(4, 6)),
      eq('positionalEncoding(16, 8)', 'positionalEncoding', [16, 8], positionalEncoding(16, 8)),
      eq('addPositions', 'addPositions', [X], X.map((r, t) => r.map((v, j) => v + positionalEncoding(4, 6)[t]![j]!))),
    ],
    requires: ['bigram-lm'],
  }),
  defineLevel({
    ...base,
    phase: 5,
    id: 'self-attention',
    order: 2,
    title: 'Self-attention',
    goal: 'Export attention(Q, K, V) = softmax(Q Kᵀ / √d) V (softmax along each row, d = columns of K) and selfAttention(x, Wq, Wk, Wv) = attention(x Wq, x Wk, x Wv).',
    tutorial:
      'Attention lets every position gather information from other positions. Each position makes three vectors from its embedding:\n\n' +
      '- a query: what am I looking for?\n- a key: what do I contain?\n- a value: what do I pass on if someone attends to me?\n\n' +
      'Position t scores every position s by the dot product of its query with their key, turns the scores into weights with softmax, and takes the weighted average of the values:\n\n' +
      code(`
scores  = Q × Kᵀ / Math.sqrt(d)    // T x T: row t holds the scores of position t
weights = softmax of each row      // each row sums to 1
out     = weights × V              // T x dv
`) +
      '\n\nDividing by √d keeps the scores from growing with the vector size; without it, softmax saturates and its gradient vanishes. ' +
      'Q, K and V come from the same input x through three learned matrices, which is why it is called self-attention. You will need a matrix multiply:\n\n' +
      code(MATMUL),
    hints: [
      'Write transpose(A) and softmaxRows(S) as helpers. Subtract each row\'s maximum before Math.exp so large scores do not overflow.',
      'scores[t][s] = dot(Q[t], K[s]) / Math.sqrt(K[0].length). That is matmul(Q, transpose(K)) scaled.',
      'attention returns matmul(softmaxRows(scores), V).',
      'selfAttention is one line: attention(matmul(x, Wq), matmul(x, Wk), matmul(x, Wv)).',
    ],
    afterword:
      'This is the operation in the title "Attention Is All You Need". Each output row is a mix of value vectors chosen by content, not by distance, ' +
      'so a word can pull information from anywhere in the context in a single step.',
    js: jsSetup({
      starter: `// Scaled dot-product attention.

function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

// softmax(Q K^T / sqrt(d)) V
export function attention(Q, K, V) {
  // TODO
  return [];
}

// attention of x with itself, through three projections.
export function selfAttention(x, Wq, Wk, Wv) {
  // TODO
  return [];
}
`,
    }),
    tests: [
      eq('one position attends to itself', 'attention', [[[1, 2]], [[3, 4]], [[5, 6, 7]]], [[5, 6, 7]]),
      eq('equal keys give the mean of the values', 'attention', [[[1, 0], [0, 1]], [[1, 1], [1, 1]], [[2, 0], [4, 8]]], [[3, 4], [3, 4]]),
      eq('attention(Q, K, V)', 'attention', [Q, K, V], attention(Q, K, V)),
      eq('scores are scaled by sqrt(d)', 'attention', [Q.map((r) => r.map((v) => v * 4)), K, V], attention(Q.map((r) => r.map((v) => v * 4)), K, V)),
      eq('selfAttention(x, Wq, Wk, Wv)', 'selfAttention', [X, WQ, WK, WV], selfAttention(X, WQ, WK, WV)),
    ],
    requires: ['positional-encoding'],
  }),
  defineLevel({
    ...base,
    phase: 5,
    id: 'causal-mask',
    order: 3,
    title: 'Causal mask',
    goal:
      'Export causalWeights(Q, K): the T x T attention weights where position t only sees positions 0..t (weights above the diagonal are 0), and causalAttention(Q, K, V) = causalWeights(Q, K) V.',
    tutorial:
      'A language model predicts each next token from the tokens before it. During training it sees the whole sequence at once, so attention must not peek: ' +
      'position t may use positions 0 to t, never t + 1 or later.\n\n' +
      'The mask sets the scores of future positions to minus infinity before softmax. exp(-∞) is 0, so they get exactly zero weight and the remaining weights still sum to 1:\n\n' +
      code(`
const score = s <= t ? dot(Q[t], K[s]) / Math.sqrt(d) : -Infinity;
`) +
      '\n\nThe weight matrix becomes lower-triangular: row 0 is [1, 0, 0, ...], since the first token can only look at itself. ' +
      'A quick test of a correct mask: change the last tokens and the outputs at earlier positions stay exactly the same.',
    hints: [
      'Build the weights row by row: Q.map((q, t) => ...). For each row, compute scores for all s, using -Infinity when s > t.',
      'Softmax as before: subtract the row maximum (always finite, because s = t is never masked), exponentiate, divide by the sum. Math.exp(-Infinity) is 0.',
      'causalAttention(Q, K, V) = matmul(causalWeights(Q, K), V).',
    ],
    afterword:
      'The mask is what makes a transformer a generator: every position is trained to predict its next token at the same time, ' +
      'so one sequence of 32 tokens gives 32 training examples in a single pass.',
    js: jsSetup({
      starter: `// Causal (masked) attention.

function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

// T x T weights; row t is zero after column t.
export function causalWeights(Q, K) {
  // TODO
  return [];
}

export function causalAttention(Q, K, V) {
  // TODO
  return [];
}
`,
    }),
    tests: [
      eq('causalWeights is lower-triangular', 'causalWeights', [Q, K], attentionWeights(Q, K, true)),
      eq('equal keys: row t averages t + 1 positions', 'causalWeights', [[[1], [1], [1]], [[2], [2], [2]]], [[1, 0, 0], [0.5, 0.5, 0], [1 / 3, 1 / 3, 1 / 3]]),
      eq('causalAttention(Q, K, V)', 'causalAttention', [Q, K, V], attention(Q, K, V, true)),
      eq(
        'changing future tokens leaves earlier outputs unchanged',
        'causalAttention',
        [futureChanged(Q, 58), futureChanged(K, 59), futureChanged(V, 60)],
        [...attention(Q, K, V, true).slice(0, 3), ...attention(futureChanged(Q, 58), futureChanged(K, 59), futureChanged(V, 60), true).slice(3)],
      ),
    ],
    requires: ['self-attention'],
  }),
  defineLevel({
    ...base,
    phase: 5,
    id: 'multi-head-attention',
    order: 4,
    title: 'Multi-head attention',
    goal:
      'Export multiHeadAttention(x, Wq, Wk, Wv, Wo, nHead): project x to Q, K and V, split their columns into nHead equal groups, run causal attention in each group, ' +
      'join the heads back side by side and multiply by Wo.',
    tutorial:
      'One attention can only make one kind of weighted average per position. Multi-head attention runs several smaller ones in parallel: one head may follow the previous letter, another the start of the word.\n\n' +
      'With d columns and nHead heads, each head gets d / nHead columns of Q, K and V:\n\n' +
      code(`
const hs = d / nHead;
const Qh = Q.map((row) => row.slice(h * hs, (h + 1) * hs)); // head h
`) +
      '\n\nEach head runs the causal attention of the previous level on its own slice. The head outputs are joined back into rows of d columns (head 0 first), ' +
      'and a last matrix Wo mixes what the heads found:\n\n' +
      code(`
out[t] = [...head0[t], ...head1[t], ...]   // then out × Wo
`) +
      '\n\nThe cost is the same as one big head: the heads just split the columns.',
    hints: [
      'Compute Q = matmul(x, Wq), K and V once, then slice columns per head; do not multiply per head.',
      'Reuse your causalAttention from the last level for each head.',
      'Join with x.map((_, t) => heads.flatMap((head) => head[t])): flatMap concatenates the rows of every head.',
      'The scale inside each head is 1 / Math.sqrt(hs), the head size, not d.',
    ],
    afterword: 'GPT-2 small has 12 heads of 64 columns in each of its 12 layers. Researchers have found heads that copy, heads that count brackets and heads that find the previous occurrence of a token.',
    js: jsSetup({
      starter: `// Multi-head causal self-attention.

function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

// Paste your causalAttention(Q, K, V) from the last level here.

export function multiHeadAttention(x, Wq, Wk, Wv, Wo, nHead) {
  // TODO: project, split columns into heads, attend, join, project with Wo
  return [];
}
`,
    }),
    tests: [
      eq('one head is causal attention then Wo', 'multiHeadAttention', [MH_X, MH.Wq, MH.Wk, MH.Wv, MH.Wo, 1], multiHeadAttention(MH_X, MH.Wq, MH.Wk, MH.Wv, MH.Wo, 1)),
      eq('two heads', 'multiHeadAttention', [MH_X, MH.Wq, MH.Wk, MH.Wv, MH.Wo, 2], multiHeadAttention(MH_X, MH.Wq, MH.Wk, MH.Wv, MH.Wo, 2)),
      eq('four heads', 'multiHeadAttention', [MH_X, MH.Wq, MH.Wk, MH.Wv, MH.Wo, 4], multiHeadAttention(MH_X, MH.Wq, MH.Wk, MH.Wv, MH.Wo, 4)),
      eq('first position: its own value, projected', 'multiHeadAttention', [MH_X.slice(0, 1), MH.Wq, MH.Wk, MH.Wv, MH.Wo, 4], matmul(matmul(MH_X.slice(0, 1), MH.Wv), MH.Wo)),
    ],
    requires: ['causal-mask'],
  }),
  defineLevel({
    ...base,
    phase: 5,
    id: 'layer-norm-residual',
    order: 5,
    title: 'Layer norm and residuals',
    goal:
      'Export layerNorm(x, gamma, beta, eps = 1e-5) over each row, gelu(v), mlp(x, W1, b1, W2, b2) = gelu(x W1 + b1) W2 + b2, ' +
      'and residualMlp(x, p) = x + mlp(layerNorm(x, p.gamma, p.beta), p.W1, p.b1, p.W2, p.b2).',
    tutorial:
      'Two tricks make deep transformers trainable.\n\n' +
      '**Layer norm** rescales each row (one position) to mean 0 and variance 1, then applies a learned scale `gamma` and shift `beta` per column:\n\n' +
      code(`
mean = average of the row;  variance = average of (v - mean)²
out[j] = (row[j] - mean) / Math.sqrt(variance + eps) * gamma[j] + beta[j]
`) +
      '\n\n**Residual connections** add a layer\'s input to its output: `x + f(x)`. The layer only has to learn a change, and the gradient has a direct path back through the `+`, ' +
      'so it does not fade through many layers. GPT normalizes before each layer (pre-norm): `x + f(layerNorm(x))`.\n\n' +
      'The feed-forward part (MLP) works on each position separately: a layer 4 times wider, GELU, and a layer back to the original width. GELU is a smooth ReLU; GPT-2 uses this approximation:\n\n' +
      code(`
gelu(v) = 0.5 * v * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (v + 0.044715 * v ** 3)))
`),
    hints: [
      'The variance divides by the row length (not length - 1), and eps goes inside the square root.',
      'mlp: h = matmul(x, W1), add b1[j] to column j, apply gelu to every entry; then matmul(h, W2) and add b2[j].',
      'residualMlp: y = mlp(layerNorm(x, p.gamma, p.beta), ...); return x.map((row, t) => row.map((v, j) => v + y[t][j])).',
    ],
    afterword: 'Without residuals and normalization, networks deeper than a handful of layers barely train. With them, people train hundreds of layers; the residual stream is the backbone every layer reads from and writes to.',
    js: jsSetup({
      starter: `// Layer norm, GELU MLP, residual connection.

function matmul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
}

export function layerNorm(x, gamma, beta, eps = 1e-5) {
  // TODO: per row, subtract the mean, divide by sqrt(variance + eps), scale by gamma, shift by beta
  return x;
}

export function gelu(v) {
  // TODO
  return v;
}

export function mlp(x, W1, b1, W2, b2) {
  // TODO
  return x;
}

export function residualMlp(x, p) {
  // TODO: x + mlp(layerNorm(x))
  return x;
}
`,
    }),
    tests: [
      eq('layerNorm with gamma 1 and beta 0', 'layerNorm', [[[1, 2, 3, 4], [10, 10, 10, 10]], [1, 1, 1, 1], [0, 0, 0, 0]], layerNorm([[1, 2, 3, 4], [10, 10, 10, 10]], [1, 1, 1, 1], [0, 0, 0, 0])),
      eq('layerNorm with gamma and beta', 'layerNorm', [LN_X, LN_P.gamma, LN_P.beta], layerNorm(LN_X, LN_P.gamma, LN_P.beta)),
      eq('gelu(1)', 'gelu', [1], 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * 1.044715))),
      eq('gelu(-3) is close to 0', 'gelu', [-3], -1.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (-3 - 0.044715 * 27)))),
      eq('mlp', 'mlp', [LN_X, LN_P.W1, LN_P.b1, LN_P.W2, LN_P.b2], mlp(LN_X, LN_P.W1, LN_P.b1, LN_P.W2, LN_P.b2)),
      eq('residualMlp', 'residualMlp', [LN_X, LN_P], residualMlp(LN_X, LN_P)),
    ],
    requires: ['multi-head-attention'],
  }),
  defineLevel({
    ...base,
    phase: 5,
    id: 'transformer-block',
    order: 6,
    title: 'The transformer block',
    goal:
      'Export transformerBlock(x, p, nHead): h = x + multi-head causal attention of layerNorm(x) (p.ln1, p.Wq, p.Wk, p.Wv, p.Wo); out = h + mlp(layerNorm(h)) (p.ln2, p.W1, p.b1, p.W2, p.b2). ' +
      'Also export transformer(x, blocks, nHead), which applies the blocks in order.',
    tutorial:
      'Everything in this phase fits into one block, the unit a GPT repeats:\n\n' +
      code(`
h   = x + attention(layerNorm1(x))   // tokens talk to each other
out = h + mlp(layerNorm2(h))         // each token thinks on its own
`) +
      '\n\nThe parameters come as one object:\n\n' +
      code(`
p = { ln1: { gamma, beta }, Wq, Wk, Wv, Wo, ln2: { gamma, beta }, W1, b1, W2, b2 }
`) +
      '\n\nA model is an embedding, positions, a stack of blocks, a final layer norm and a linear layer to vocabulary logits. ' +
      'Copy your functions from the earlier levels of this phase (each level has its own main.js) and assemble them.',
    hints: [
      'Bring over matmul, layerNorm, gelu, causal attention and multiHeadAttention. Pass p.Wq, p.Wk, p.Wv, p.Wo and nHead to multiHeadAttention.',
      'Both residual additions are element-wise: write add(A, B) = A.map((row, i) => row.map((v, j) => v + B[i][j])).',
      'The second layer norm is applied to h (after the first residual), not to x.',
      'transformer: blocks.reduce((h, p) => transformerBlock(h, p, nHead), x).',
    ],
    afterword:
      'That is a GPT block, the same one in GPT-2 and, with small changes, in today\'s large models. The rest is scale: more blocks, wider rows, more heads, more data. ' +
      'In Phase 6 you train a tiny one on Shakespeare.',
    js: jsSetup({
      starter: `// A pre-norm transformer block.

// Paste matmul, layerNorm, gelu, causal attention and multiHeadAttention here.

export function transformerBlock(x, p, nHead) {
  // TODO: h = x + MHA(ln1(x)); return h + MLP(ln2(h))
  return x;
}

export function transformer(x, blocks, nHead) {
  // TODO
  return x;
}
`,
    }),
    tests: [
      eq('one block, one head', 'transformerBlock', [BLOCK_X, BLOCK, 1], transformerBlock(BLOCK_X, BLOCK, 1)),
      eq('one block, two heads', 'transformerBlock', [BLOCK_X, BLOCK, 2], transformerBlock(BLOCK_X, BLOCK, 2)),
      eq('first position only', 'transformerBlock', [BLOCK_X.slice(0, 1), BLOCK, 2], transformerBlock(BLOCK_X.slice(0, 1), BLOCK, 2)),
      eq('two blocks', 'transformer', [BLOCK_X, [BLOCK, BLOCK2], 2], transformerBlock(transformerBlock(BLOCK_X, BLOCK, 2), BLOCK2, 2)),
    ],
    requires: ['layer-norm-residual'],
  }),
];
