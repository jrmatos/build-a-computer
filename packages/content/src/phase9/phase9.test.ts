import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BIG_TEXT as KIT_BIG_TEXT, README as KIT_README, readDisk } from '@build-a-computer/os-kit';
import { runRiscvTest } from '@build-a-computer/rv-check';
import { Level } from '@build-a-computer/schema';
import { PHASE9_SOLUTIONS } from '../../solutions/phase9';
import { PHASE8_LEVELS } from '../phase8';
import type { RiscvTest } from '../phase6/common';
import { BIG_TEXT, OS_RAM_SIZE, PHASE8_LAST_REQUIRED_ID, README } from './common';
import { generate } from './gen-data';
import { PHASE9_LEVELS } from './index';
import { OS_DATA, SNAKE_SHA256 } from './os.data';
import { SNAKE_CASES, snakeModel } from './snake';

const ids = PHASE9_LEVELS.map((l) => l.id);
const riscv = (l: Level): RiscvTest[] => l.tests.filter((t): t is RiscvTest => t.kind === 'riscv');
const check = (source: string, t: RiscvTest, l: Level) => [...runRiscvTest(source, t, l)][0]!;

describe('Phase 9 data (os.data.ts, solutions.data.ts)', () => {
  it('is up to date with packages/os-kit (regenerate with UPDATE_OS_DATA=1)', () => {
    const g = generate();
    const dataFile = new URL('./os.data.ts', import.meta.url);
    const solFile = new URL('../../solutions/phase9/solutions.data.ts', import.meta.url);
    if (process.env['UPDATE_OS_DATA']) {
      writeFileSync(dataFile, g.data);
      writeFileSync(solFile, g.solutions);
    }
    expect(readFileSync(dataFile, 'utf8') === g.data, 'os.data.ts is stale').toBe(true);
    expect(readFileSync(solFile, 'utf8') === g.solutions, 'solutions.data.ts is stale').toBe(true);
  });

  it('text files match os-kit', () => {
    expect(README).toBe(KIT_README);
    expect(BIG_TEXT).toBe(KIT_BIG_TEXT);
  });

  it('snake hashes follow the model, and the cases score as designed', () => {
    for (const c of SNAKE_CASES)
      expect(SNAKE_SHA256[c.name], c.name).toBe(
        createHash('sha256').update(snakeModel(c.keys).pixels).digest('hex'),
      );
    const scores = Object.fromEntries(
      SNAKE_CASES.map((c) => [c.name, [snakeModel(c.keys).ending, snakeModel(c.keys).score]]),
    );
    expect(scores).toEqual({
      'quit at once': ['bye', 0],
      'other keys go straight on': ['bye', 0],
      'a turn straight back is ignored': ['bye', 0],
      'into the wall': ['over', 0],
      'eat one': ['bye', 1],
      'eat four': ['bye', 4],
      'bite yourself': ['over', 2],
    });
  });

  it('file-system disks hold the files the tests expect', () => {
    const disk = (id: string, name: string): Uint8Array => {
      const parts = OS_DATA[id]!.disks[name]!;
      const bytes = new Uint8Array(2048 * 512);
      for (const p of parts) bytes.set(Buffer.from(p.hex, 'hex'), p.sector * 512);
      return bytes;
    };
    expect(readDisk(disk('os-shell', 'os')).map((f) => f.name)).toEqual([
      'ls',
      'cat',
      'echo',
      'hello',
      'readme.txt',
      'kernel',
    ]);
    const big = readDisk(disk('os-file-system', 'cat')).find((f) => f.name === 'big.txt')!;
    expect(new TextDecoder().decode(big.data)).toBe(BIG_TEXT);
  });
});

describe('Phase 9 levels', () => {
  it('are 10 valid draft code levels in play order', () => {
    expect(PHASE9_LEVELS.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(ids).size).toBe(10);
    for (const l of PHASE9_LEVELS) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.phase, l.id).toBe(9);
      expect(l.draft, l.id).toBe(true);
      expect(l.mode, l.id).toBe('code');
      expect(l.code?.libc, l.id).toBe(false);
      expect(l.code?.ramSize, l.id).toBe(OS_RAM_SIZE);
      expect(riscv(l).length, l.id).toBeGreaterThanOrEqual(4);
      expect(l.hints.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.hints.length, l.id).toBeLessThanOrEqual(5);
      expect(l.tutorial.length, l.id).toBeGreaterThan(500);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
      expect(PHASE9_SOLUTIONS[l.id], l.id).toBeDefined();
      for (const t of riscv(l)) {
        expect(t.maxSteps, `${l.id}: ${t.name}`).toBeLessThanOrEqual(100_000_000);
        if (t.setup?.disk) expect(l.code?.devices, l.id).toContain('disk');
      }
    }
  });

  it(`start after the last required Phase 8 level ('${PHASE8_LAST_REQUIRED_ID}') and form a chain`, () => {
    const required = PHASE8_LEVELS.filter((l) => !l.optional);
    expect(required.at(-1)?.id).toBe(PHASE8_LAST_REQUIRED_ID);
    expect(PHASE9_LEVELS[0]!.requires).toEqual([PHASE8_LAST_REQUIRED_ID]);
    for (let i = 1; i < PHASE9_LEVELS.length; i++)
      expect(PHASE9_LEVELS[i]!.requires).toEqual([ids[i - 1]]);
  });

  it('the game checks the picture, the shell and file system the disk', () => {
    const level = (id: string) => PHASE9_LEVELS.find((l) => l.id === id)!;
    for (const t of riscv(level('os-final-game')))
      expect(t.expect.framebufferSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(level('os-final-game').code?.devices).toEqual(
      expect.arrayContaining(['framebuffer', 'keyboard']),
    );
    expect(level('os-preemption').code?.devices).toContain('timer');
  });

  for (const l of PHASE9_LEVELS) {
    it(`${l.id}: the reference passes every test`, () => {
      for (const t of riscv(l)) {
        const r = check(PHASE9_SOLUTIONS[l.id]!, t, l);
        expect(r.pass, `${t.name}: ${r.message} (${r.summary})`).toBe(true);
      }
    });

    it(`${l.id}: the starter builds and fails at least one test`, () => {
      const results = riscv(l).map((t) => check(l.code!.starter, t, l));
      expect(
        results.some((r) => /does not (assemble|compile)/.test(r.message ?? '')),
        l.id,
      ).toBe(false);
      expect(
        results.some((r) => !r.pass),
        l.id,
      ).toBe(true);
    });
  }
});

