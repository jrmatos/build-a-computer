import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { disassemble, disassembleWord, formatListing, toSource } from './disasm';
import { type Diagnostic, formatDiagnostic } from './diagnostics';
import { tokenize } from './lexer';
import { addressesForLine, build, lineForAddress, link } from './linker';

const words = (src: string, base = 0x80000000): number[] => {
  const r = build(src, { base });
  if (!r.ok) throw new Error(r.diagnostics.map(formatDiagnostic).join('\n'));
  return Array.from(new Uint32Array(r.image.buffer, r.image.byteOffset, r.image.length >> 2));
};

const errors = (src: string): Diagnostic[] => build(src).diagnostics as Diagnostic[];

/** The single error for `src`, with the text it underlines. */
function oneError(src: string): { message: string; line: number; col: number; text: string } {
  const ds = errors(src);
  expect(ds.map(formatDiagnostic)).toHaveLength(1);
  const d = ds[0] as Diagnostic;
  return { message: d.message, line: d.line, col: d.col, text: src.slice(d.from, d.to) };
}

describe('lexer (ASM-03 token API)', () => {
  it('classifies tokens by position and gives ranges', () => {
    const src = 'loop: addi a0, a0, %lo(x) # inc\n1: j 1b';
    const toks = tokenize(src).map((t) => [t.kind, t.text, t.line, t.col]);
    expect(toks).toEqual([
      ['label', 'loop', 1, 1],
      ['colon', ':', 1, 5],
      ['mnemonic', 'addi', 1, 7],
      ['register', 'a0', 1, 12],
      ['comma', ',', 1, 14],
      ['register', 'a0', 1, 16],
      ['comma', ',', 1, 18],
      ['reloc', '%lo', 1, 20],
      ['lparen', '(', 1, 23],
      ['symbol', 'x', 1, 24],
      ['rparen', ')', 1, 25],
      ['comment', '# inc', 1, 27],
      ['newline', '\n', 1, 32],
      ['localLabel', '1', 2, 1],
      ['colon', ':', 2, 2],
      ['mnemonic', 'j', 2, 4],
      ['localRef', '1b', 2, 6],
    ]);
    for (const t of tokenize(src)) expect(src.slice(t.from, t.to)).toBe(t.text);
  });

  it('reads directives, csr names, strings, chars, numbers and // comments', () => {
    const toks = tokenize('.ascii "a\\n" // c\ncsrr t0, mstatus; x = 0x1f + 017 + 0b11 + \'z\'');
    expect(toks.map((t) => t.kind)).toEqual([
      'directive', 'string', 'comment', 'newline',
      'mnemonic', 'register', 'comma', 'csr', 'newline',
      'label', 'equals', 'number', 'operator', 'number', 'operator', 'number', 'operator', 'char',
    ]); // prettier-ignore
    expect(toks[1]?.bytes).toEqual([97, 10]);
    expect(toks.filter((t) => t.kind === 'number').map((t) => t.value)).toEqual([31n, 15n, 3n]);
    expect(toks.at(-1)?.value).toBe(122n);
  });

  it('turns unreadable input into error tokens with messages', () => {
    const t = tokenize('.ascii "open\n');
    expect(t[1]?.kind).toBe('error');
    expect(t[1]?.message).toMatch(/unterminated string/);
    expect(tokenize('addi a0, a0, 12z')[5]?.kind).toBe('error');
  });
});

describe('assembler encodings', () => {
  it('assembles the basics', () => {
    expect(words('addi a0, zero, 5\nadd a0, a1, a2\nsw ra, 12(sp)\nlw t0, -4(s0)\necall')).toEqual([
      0x00500513, 0x00c58533, 0x00112623, 0xffc42283, 0x00000073,
    ]);
  });

  it('expands li with lui+addi rounding (0x800 needs lui 1 / addi -2048)', () => {
    expect(words('li a0, 0x800')).toEqual([0x00001537, 0x80050513]);
    expect(words('li a0, 0x12345678')).toEqual([0x12345537, 0x67850513]);
    expect(words('li a0, 0x80000000')).toEqual([0x80000537]);
    expect(words('li a0, -1')).toEqual([0xfff00513]);
    expect(words('li a0, 0xffffffff')).toEqual([0xfff00513]);
  });

  it('li with an address uses %hi/%lo', () => {
    expect(words('li a0, here\nhere: nop')).toEqual([0x80000537, 0x00850513, 0x00000013]);
  });

  it('resolves forward and backward local labels', () => {
    expect(words('1: j 1f\n j 1b\n1: nop')).toEqual([0x0080006f, 0xffdff06f, 0x00000013]);
  });

  it('uses .equ symbols defined after their use', () => {
    expect(words('addi a0, a0, N\n.equ N, 7')).toEqual([0x00750513]);
  });

  it('places the image at a custom base', () => {
    const r = build('_start: la a0, d\n.data\nd: .word d', { base: 0x1000 });
    expect(r.ok).toBe(true);
    expect(r.entry).toBe(0x1000);
    expect(Array.from(r.image.slice(8))).toEqual([0x08, 0x10, 0, 0]);
  });

  it('accepts semicolons as statement separators and /* */ comments', () => {
    expect(words('nop; nop /* two */\n/* multi\nline */ ret')).toEqual([0x13, 0x13, 0x00008067]);
  });
});

