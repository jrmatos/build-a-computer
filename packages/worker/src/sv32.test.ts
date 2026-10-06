import { describe, expect, it } from 'vitest';
import { sv32Translate } from './sv32';

const pte = (pa: number, flags: number) => (((pa >>> 12) << 10) | flags) >>> 0;

/** Root at 0x80001000, leaf table at 0x80002000. */
function memory() {
  const words = new Map<number, number>();
  words.set(0x8000_1000 + 0 * 4, pte(0x8000_2000, 0x1));
  words.set(0x8000_2000 + 0x10 * 4, pte(0x8000_5000, 0x1 | 0x2 | 0x8 | 0x10 | 0xc0)); // VA 0x10000: R X U
  words.set(0x8000_2000 + 0x11 * 4, pte(0x8000_6000, 0x1 | 0x2 | 0x4 | 0xc0)); // VA 0x11000: R W, no U
  words.set(0x8000_1000 + 0x200 * 4, pte(0x8040_0000, 0x1 | 0x2 | 0x4 | 0x10)); // 4 MiB superpage at 0x80000000
  words.set(0x8000_1000 + 0x201 * 4, pte(0x8040_1000, 0x1 | 0x2 | 0x10)); // misaligned superpage
  return (pa: number) => (pa >= 0x8000_0000 && pa < 0x8040_0000 ? (words.get(pa) ?? 0) : undefined);
}
const SATP = (0x8000_0000 | (0x8000_1000 >>> 12)) >>> 0;

describe('sv32Translate (side-effect-free MMU probe)', () => {
  it('translates through both levels and reports each PTE read', () => {
    const r = sv32Translate(memory(), SATP, 0x10abc, 'fetch');
    expect(r).toMatchObject({ ok: true, pa: 0x8000_5abc, level: 0 });
    expect(r.steps.map((s) => [s.level, s.pteAddr])).toEqual([
      [1, 0x8000_1000],
      [0, 0x8000_2040],
    ]);
  });

  it('raises the fault the CPU would: permissions, U bit, invalid, misaligned superpage', () => {
    const read = memory();
    expect(sv32Translate(read, SATP, 0x10000, 'store')).toMatchObject({ ok: false, cause: 15, why: 'noWrite' });
    expect(sv32Translate(read, SATP, 0x11000, 'load')).toMatchObject({ ok: false, cause: 13, why: 'notUser' });
    expect(sv32Translate(read, SATP, 0x12000, 'fetch')).toMatchObject({ ok: false, cause: 12, why: 'invalid' });
    expect(sv32Translate(read, SATP, 0x0040_0000, 'load')).toMatchObject({ ok: false, cause: 13, why: 'invalid' });
    expect(sv32Translate(read, SATP, 0x8040_0000, 'load')).toMatchObject({ ok: false, why: 'misaligned' });
    expect(sv32Translate(read, SATP, 0x8012_3456, 'store')).toMatchObject({ ok: true, pa: 0x8052_3456, level: 1 });
  });

  it('Bare mode and machine mode do not translate', () => {
    expect(sv32Translate(memory(), 0, 0x1234)).toMatchObject({ ok: true, pa: 0x1234, bare: true });
    expect(sv32Translate(memory(), SATP, 0x1234, 'load', 'M')).toMatchObject({ ok: true, bare: true });
  });
});
