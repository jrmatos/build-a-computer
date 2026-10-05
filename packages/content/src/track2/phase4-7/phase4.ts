import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../../define';
import { MACBETH, PHASE3_LAST_ID, base, code, eq, jsSetup, metric } from './common';
import {
  bigramProbs,
  buildVocab,
  cosine,
  countBigrams,
  embed,
  embedBackward,
  encodeBpe,
  encodeChars,
  meanNll,
  randMat,
  trainBpe,
} from './models';

/**
 * Track 2, Phase 4 (Text): a character tokenizer, byte-pair encoding,
 * embedding tables and a counting bigram language model on Macbeth.
 * Plain JavaScript arrays; the bigram level loads the 'text-macbeth' dataset.
 * DRAFT text (owner approves).
 */

/** A line of Macbeth (Act V, Scene V), used as tokenizer test text. */
export const TOMORROW = 'Tomorrow, and tomorrow, and tomorrow, creeps in this petty pace from day to day';

const vocabCase = (text: string) => eq(`buildVocab(${JSON.stringify(text)})`, 'buildVocab', [text], buildVocab(text));

const bpeTrain = (text: string, n: number) => eq(`trainBpe(${text === TOMORROW ? 'a line of Macbeth' : JSON.stringify(text)}, ${n})`, 'trainBpe', [text, n], trainBpe(text, n));

const TABLE = randMat(41, 5, 3);
const DOUT = randMat(42, 3, 2);
const BIGRAM_IDS = [0, 1, 1, 2, 0, 1, 2, 2, 0];
const BIGRAM_COUNTS = countBigrams(BIGRAM_IDS, 3);

