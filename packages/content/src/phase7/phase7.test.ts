import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildProgram, createMachine, runRiscvTest } from '@build-a-computer/rv-check';
import { Level } from '@build-a-computer/schema';
import { PHASE7_SOLUTIONS } from '../../solutions/phase7';
import { PHASE6_LEVELS } from '../phase6';
import type { RiscvTest } from '../phase6/common';
import { FB_HEIGHT, FB_WIDTH, MISA, PHASE6_LAST_REQUIRED_ID, TIMER_PERIOD } from './common';
import { PHASE7_LEVELS } from './index';
import { FRAMEBUFFER_CASES, FRAMEBUFFER_SHA256, keyboardModel, trapModel } from './phase7';

const ids = PHASE7_LEVELS.map((l) => l.id);
const level = (id: string): Level => PHASE7_LEVELS.find((l) => l.id === id)!;
const riscv = (l: Level): RiscvTest[] => l.tests.filter((t): t is RiscvTest => t.kind === 'riscv');

/** The checker result for one test. */
const check = (source: string, t: RiscvTest, l: Level) => [...runRiscvTest(source, t, l)][0]!;

/** Why the checker cannot judge `l` yet, or null. */
function pending(l: Level): string | null {
  const probe = check('ebreak', { kind: 'riscv', expect: {}, maxSteps: 10 }, l);
  if (!probe.pass && /not implemented/i.test(probe.message ?? ''))
    return 'rv-check not implemented';
  if (l.code?.devices.includes('disk')) {
    const m = createMachine(buildProgram('ebreak', l), l);
    if (m.block.sectorCount === 0)
      return 'rv-check gives code levels no disk (block device has 0 sectors)';
  }
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

describe('Phase 7 levels', () => {
  it('are 8 valid draft code levels in play order', () => {
    expect(PHASE7_LEVELS.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(ids).size).toBe(8);
    for (const l of PHASE7_LEVELS) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.phase, l.id).toBe(7);
      expect(l.draft, l.id).toBe(true);
      expect(l.mode, l.id).toBe('code');
      expect(l.code?.devices.length, l.id).toBeGreaterThan(0);
      expect(riscv(l).length, l.id).toBeGreaterThanOrEqual(4);
      expect(l.hints.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.hints.length, l.id).toBeLessThanOrEqual(5);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
      expect(PHASE7_SOLUTIONS[l.id], l.id).toBeDefined();
    }
  });

  it('show the devices each level uses', () => {
    const devices = Object.fromEntries(PHASE7_LEVELS.map((l) => [l.id, l.code!.devices]));
    expect(devices['keyboard-polling']).toContain('keyboard');
    expect(devices['csr-timer']).toContain('timer');
    expect(devices['timer-interrupt']).toContain('timer');
    expect(devices['draw-framebuffer']).toContain('framebuffer');
    expect(devices['block-device']).toContain('disk');
  });

  it(`start after the last required Phase 6 level ('${PHASE6_LAST_REQUIRED_ID}') and form a chain`, () => {
    const required = PHASE6_LEVELS.filter((l) => !l.optional);
    expect(required.at(-1)?.id).toBe(PHASE6_LAST_REQUIRED_ID);
    expect(PHASE7_LEVELS[0]!.requires).toEqual([PHASE6_LAST_REQUIRED_ID]);
    for (let i = 1; i < PHASE7_LEVELS.length; i++)
      expect(PHASE7_LEVELS[i]!.requires).toEqual([ids[i - 1]]);
  });

  it('test expectations follow their models', () => {
    expect(keyboardModel('two\nlines\n')).toEqual({ uart: 'TWO\n', count: 3 });
    expect(keyboardModel('`az{@AZ[\n').uart).toBe('`AZ{@AZ[\n');
    expect(trapModel('A!B~C#D%E\n')).toEqual({ uart: 'ABCDE\n', faults: 4 });
    for (const t of riscv(level('csr-timer'))) expect(t.expect.regs?.['a1']).toBe(MISA);
    expect(TIMER_PERIOD).toBe(10_000);
  });

  it('framebuffer hashes match a model of the picture', () => {
    for (const c of FRAMEBUFFER_CASES) {
      const px = new Uint8Array(FB_WIDTH * FB_HEIGHT).fill(c.bg);
      for (let x = 0; x < FB_WIDTH; x++) px[x] = px[(FB_HEIGHT - 1) * FB_WIDTH + x] = 15;
      for (let y = 0; y < FB_HEIGHT; y++) px[y * FB_WIDTH] = px[y * FB_WIDTH + FB_WIDTH - 1] = 15;
      for (let y = 10; y < 10 + c.size; y++)
        for (let x = 10; x < 10 + c.size; x++) px[y * FB_WIDTH + x] = 12;
      expect(createHash('sha256').update(px).digest('hex'), c.name).toBe(
        FRAMEBUFFER_SHA256[c.name],
      );
    }
  });

  for (const l of PHASE7_LEVELS) {
    describe(l.id, () => {
      const why = pending(l);
      it.skipIf(why !== null)(
        `reference solution passes every test${why ? ` (skipped: ${why})` : ''}`,
        () => {
          expect(firstFailure(PHASE7_SOLUTIONS[l.id]!, l)).toBeNull();
        },
      );
      it.skipIf(why !== null)('the starter fails at least one test', () => {
        expect(firstFailure(l.code!.starter, l)).not.toBeNull();
      });
    });
  }

  it.skipIf(pending(level('trap-handler')) !== null)(
    'E-CPU-08: an all-zero word traps to the handler as an illegal instruction',
    () => {
      const l = level('trap-handler');
      const t = riscv(l).find((x) => x.name?.startsWith('E-CPU-08'))!;
      expect(check(PHASE7_SOLUTIONS[l.id]!, t, l).pass).toBe(true);
      // Without a handler the same program stops with an illegal-instruction message.
      const r = check('call run_program\n li a7, 93\n ecall\n', { ...t, input: '!' }, l);
      expect(r.pass).toBe(false);
      expect(r.message).toMatch(/illegal instruction/i);
    },
  );

  it.skipIf(pending(level('trap-handler')) !== null)(
    'E-CPU-05: a misaligned load reaches the handler, which skips it',
    () => {
      const l = level('trap-handler');
      const t = riscv(l).find((x) => x.name?.startsWith('E-CPU-05'))!;
      expect(check(PHASE7_SOLUTIONS[l.id]!, t, l).pass).toBe(true);
    },
  );

  it.skipIf(pending(level('trap-handler')) !== null)(
    'a handler that forgets mepc += 4 never finishes',
    () => {
      const l = level('trap-handler');
      const src = PHASE7_SOLUTIONS[l.id]!.replace(
        'addi t1, t1, 4       # resume after the trapping instruction',
        'addi t1, t1, 0',
      );
      const t = riscv(l).find((x) => x.name?.startsWith('E-CPU-08'))!;
      expect(check(src, { ...t, maxSteps: 50_000 }, l).message).toMatch(/never stopped/);
    },
  );

  it.skipIf(pending(level('timer-interrupt')) !== null)(
    'E-CPU-11: wfi with the timer never armed fails as waiting for an interrupt',
    () => {
      const l = level('timer-interrupt');
      const t = riscv(l).find((x) => x.expect.exitCode === 3)!;
      const r = check('    csrsi mstatus, 8\n    wfi\n    ebreak\n', t, l);
      expect(r.pass).toBe(false);
      expect(r.message).toMatch(/waiting \(wfi\).*never comes/);
    },
  );
});
