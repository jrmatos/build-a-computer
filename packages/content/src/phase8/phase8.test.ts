import { describe, expect, it } from 'vitest';
import { runRiscvTest } from '@build-a-computer/rv-check';
import { Level } from '@build-a-computer/schema';
import { PHASE8_SOLUTIONS } from '../../solutions/phase8';
import { referenceSource } from '../../solutions';
import { PHASE7_LEVELS } from '../phase7';
import type { RiscvTest } from '../phase6/common';
import { code, rv, u32 } from '../phase6/common';
import {
  HEAP_ROUNDS,
  PHASE7_LAST_REQUIRED_ID,
  clampSum,
  collatzModel,
  compileModel,
  functionsModel,
  pointersModel,
  reportLine,
  structsModel,
} from './common';
import { PHASE8_LEVELS } from './index';
import { COMPILER_EXPRESSIONS } from './phase8';

const ids = PHASE8_LEVELS.map((l) => l.id);
const level = (id: string): Level => PHASE8_LEVELS.find((l) => l.id === id)!;
const riscv = (l: Level): RiscvTest[] => l.tests.filter((t): t is RiscvTest => t.kind === 'riscv');

/** The checker result for one test. */
const check = (source: string, t: RiscvTest, l: Level) => [...runRiscvTest(source, t, l)][0]!;

/** Why the checker cannot judge `l` yet (the C toolchain is still a stub), or null. */
function pending(l: Level): string | null {
  const probe = check(
    l.code?.language === 'c' ? 'int main() { return 0; }' : 'ebreak',
    { kind: 'riscv', expect: {}, maxSteps: 1_000_000 },
    l,
  );
  if (!probe.pass && /not implemented/i.test(probe.message ?? ''))
    return 'C toolchain not implemented';
  return null;
}

/** First failing test of `source` on `l`, or null when all pass. */
function firstFailure(source: string, l: Level): string | null {
  for (const t of riscv(l)) {
    const r = check(source, t, l);
    if (!r.pass) return `${t.name}: ${r.message} (${r.summary ?? ''})`;
  }
  return null;
}

/** Integer value of an expression the compiler level accepts, with C's truncating / and %. */
function evaluate(src: string): number {
  let i = 0;
  const peek = () => src[i] ?? '';
  const ws = () => {
    while (peek() === ' ') i++;
  };
  const factor = (): number => {
    ws();
    let v = 0;
    if (peek() === '(') {
      i++;
      v = sum();
      ws();
      i++;
    } else while (/[0-9]/.test(peek())) v = v * 10 + Number(src[i++]);
    ws();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while ('*/%'.includes(peek()) && peek() !== '') {
      const op = src[i++];
      const w = factor();
      v = op === '*' ? Math.imul(v, w) : op === '/' ? Math.trunc(v / w) | 0 : (v % w) | 0;
    }
    return v;
  };
  const sum = (): number => {
    let v = term();
    while ('+-'.includes(peek()) && peek() !== '') {
      const op = src[i++];
      v = (op === '+' ? v + term() : v - term()) | 0;
    }
    return v;
  };
  return sum();
}