/**
 * OS-04: every checker catches a deliberately broken kernel. Each mutant is
 * the reference with one classic mistake; at least one test must fail.
 */
const MUTANTS: { id: string; what: string; from: string | RegExp; to: string }[] = [
  {
    id: 'os-bootloader',
    what: 'jumps to the load address',
    from: 'boot_jump(h->entry, 0, 0, 0)',
    to: 'boot_jump(h->load, 0, 0, 0)',
  },
  {
    id: 'os-bootloader',
    what: 'skips the checksum',
    from: 'if (sum != h->checksum) {',
    to: 'if (0) {',
  },
  {
    id: 'os-trap-vector',
    what: 'forgets to reset mscratch',
    from: /\n\s*csrw mscratch, t6[^\n]*/,
    to: '',
  },
  {
    id: 'os-trap-vector',
    what: 'stays on the user stack',
    from: /\n\s*lw\s+sp, 132\(t6\)[^\n]*/,
    to: '',
  },
  {
    id: 'os-system-calls',
    what: 'trusts a wrapping length',
    from: 'if (uva + n < uva)',
    to: 'if (0)',
  },
  {
    id: 'os-system-calls',
    what: 'returns nothing from write',
    from: 'ret = sys_write(a0, a1, a2);',
    to: 'sys_write(a0, a1, a2); ret = 0;',
  },
  {
    id: 'os-context-switch',
    what: 'always restarts the search at slot 0',
    from: 'start = slot(current) + 1;',
    to: 'start = 0;',
  },
  {
    id: 'os-preemption',
    what: 'never enables the timer interrupt',
    from: /\n\s*w_mie\(r_mie\(\) \| MIE_MTIE\);[^\n]*/,
    to: '',
  },
  {
    id: 'os-preemption',
    what: 'wakes sleepers early',
    from: '(int)(now - procs[i].wake) >= 0',
    to: '1',
  },
  {
    id: 'os-virtual-memory',
    what: 'ignores the user bit',
    from: ' || (*pte & PTE_U) == 0',
    to: '',
  },
  {
    id: 'os-page-allocator',
    what: 'hands out dirty pages',
    from: /\n\s*kmemset\(r, 0, PGSIZE\);/,
    to: '',
  },
  { id: 'os-page-allocator', what: 'loses count of free pages', from: /\n\s*nfree--;/, to: '' },
  {
    id: 'os-file-system',
    what: 'has no indirect blocks',
    from: 'if (bn >= NINDIRECT || ip->addrs[NDIRECT] == 0)',
    to: 'if (1)',
  },
  {
    id: 'os-file-system',
    what: 'compares names by their first letter',
    from: 'de.inum != 0 && name_is(de.name, name)',
    to: 'de.inum != 0 && de.name[0] == name[0]',
  },
  { id: 'os-shell', what: 'ignores exit', from: 'strcmp(words[0], "exit") == 0', to: '0' },
  {
    id: 'os-final-game',
    what: 'lets the snake turn straight back',
    from: "key == 'a' && dx != 1",
    to: "key == 'a'",
  },
];

describe('Phase 9 checkers catch broken kernels (OS-04)', () => {
  for (const m of MUTANTS) {
    it(`${m.id}: a kernel that ${m.what} fails`, () => {
      const l = PHASE9_LEVELS.find((x) => x.id === m.id)!;
      const ref = PHASE9_SOLUTIONS[m.id]!;
      const broken = ref.replace(m.from, m.to);
      expect(broken, 'the mutation applies').not.toBe(ref);
      expect(riscv(l).some((t) => !check(broken, t, l).pass)).toBe(true);
    }, 180_000); // a broken kernel may spin until its tests' step budgets run out
  }
});
