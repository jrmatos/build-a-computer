import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { disassemble, toSource } from './disasm';
import { formatDiagnostic } from './diagnostics';
import { build } from './linker';

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '../corpus');
const files = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.s'))
  .sort();

interface Golden {
  size: number;
  image: string[];
  symbols: Record<string, string>;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

function load(file: string): { source: string; golden: Golden } {
  const source = readFileSync(join(corpusDir, file), 'utf8');
  const golden = JSON.parse(
    readFileSync(join(corpusDir, 'golden', file.replace(/\.s$/, '.json')), 'utf8'),
  ) as Golden;
  return { source, golden };
}

describe('corpus matches GNU as/ld byte for byte (ASM-01)', () => {
  it('has a golden file for every corpus program', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  for (const file of files) {
    it(file, () => {
      const { source, golden } = load(file);
      const r = build(source, { file });
      expect(r.diagnostics.map(formatDiagnostic)).toEqual([]);
      expect(hex(r.image)).toBe(golden.image.join(''));
      expect(r.image.length).toBe(golden.size);
      const ours: Record<string, string> = {};
      for (const s of r.symbols)
        if (s.kind === 'label') ours[s.name] = `0x${s.address.toString(16).padStart(8, '0')}`;
      expect(ours).toEqual(golden.symbols);
    });
  }
});

describe('disassemble then reassemble is identical across the corpus (ASM-02)', () => {
  for (const file of files) {
    it(file, () => {
      const { source } = load(file);
      const first = build(source, { file });
      expect(first.ok).toBe(true);
      const symbols = new Map(
        first.symbols.filter((s) => s.kind === 'label').map((s) => [s.address, s.name]),
      );
      for (const pseudo of [true, false]) {
        const listing = toSource(disassemble(first.image, first.base, { symbols, pseudo }), {
          symbols,
        });
        const again = build(listing, { file: `${file}.dis` });
        expect(again.diagnostics.map(formatDiagnostic)).toEqual([]);
        expect(hex(again.image)).toBe(hex(first.image));
      }
    });
  }
});