describe('Phase 8 levels', () => {
  it('are 8 valid draft code levels in play order; the last is optional', () => {
    expect(PHASE8_LEVELS.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(ids).size).toBe(8);
    for (const l of PHASE8_LEVELS) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.phase, l.id).toBe(8);
      expect(l.draft, l.id).toBe(true);
      expect(l.mode, l.id).toBe('code');
      expect(riscv(l).length, l.id).toBeGreaterThanOrEqual(4);
      expect(l.hints.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.hints.length, l.id).toBeLessThanOrEqual(5);
      expect(l.tutorial, l.id).toMatch(/```c\n/);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
      expect(PHASE8_SOLUTIONS[l.id], l.id).toBeDefined();
      expect(referenceSource(l), l.id).toBe(PHASE8_SOLUTIONS[l.id]);
    }
    expect(PHASE8_LEVELS.map((l) => l.optional)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('translate by hand in assembly, then write C', () => {
    expect(PHASE8_LEVELS[0]!.code?.language).toBe('rv32-asm');
    for (const l of PHASE8_LEVELS.slice(1)) {
      expect(l.code?.language, l.id).toBe('c');
      expect(l.code?.libc ?? true, l.id).toBe(true);
    }
  });

  it(`start after the last required Phase 7 level ('${PHASE7_LAST_REQUIRED_ID}') and form a chain`, () => {
    const required = PHASE7_LEVELS.filter((l) => !l.optional);
    expect(required.at(-1)?.id).toBe(PHASE7_LAST_REQUIRED_ID);
    expect(PHASE8_LEVELS[0]!.requires).toEqual([PHASE7_LAST_REQUIRED_ID]);
    for (let i = 1; i < PHASE8_LEVELS.length; i++)
      expect(PHASE8_LEVELS[i]!.requires).toEqual([ids[i - 1]]);
  });

  it('test models give the outputs worked out in the tutorials', () => {
    expect(clampSum([5, -3, 12, 7], 0, 10)).toBe(22);
    expect(collatzModel(6)).toEqual({ uart: '6 3 10 5 16 8 4 2 1\n', steps: 8 });
    expect(collatzModel(0)).toEqual({ uart: '0\n', steps: 0 });
    expect(collatzModel(27).steps).toBe(111);
    expect(functionsModel(12, 18, 2)).toEqual({
      uart: 'gcd(12, 18) = 6\ndisk 1: A -> B\ndisk 2: A -> C\ndisk 1: B -> C\n3 moves\n',
      moves: 3,
    });
    expect(functionsModel(1071, 462, 5).moves).toBe(31);
    expect(pointersModel([-5, -2, -9, -2])).toEqual({
      uart: 'swap: 2 1\nreversed: -2 -9 -2 -5\nmax: -2 at index 0\n',
      exitCode: 1,
    });
    expect(pointersModel([]).uart).toBe('swap: 2 1\nreversed: \nno max\n');
    expect(
      structsModel([
        [0, 0, 2, 2],
        [5, 5, 7, 7],
      ]).overlaps,
    ).toBe(0);
    expect(reportLine(1, 'hello world')).toBe(
      `1: "hello world" 11 chars, 2 words, first 'h', sum 0x45c, reversed "dlrow olleh"\n`,
    );
    expect(reportLine(2, '')).toBe('2: "" 0 chars, 0 words, sum 0x0, reversed ""\n');
    expect(compileModel('1 + 2')).toBe(
      'calc:\n' +
        '    li t0, 1\n    addi sp, sp, -4\n    sw t0, 0(sp)\n' +
        '    li t0, 2\n    addi sp, sp, -4\n    sw t0, 0(sp)\n' +
        '    lw t1, 0(sp)\n    lw t0, 4(sp)\n    addi sp, sp, 4\n    add t0, t0, t1\n    sw t0, 0(sp)\n' +
        '    lw a0, 0(sp)\n    addi sp, sp, 4\n    ret\n',
    );
    expect(evaluate('((1+2)*  (3 +4) )/ 2')).toBe(10);
    expect(HEAP_ROUNDS).toBeGreaterThan(0);
  });

  for (const l of PHASE8_LEVELS) {
    describe(l.id, () => {
      const why = pending(l);
      it.skipIf(why !== null)(
        `reference solution passes every test${why ? ` (skipped: ${why})` : ''}`,
        () => {
          expect(firstFailure(PHASE8_SOLUTIONS[l.id]!, l)).toBeNull();
        },
      );
      it.skipIf(why !== null)('the starter builds and fails at least one test', () => {
        const failure = firstFailure(l.code!.starter, l);
        expect(failure).not.toBeNull();
        expect(failure).not.toMatch(/does not (assemble|compile|build)/i);
      });
    });
  }

  it.skipIf(pending(level('c-heap')) !== null)(
    'the heap level reports a leak when free_list frees nothing',
    () => {
      const l = level('c-heap');
      const leaky = PHASE8_SOLUTIONS['c-heap']!.replace(
        /void free_list\(struct node \*head\) \{[^}]*\}\n\}/,
        'void free_list(struct node *head) {\n}',
      );
      expect(leaky).not.toBe(PHASE8_SOLUTIONS['c-heap']);
      const t = riscv(l)[0]!;
      const r = check(leaky, t, l);
      expect(r.pass).toBe(false);
      expect(r.message).toMatch(/leaked/);
    },
  );

  it("the compiler level's output assembles and computes the expression", () => {
    const runner = Level.parse({
      ...level('c-by-hand'),
      id: 'calc-runner',
      code: code({
        devices: [],
        library: [
          {
            name: 'run.s',
            text: '    .globl _start\n_start:\n    call calc\n    li a7, 93\n    ecall\n',
          },
        ],
      }),
    });
    for (const [name, expr] of Object.entries(COMPILER_EXPRESSIONS)) {
      const program = '    .globl calc\n' + compileModel(expr);
      const r = check(
        program,
        rv(name, undefined, { exitCode: u32(evaluate(expr)) }, 10_000),
        runner,
      );
      expect(r.pass, `${name}: ${r.message}`).toBe(true);
    }
  });
});