export const PHASE4: Level[] = [
  defineLevel({
    ...base,
    phase: 4,
    id: 'char-tokenizer',
    order: 1,
    title: 'Character tokenizer',
    goal: 'Turn text into numbers and back. Export buildVocab(text) (the sorted distinct characters), encode(vocab, text) (one id per character) and decode(vocab, ids).',
    tutorial:
      'A neural network only sees numbers, so text must become a list of integers first. That job is called tokenization, and the simplest tokenizer gives every distinct character its own id.\n\n' +
      'The vocabulary is the list of distinct characters, sorted so that the same text always gives the same ids. ' +
      "A character's id is its position in that list:\n\n" +
      '```\ntext   "hello"\nvocab  ["e", "h", "l", "o"]\nids    [1, 0, 2, 2, 3]\n```\n\n' +
      'A `Set` keeps one copy of each character, and `sort()` orders strings by character code (so capital letters come before small ones, and space and newline come first):\n\n' +
      code(`
const vocab = [...new Set('hello')].sort(); // ['e', 'h', 'l', 'o']
`) +
      '\n\nDecoding is the reverse: look each id up in the vocabulary and join the characters. ' +
      'For any text, `decode(vocab, encode(vocab, text))` must give the text back exactly.',
    hints: [
      'buildVocab is one line: spread a Set of the text into an array, then sort it.',
      'For encode, a Map from character to index avoids searching the vocabulary for every character: new Map(vocab.map((c, i) => [c, i])).',
      'Array.from(text, (c) => index.get(c)) walks the text one character at a time and maps each to its id.',
      'decode: ids.map((i) => vocab[i]).join("").',
    ],
    afterword:
      'Character-level models need no dictionary and never meet an unknown word, but their sequences are long: one token per letter. ' +
      'Real language models use bigger tokens built from pieces of words, which is the next level.',
    js: jsSetup({
      starter: `// Character tokenizer.

// The sorted list of distinct characters in text.
export function buildVocab(text) {
  // TODO
  return [];
}

// One id per character: its index in vocab.
export function encode(vocab, text) {
  // TODO
  return [];
}

// The text that ids stand for.
export function decode(vocab, ids) {
  // TODO
  return '';
}
`,
    }),
    tests: [
      vocabCase('hello'),
      vocabCase('Fair is foul, and foul is fair:\n'),
      vocabCase(''),
      eq('encode a line', 'encode', [buildVocab(TOMORROW), TOMORROW], encodeChars(buildVocab(TOMORROW), TOMORROW)),
      eq('encode spaces and newlines', 'encode', [['\n', ' ', 'a'], 'a a\n'], [2, 1, 2, 0]),
      eq('decode', 'decode', [['a', 'b', 'c'], [2, 0, 1, 1]], 'cabb'),
      eq('decode(encode(text)) is the text', 'decode', [buildVocab(TOMORROW), encodeChars(buildVocab(TOMORROW), TOMORROW)], TOMORROW),
    ],
    requires: [PHASE3_LAST_ID],
  }),
  defineLevel({
    ...base,
    phase: 4,
    id: 'bpe-tokenizer',
    order: 2,
    title: 'BPE tokenizer',
    goal:
      'Write byte-pair encoding. trainBpe(text, numMerges) returns the list of merged pairs; encodeBpe(text, merges) and decodeBpe(ids, merges) use them. ' +
      'Ids start as character codes (0-255); merge number m makes the new id 256 + m.',
    tutorial:
      'Byte-pair encoding (BPE) builds bigger tokens out of smaller ones. Start with one id per character (its character code), then repeat:\n\n' +
      '1. Count every pair of neighbouring ids.\n' +
      '2. Take the most frequent pair. If two pairs are tied, take the one that appears first in the text. If no pair appears at least twice, stop early.\n' +
      '3. Give the pair a new id (256 for the first merge, 257 for the next, ...) and replace every occurrence, left to right, without overlaps.\n\n' +
      'In `"aaabdaaabac"` the pair `a a` appears 4 times, so it becomes 256. Replacing left to right turns `a a a` into `256 a`:\n\n' +
      '```\nids      a a a b d a a a b a c\nmerge 1  256 a b d 256 a b a c        (a, a) -> 256\nmerge 2  257 b d 257 b a c            (256, a) -> 257\n```\n\n' +
      'Count pairs with a Map; a Map remembers insertion order, so the first pair you meet wins ties if you only replace the best on a strictly bigger count:\n\n' +
      code(`
const counts = new Map();
for (let i = 0; i + 1 < ids.length; i++) {
  const key = ids[i] + ',' + ids[i + 1];
  counts.set(key, (counts.get(key) || 0) + 1);
}
`) +
      '\n\nTo encode new text, start again from character codes and apply the merges in the order they were learned. To decode, expand each id ≥ 256 into its pair, recursively.',
    hints: [
      'Write a helper mergePair(ids, a, b, newId) that walks the list once: when ids[i] and ids[i + 1] are the pair, push newId and skip one extra position.',
      'trainBpe keeps the current ids and a merges list. Each round: count pairs, pick the best with count ≥ 2, push [a, b] and call mergePair with 256 + merges.length - 1.',
      'encodeBpe is the same loop without counting: merges.forEach(([a, b], m) => { ids = mergePair(ids, a, b, 256 + m); }).',
      'decodeBpe: const expand = (id) => id < 256 ? String.fromCharCode(id) : expand(merges[id - 256][0]) + expand(merges[id - 256][1]).',
    ],
    afterword:
      'GPT-2 uses this exact algorithm on the bytes of UTF-8 text with 50,000 merges, so common words become one token and rare words split into pieces. ' +
      'Tokenization explains many odd model behaviours, such as trouble counting letters: the model never sees the letters of a word that is a single token.',
    js: jsSetup({
      starter: `// Byte-pair encoding over character codes.

// The merged pairs, in the order they were learned: [[a, b], ...]. Merge m creates id 256 + m.
export function trainBpe(text, numMerges) {
  let ids = Array.from(text, (c) => c.charCodeAt(0));
  const merges = [];
  // TODO: numMerges times, find the most frequent pair (count >= 2) and merge it
  return merges;
}

// Character codes, then every merge in order.
export function encodeBpe(text, merges) {
  // TODO
  return [];
}

// Back to text.
export function decodeBpe(ids, merges) {
  // TODO
  return '';
}
`,
    }),
    tests: [
      bpeTrain('aaabdaaabac', 3),
      bpeTrain('abcd', 5),
      bpeTrain('to be or not to be', 4),
      bpeTrain(TOMORROW, 12),
      eq('encodeBpe("aaabdaaabac")', 'encodeBpe', ['aaabdaaabac', trainBpe('aaabdaaabac', 3)], encodeBpe('aaabdaaabac', trainBpe('aaabdaaabac', 3))),
      eq('encodeBpe with no merges gives character codes', 'encodeBpe', ['hello', []], [104, 101, 108, 108, 111]),
      eq('encodeBpe on new text', 'encodeBpe', ['tomorrow and today', trainBpe(TOMORROW, 12)], encodeBpe('tomorrow and today', trainBpe(TOMORROW, 12))),
      eq('decodeBpe(encodeBpe(text)) is the text', 'decodeBpe', [encodeBpe(TOMORROW, trainBpe(TOMORROW, 12)), trainBpe(TOMORROW, 12)], TOMORROW),
    ],
    requires: ['char-tokenizer'],
  }),
  defineLevel({
    ...base,
    phase: 4,
    id: 'token-embeddings',
    order: 3,
    title: 'Embeddings',
    goal:
      'Export embed(table, ids) (the rows of the table for each id), embedBackward(ids, dOut, vocabSize) (the gradient of the table) and cosine(a, b).',
    tutorial:
      'An id is just a name: token 7 is not "bigger" than token 3. So the first layer of a language model swaps every id for a learned vector, a row of an embedding table with one row per token:\n\n' +
      '```\ntable (vocabSize x dim)     ids [2, 0, 2]     embed -> [table[2], table[0], table[2]]\n```\n\n' +
      'This is the same as multiplying a one-hot vector by the table, without the multiplications. ' +
      'Training moves the rows so that tokens used in similar ways end up pointing in similar directions; cosine similarity measures that:\n\n' +
      code(`
cosine(a, b) = dot(a, b) / (norm(a) * norm(b))   // 1 same direction, 0 unrelated, -1 opposite
`) +
      '\n\nThe backward pass sends each output row\'s gradient back to the row it came from. A token that appears twice receives the sum of both gradients, and rows of tokens that did not appear get zeros:\n\n' +
      code(`
dTable[ids[row]][j] += dOut[row][j];
`),
    hints: [
      'embed: ids.map((id) => table[id].slice()). Copy the row so that changing the output never changes the table.',
      'embedBackward: start from vocabSize rows of zeros, each dOut[0].length long (0 when there are no rows).',
      'Use += in embedBackward, never =: repeated ids must add up.',
      'cosine needs three sums in one loop: a·b, a·a and b·b.',
    ],
    afterword:
      'Embedding rows are where a model stores what it knows about each token. In large models the embedding table alone holds hundreds of millions of numbers, ' +
      'and the famous "king - man + woman ≈ queen" arithmetic is cosine similarity on these rows.',
    js: jsSetup({
      starter: `// Embedding tables.

// The table's row for each id (copies).
export function embed(table, ids) {
  // TODO
  return [];
}

// Gradient of the loss with respect to the table: vocabSize rows, dOut[0].length columns.
export function embedBackward(ids, dOut, vocabSize) {
  // TODO
  return [];
}

// Cosine similarity of two vectors.
export function cosine(a, b) {
  // TODO
  return 0;
}
`,
    }),
    tests: [
      eq('embed([4, 0, 4])', 'embed', [TABLE, [4, 0, 4]], embed(TABLE, [4, 0, 4])),
      eq('embed of no ids', 'embed', [TABLE, []], []),
      eq('embedBackward adds repeated ids', 'embedBackward', [[1, 3, 1], DOUT, 4], embedBackward([1, 3, 1], DOUT, 4)),
      eq('embedBackward with no rows', 'embedBackward', [[], [], 3], [[], [], []]),
      eq('cosine of perpendicular vectors', 'cosine', [[1, 0], [0, 1]], 0),
      eq('cosine of parallel vectors', 'cosine', [[1, 2, 3], [2, 4, 6]], 1),
      eq('cosine of opposite vectors', 'cosine', [[1, -2], [-3, 6]], -1),
      eq('cosine of two table rows', 'cosine', [TABLE[1], TABLE[3]], cosine(TABLE[1]!, TABLE[3]!)),
    ],
    requires: ['bpe-tokenizer'],
  }),
  defineLevel({
    ...base,
    phase: 4,
    id: 'bigram-lm',
    order: 4,
    title: 'Bigram language model',
    goal:
      'Build the simplest language model: count which character follows which. Export countBigrams, bigramProbs (add-alpha smoothing), meanNll, and macbethBigram(alpha), ' +
      'which trains on the first 90% of Macbeth and returns { trainLoss, valLoss }. Get valLoss below 2.6.',
    tutorial:
      'A language model gives a probability to the next token. A bigram model looks only at the current token: P(next | current). ' +
      'Counting gives it directly: `counts[a][b]` is how many times `b` follows `a`, and dividing a row by its total gives probabilities.\n\n' +
      'A pair that never appears in training gets probability 0, and log(0) is minus infinity. Add-alpha smoothing adds `alpha` to every count before dividing:\n\n' +
      code(`
p[a][b] = (counts[a][b] + alpha) / (rowTotal + alpha * V)
`) +
      '\n\nThe loss is the mean negative log-likelihood of each next character, the same cross-entropy as in Phase 3:\n\n' +
      code(`
nll = -(1 / (N - 1)) * sum over i of log p[ids[i]][ids[i + 1]]
`) +
      '\n\nA model that guesses uniformly among 68 characters scores ln 68 ≈ 4.22. Load the text with the data module:\n\n' +
      code(`
import { load } from 'data';
const text = await load('text-macbeth'); // a string, about 100,000 characters
`) +
      '\n\n`load` returns a promise (the text arrives from outside the sandbox), so a function that uses it is `async` and the tests wait for its result. ' +
      'Use your character tokenizer on the whole text, train on the first 90% of the ids (`Math.floor(0.9 * ids.length)`) and measure the loss on both parts.',
    hints: [
      'countBigrams: a vocabSize x vocabSize array of zeros, then counts[ids[i]][ids[i + 1]]++ for every i up to ids.length - 2.',
      'bigramProbs: for each row, total = sum of the row + alpha * row.length; every entry becomes (c + alpha) / total.',
      'meanNll divides by ids.length - 1: that is the number of predictions.',
      'macbethBigram: vocab = [...new Set(text)].sort(), ids from it, n = Math.floor(ids.length * 0.9). Count on ids.slice(0, n) only, then meanNll on both slices.',
    ],
    afterword:
      'Validation loss near 2.47 is the best a bigram model can do here: knowing one character is not enough to predict the next. ' +
      'Everything that follows is about looking further back, and the transformer does it by letting every position attend to all the earlier ones.',
    js: jsSetup({
      datasets: [MACBETH],
      starter: `// A counting bigram language model.
import { load } from 'data';

// counts[a][b]: how often b follows a.
export function countBigrams(ids, vocabSize) {
  // TODO
  return [];
}

// Row-normalized probabilities with add-alpha smoothing.
export function bigramProbs(counts, alpha) {
  // TODO
  return [];
}

// Mean negative log-likelihood of each next id.
export function meanNll(probs, ids) {
  // TODO
  return 0;
}

// Train on the first 90% of Macbeth; loss on both parts.
export async function macbethBigram(alpha) {
  const text = await load('text-macbeth');
  // TODO
  return { trainLoss: NaN, valLoss: NaN };
}
`,
    }),
    tests: [
      eq('countBigrams', 'countBigrams', [BIGRAM_IDS, 3], BIGRAM_COUNTS),
      eq('countBigrams of one id', 'countBigrams', [[1], 2], [[0, 0], [0, 0]]),
      eq('bigramProbs, alpha = 1', 'bigramProbs', [BIGRAM_COUNTS, 1], bigramProbs(BIGRAM_COUNTS, 1)),
      eq('bigramProbs, alpha = 0.5', 'bigramProbs', [[[3, 1], [0, 0]], 0.5], bigramProbs([[3, 1], [0, 0]], 0.5)),
      eq('meanNll', 'meanNll', [bigramProbs(BIGRAM_COUNTS, 1), BIGRAM_IDS], meanNll(bigramProbs(BIGRAM_COUNTS, 1), BIGRAM_IDS)),
      metric('Macbeth validation loss < 2.6 (alpha = 1)', 'macbethBigram', [1], { name: 'valLoss', min: 2, max: 2.6 }, 30_000),
      metric('Macbeth training loss < 2.6 (alpha = 0.1)', 'macbethBigram', [0.1], { name: 'trainLoss', min: 2, max: 2.6 }, 30_000),
    ],
    requires: ['token-embeddings'],
  }),
];