describe('errors point to line and column (ASM-01)', () => {
  it('unknown instruction, with a suggestion', () => {
    const e = oneError('nop\n  addd a0, a0, a1');
    expect(e).toMatchObject({ line: 2, col: 3, text: 'addd' });
    expect(e.message).toMatch(/unknown instruction 'addd'.*did you mean 'add'/);
  });

  it('immediate out of range underlines the operand', () => {
    const e = oneError('addi a0, a0, 4096');
    expect(e).toMatchObject({ line: 1, col: 14, text: '4096' });
    expect(e.message).toMatch(/out of range -2048..2047/);
  });

  it('bad register underlines the register', () => {
    const e = oneError('add a0, a9, a1');
    expect(e).toMatchObject({ col: 9, text: 'a9' });
    expect(e.message).toMatch(/expected a register/);
  });

  it('upper-case register gets a hint', () => {
    expect(oneError('add a0, A1, a1').message).toMatch(/lower case: a1/);
  });

  it('wrong operand count names the usage', () => {
    const e = oneError('addi a0, a1');
    expect(e).toMatchObject({ text: 'addi' });
    expect(e.message).toBe('addi expects 3 operands: addi rd, rs1, imm, found 2');
  });

  it('undefined symbol underlines the use', () => {
    const e = oneError('nop\nj nowhere');
    expect(e).toMatchObject({
      line: 2,
      col: 3,
      text: 'nowhere',
      message: "undefined symbol 'nowhere'",
    });
  });

  it('branch out of range', () => {
    const e = oneError('beq a0, a1, far\n.zero 8192\nfar: nop');
    expect(e.text).toBe('far');
    expect(e.message).toMatch(/branch target is too far away/);
  });

  it('duplicate label', () => {
    const e = oneError('x: nop\nx: nop');
    expect(e).toMatchObject({ line: 2, col: 1, message: "'x' is already defined on line 1" });
  });

  it('forward local label with no definition', () => {
    const e = oneError('j 1f');
    expect(e).toMatchObject({ text: '1f' });
    expect(e.message).toMatch(/no matching '1:'/);
  });

  it('backward local label with no definition', () => {
    expect(oneError('j 2b').message).toMatch(/there is none before it/);
  });

  it('unterminated string', () => {
    expect(oneError('.ascii "abc').message).toMatch(/unterminated string/);
  });

  it('non-zero data in .bss', () => {
    expect(oneError('.bss\n.word 1').message).toMatch(/holds only zeros/);
  });

  it('unknown directive with a suggestion', () => {
    expect(oneError('.wrod 1').message).toMatch(/did you mean '.word'/);
  });

  it('li constant wider than 32 bits', () => {
    expect(oneError('li a0, 0x100000000').message).toMatch(/does not fit in 32 bits/);
  });

  it('%hi in an I-type field', () => {
    expect(oneError('x: addi a0, a0, %hi(x)').message).toMatch(/%hi cannot be used here/);
  });

  it('reports every bad line, not just the first', () => {
    const ds = errors('addi a0, a0, 5000\nfoo a0\nlw a0, 0(a0)\nsub a0');
    expect(ds.map((d) => d.line)).toEqual([1, 2, 4]);
  });

  it('division by zero in an expression', () => {
    expect(oneError('.word 1 / 0').message).toBe('division by zero');
  });

  it('constants defined in terms of themselves', () => {
    expect(
      errors('.equ A, B\n.equ B, A\n.word A').some((d) => /in terms of itself/.test(d.message)),
    ).toBe(true);
  });
});

