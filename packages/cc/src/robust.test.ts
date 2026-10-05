/**
 * The compiler never throws and never hangs, whatever the input: mutated
 * versions of real programs (tokens deleted, duplicated, swapped, garbage
 * inserted) must all come back with a result.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from './index';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../programs');
const prelude = readFileSync(join(dir, 'prelude.h'), 'utf8');
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.c') && !f.startsWith('fuzz'))
  .map((f) => readFileSync(join(dir, f), 'utf8'));

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const JUNK = ['{', '}', '(', ')', ';', ',', '*', '&', '[', ']', 'int', 'struct', '"', "'", '#', '#define', '\\', '=', '...', '->', '0x', '/*', 'if', 'else', 'case', ':', '?', 'sizeof', '__asm__', 'typedef'];

describe('robustness', () => {
  it('survives 400 mutated programs', () => {
    const rnd = prng(12345);
    let failures = 0;
    for (let n = 0; n < 400; n++) {
      const src = sources[Math.floor(rnd() * sources.length)] as string;
      const toks = src.split(/(\s+)/);
      const k = Math.floor(rnd() * 4);
      for (let m = 0; m <= k; m++) {
        const i = Math.floor(rnd() * toks.length);
        const r = rnd();
        if (r < 0.3) toks.splice(i, 1 + Math.floor(rnd() * 5));
        else if (r < 0.6) toks.splice(i, 0, JUNK[Math.floor(rnd() * JUNK.length)] as string);
        else if (r < 0.8) toks.splice(i, 0, ...toks.slice(i, i + 3));
        else toks.length = i; // truncate
      }
      const res = compile(toks.join(''), { headers: { 'prelude.h': prelude } });
      expect(typeof res.ok).toBe('boolean');
      if (res.diagnostics.some((d) => d.message.startsWith('internal compiler error'))) {
        failures++;
        console.log(res.diagnostics.find((d) => d.message.startsWith('internal'))?.message);
      }
    }
    expect(failures).toBe(0);
  }, 60_000);
});
