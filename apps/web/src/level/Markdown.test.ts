import { describe, expect, it } from 'vitest';
import { parseBlocks } from './Markdown';

describe('parseBlocks', () => {
  it('splits paragraphs and parses a pipe table', () => {
    const b = parseBlocks('Every part is built from NAND.\n\n| A | B | Y |\n|---|---|---|\n| 0 | 0 | 1 |\n| 1 | 1 | 0 |');
    expect(b).toEqual([
      { kind: 'p', text: 'Every part is built from NAND.' },
      { kind: 'table', head: ['A', 'B', 'Y'], rows: [['0', '0', '1'], ['1', '1', '0']] },
    ]);
  });

  it('parses lists and joins wrapped paragraph lines', () => {
    expect(parseBlocks('one\ntwo\n- a\n- b\n1. x')).toEqual([
      { kind: 'p', text: 'one two' },
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'ol', items: ['x'] },
    ]);
  });

  it('keeps fenced code verbatim', () => {
    expect(parseBlocks('Run this:\n```\n  LDI R0, 0 ; product\nloop: ADD R0, R1\n```\nThen test.')).toEqual([
      { kind: 'p', text: 'Run this:' },
      { kind: 'code', text: '  LDI R0, 0 ; product\nloop: ADD R0, R1' },
      { kind: 'p', text: 'Then test.' },
    ]);
  });

  it('treats a lone pipe line without a rule as text', () => {
    expect(parseBlocks('| not a table')).toEqual([{ kind: 'p', text: '| not a table' }]);
  });
});