describe('linker (ASM-02)', () => {
  const a = assemble(
    '.globl _start\n.globl helper_ptr\n_start: call helper\nj _start\n.data\nhelper_ptr: .word helper',
    { file: 'a.s' },
  );
  const b = assemble('.globl helper\nhelper: li a0, 1\nret\n.bss\nbuf: .zero 16', { file: 'b.s' });

  it('links several objects through .globl symbols', () => {
    const r = link([a.object, b.object]);
    expect(r.diagnostics).toEqual([]);
    const sym = Object.fromEntries(r.symbols.map((s) => [s.name, s.address]));
    expect(sym).toEqual({
      _start: 0x80000000,
      helper: 0x8000000c,
      helper_ptr: 0x80000014,
      buf: 0x80000018,
    });
    expect(r.entry).toBe(0x80000000);
    expect(r.bss).toEqual({ start: 0x80000018, size: 16 });
    expect(r.end).toBe(0x80000028);
    expect(r.image.length).toBe(0x18);
    expect(r.sections.map((s) => s.name)).toEqual(['text', 'data', 'bss']);
  });

  it('keeps non-global labels private to their file', () => {
    const c = assemble('local: nop', { file: 'c.s' });
    const d = assemble('j local', { file: 'd.s' });
    const r = link([c.object, d.object]);
    expect(r.diagnostics.map(formatDiagnostic)).toEqual([
      "d.s:1:3: error: undefined symbol 'local'",
    ]);
  });

  it('rejects a global defined twice', () => {
    const c = assemble('.globl f\nf: ret', { file: 'c.s' });
    const d = assemble('.globl f\nf: ret', { file: 'd.s' });
    expect(link([c.object, d.object]).diagnostics[0]?.message).toMatch(/defined globally twice/);
  });

  it('maps addresses to source lines and lines to addresses', () => {
    const r = build('_start:\n  li a0, 0x12345678\n  nop\n.data\n  .word 1, 2');
    expect(lineForAddress(r.sourceMap, 0x80000004)).toMatchObject({
      line: 2,
      kind: 'code',
      size: 8,
    });
    expect(lineForAddress(r.sourceMap, 0x80000008)).toMatchObject({ line: 3 });
    expect(lineForAddress(r.sourceMap, 0x8000000c)).toMatchObject({ line: 5, kind: 'data' });
    expect(lineForAddress(r.sourceMap, 0x90000000)).toBeUndefined();
    expect(addressesForLine(r.sourceMap, 'main.s', 3)).toEqual([0x80000008]);
  });

  it('reports a missing explicit entry symbol', () => {
    expect(build('nop', { entry: 'main' }).diagnostics[0]?.message).toMatch(/entry symbol 'main'/);
  });
});

describe('disassembler (ASM-02)', () => {
  it('prints objdump-like text with ABI names and pseudo-instructions', () => {
    const pc = 0x80000000;
    const cases: [number, string, string][] = [
      [0x00500513, 'li a0, 5', 'addi a0, zero, 5'],
      [0x00000013, 'nop', 'addi zero, zero, 0'],
      [0x00008067, 'ret', 'jalr zero, 0(ra)'],
      [0x00c58533, 'add a0, a1, a2', 'add a0, a1, a2'],
      [0x00112623, 'sw ra, 12(sp)', 'sw ra, 12(sp)'],
      [0xfe0518e3, 'bnez a0, 0x7ffffff0', 'bne a0, zero, 0x7ffffff0'],
      [0x0080006f, 'j 0x80000008', 'jal zero, 0x80000008'],
      [0x30002573, 'csrr a0, mstatus', 'csrrs a0, mstatus, zero'],
      [0x30551073, 'csrw mtvec, a0', 'csrrw zero, mtvec, a0'],
      [0x12345537, 'lui a0, 0x12345', 'lui a0, 0x12345'],
      [0x0ff0000f, 'fence', 'fence iorw, iorw'],
      [0x06b6252f, 'amoadd.w.aqrl a0, a1, (a2)', 'amoadd.w.aqrl a0, a1, (a2)'],
      [0xffffffff, '.word 0xffffffff', '.word 0xffffffff'],
    ];
    for (const [w, pseudo, raw] of cases) {
      expect(disassembleWord(w, pc).text).toBe(pseudo);
      expect(disassembleWord(w, pc, { pseudo: false }).text).toBe(raw);
    }
  });

  it('lists with labels and target names', () => {
    const r = build('_start: j loop\nloop: j _start');
    const symbols = new Map(r.symbols.map((s) => [s.address, s.name]));
    const lines = disassemble(r.image, r.base, { symbols });
    expect(formatListing(lines, { symbols })).toBe(
      '80000000 <_start>:\n80000000:  0040006f   j 0x80000004 <loop>\n\n80000004 <loop>:\n80000004:  ffdff06f   j 0x80000000 <_start>\n',
    );
    expect(toSource(lines, { symbols })).toBe(
      '.text\n_start:\n    j 0x80000004  # <loop>\nloop:\n    j 0x80000000  # <_start>\n',
    );
  });
});
