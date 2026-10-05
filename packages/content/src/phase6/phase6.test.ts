import { describe, expect, it } from 'vitest';
import { Level } from '@build-a-computer/schema';
import { build } from '@build-a-computer/asm';
import { runRiscvTest } from '@build-a-computer/rv-check';
import { PHASE6_SOLUTIONS } from '../../solutions/phase6';
import { referenceSource } from '../../solutions';
import { HAND_ENCODED, encodeAddi } from './phase6';
import { PHASE5_LAST_ID, type RiscvTest } from './common';
import { PHASE6_LEVELS } from './index';

/** First failing case of `source` on `level`, or null when every test passes. */
function firstFailure(level: Level, source: string): string | null {
  for (const [k, t] of level.tests.entries()) {
    for (const r of runRiscvTest(source, t as RiscvTest, level)) {
      if (!r.pass) return `test ${k} (${(t as RiscvTest).name}): want ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)} ${r.message ?? ''}`;
    }
  }
  return null;
}

/** Why rv-check cannot run tests yet (its stub), or null when it can. */
function pendingReason(): string | null {
  const level = PHASE6_LEVELS[0]!;
  const [r] = [...runRiscvTest('ebreak', level.tests[0] as RiscvTest, level)];
  return r && /not implemented/i.test(r.message ?? '') ? 'rv-check runRiscvTest not implemented yet' : null;
}

const ids = PHASE6_LEVELS.map((l) => l.id);
const pending = pendingReason();

describe('Phase 6 levels', () => {
  it('are 8 valid draft code levels in play order, the last optional', () => {
    expect(PHASE6_LEVELS.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(ids).size).toBe(8);
    for (const l of PHASE6_LEVELS) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.phase, l.id).toBe(6);
      expect(l.mode, l.id).toBe('code');
      expect(l.draft, l.id).toBe(true);
      expect(l.code?.language, l.id).toBe('rv32-asm');
      expect(l.tutorial, l.id).toMatch(/```/);
      expect(l.hints.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.hints.length, l.id).toBeLessThanOrEqual(5);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
      expect(l.tests.length, l.id).toBeGreaterThanOrEqual(3);
      for (const t of l.tests) expect(t.kind === 'riscv' && t.name, l.id).toBeTruthy();
    }
    expect(PHASE6_LEVELS.map((l) => l.optional)).toEqual([false, false, false, false, false, false, false, true]);
  });

  it(`form a chain starting after '${PHASE5_LAST_ID}'`, () => {
    expect(PHASE6_LEVELS[0]!.requires).toEqual([PHASE5_LAST_ID]);
    for (let i = 1; i < PHASE6_LEVELS.length; i++) expect(PHASE6_LEVELS[i]!.requires).toEqual([ids[i - 1]]);
  });

  it('levels that print declare the uart device', () => {
    for (const l of PHASE6_LEVELS) {
      const prints = l.tests.some((t) => t.kind === 'riscv' && t.expect.uart !== undefined);
      expect(l.code!.devices.includes('uart'), l.id).toBe(prints);
    }
  });

  it('every level has a reference source, also through referenceSource()', () => {
    for (const l of PHASE6_LEVELS) {
      expect(PHASE6_SOLUTIONS[l.id], l.id).toBeTruthy();
      expect(referenceSource(l), l.id).toBe(PHASE6_SOLUTIONS[l.id]);
    }
  });

  it('starters, references and library files assemble', () => {
    for (const l of PHASE6_LEVELS) {
      for (const [what, src] of [
        ['starter', l.code!.starter],
        ['reference', PHASE6_SOLUTIONS[l.id]!],
      ] as const) {
        const r = build([{ name: 'main.s', text: src }, ...l.code!.library]);
        expect(r.diagnostics.map((d) => d.message), `${l.id} ${what}`).toEqual([]);
      }
    }
  });

  it('hand-encoded words match what the assembler produces', () => {
    for (const { asm, word } of HAND_ENCODED) {
      const r = build(asm);
      expect(r.ok, asm).toBe(true);
      expect(new DataView(r.image.buffer, r.image.byteOffset).getUint32(0, true), asm).toBe(word);
    }
  });

  it('encode-addi expectations match the assembler', () => {
    const cases: [string, number, number, number][] = [
      ['addi x1, x0, 5', 1, 0, 5],
      ['addi a0, a0, -1', 10, 10, -1],
      ['addi x31, x31, -2048', 31, 31, -2048],
      ['addi sp, sp, 2047', 2, 2, 2047],
    ];
    for (const [asm, rd, rs1, imm] of cases) {
      const r = build(asm);
      expect(new DataView(r.image.buffer, r.image.byteOffset).getUint32(0, true), asm).toBe(encodeAddi(rd, rs1, imm));
    }
  });

  describe.skipIf(pending !== null)(`run on the emulator${pending ? ` (skipped: ${pending})` : ''}`, () => {
    for (const l of PHASE6_LEVELS) {
      it(`E-RES-06: the starter of '${l.id}' fails at least one test`, () => {
        expect(firstFailure(l, l.code!.starter), l.id).not.toBeNull();
      });
      it(`the reference of '${l.id}' passes every test`, () => {
        expect(firstFailure(l, PHASE6_SOLUTIONS[l.id]!), l.id).toBeNull();
      });
    }

    /** Classic mistakes each level is meant to catch: the reference with one edit. */
    const MISTAKES: [id: string, what: string, from: string, to: string][] = [
      ['abi-names', 'swaps through s0', 'mv   t0, a0', 'mv   s0, a0'],
      ['array-sum-max', 'compares unsigned', 'bge  t1, t2, skip', 'bgeu t1, t2, skip'],
      ['array-sum-max', 'starts the max at 0', '    lw   t1, 0(a0)       # largest starts at the first word\n', ''],
      ['functions-stack', 'does not save ra', '    sw   ra, 12(sp)\n', ''],
      ['functions-stack', 'keeps the counter in t0 across the call', 'mv   a0, s0\n    call square', 'mv   t0, s0\n    mv   a0, s0\n    call square\n    mv   s0, t0'],
      ['functions-stack', 'does not restore sp', '    addi sp, sp, 16\n', ''],
      ['recursion', 'does not restore s1', '    lw   s1, 4(sp)\n', ''],
      ['strings-uart', "changes '`' and '{' too", "li   t3, 'a'", "li   t3, '`'"],
      ['encode-addi', 'forgets the opcode', '    ori  a0, a0, 0x13    # opcode OP-IMM, funct3 = 0\n', ''],
    ];
    for (const [id, what, from, to] of MISTAKES) {
      it(`a solution that ${what} fails '${id}'`, () => {
        const level = PHASE6_LEVELS.find((l) => l.id === id)!;
        const ref = PHASE6_SOLUTIONS[id]!;
        expect(ref.includes(from), `${id}: '${from}' not in the reference`).toBe(true);
        expect(firstFailure(level, ref.replace(from, to)), `${id}: ${what}`).not.toBeNull();
      });
    }
  });
});
