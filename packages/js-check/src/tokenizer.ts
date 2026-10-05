/**
 * The 'tokenizer' module for Track 2 levels: small, readable tokenizers the
 * player can use (or replace with their own) when a level unlocks it.
 */

/** Splits text into single characters; ids follow the sorted vocabulary. */
export class CharTokenizer {
  /** Characters by id. */
  readonly vocab: string[];
  private readonly ids: Map<string, number>;

  /** Builds the vocabulary from every distinct character of `text` (sorted by code point). */
  constructor(text: string) {
    this.vocab = [...new Set(Array.from(text))].sort();
    this.ids = new Map(this.vocab.map((c, i) => [c, i]));
  }

  /** Number of distinct tokens. */
  get size(): number {
    return this.vocab.length;
  }

  encode(text: string): number[] {
    return Array.from(text, (c) => {
      const id = this.ids.get(c);
      if (id === undefined) throw new RangeError(`CharTokenizer: '${c}' is not in the vocabulary.`);
      return id;
    });
  }

  decode(ids: ArrayLike<number>): string {
    let s = '';
    for (let i = 0; i < ids.length; i++) s += this.vocab[ids[i]!] ?? '�';
    return s;
  }
}

/** Splits text into words and punctuation; unknown words map to '<unk>' (id 0). */
export class WordTokenizer {
  readonly vocab: string[];
  private readonly ids: Map<string, number>;

  /** Keeps words seen at least `minCount` times (default 1), most frequent first. */
  constructor(text: string, minCount = 1) {
    const counts = new Map<string, number>();
    for (const w of splitWords(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
    const words = [...counts].filter(([, c]) => c >= minCount).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([w]) => w);
    this.vocab = ['<unk>', ...words];
    this.ids = new Map(this.vocab.map((w, i) => [w, i]));
  }

  get size(): number {
    return this.vocab.length;
  }

  encode(text: string): number[] {
    return splitWords(text).map((w) => this.ids.get(w) ?? 0);
  }

  /** Joins tokens with spaces (punctuation is not re-attached). */
  decode(ids: ArrayLike<number>): string {
    const out: string[] = [];
    for (let i = 0; i < ids.length; i++) out.push(this.vocab[ids[i]!] ?? '<unk>');
    return out.join(' ');
  }
}

/** Lower-cases and splits into words (letters, digits, apostrophes) and single punctuation marks. */
export function splitWords(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}']/gu) ?? [];
}
