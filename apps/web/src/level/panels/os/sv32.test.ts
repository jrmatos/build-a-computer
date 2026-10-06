import { describe, expect, it } from 'vitest';
import { branchTables, flagString, mergeRanges, PTE, rangeAt, satpRoot, walkTables } from './sv32';
import { evalConst, parseHeader } from './header';

const V = PTE.V, R = PTE.R, W = PTE.W, X = PTE.X, U = PTE.U, A = PTE.A, D = PTE.D; // prettier-ignore
const pte = (pa: number, flags: number) => (((pa >>> 12) << 10) | flags) >>> 0;

/** Root at 0x80100000 with one leaf table at 0x80101000 and a 4 MiB superpage. */
function fixture() {
  const rootPa = 0x8010_0000;
  const leafPa = 0x8010_1000;
  const root = new Uint32Array(1024);
  const leaf = new Uint32Array(1024);
  root[0] = pte(leafPa, V); // VA 0x00000000-0x003fffff -> leaf table
  root[0x200] = pte(0x8040_0000, V | R | W | U | A | D); // superpage at VA 0x80000000
  root[5] = pte(0x8020_0000, V | W); // W without R: reserved
  // code: three contiguous pages, then one with a PA gap, then data
  leaf[0x10] = pte(0x8030_0000, V | R | X | U | A | D);
  leaf[0x11] = pte(0x8030_1000, V | R | X | U | A | D);
  leaf[0x12] = pte(0x8030_2000, V | R | X | U | A | D);
  leaf[0x13] = pte(0x8030_9000, V | R | X | U | A | D);
  leaf[0x14] = pte(0x8030_a000, V | R | W | U | A | D);
  leaf[0x20] = pte(0x8030_b000, V | R | W | A | D); // guard: no U
  leaf[0x21] = 0x8030_c000 >>> 2; // not valid
  return { rootPa, leafPa, root, leaf };
}

describe('Sv32 walk and merge', () => {
  it('finds leaf tables, leaves, superpages and malformed entries', () => {
    const f = fixture();
    expect(branchTables(f.root)).toEqual([f.leafPa]);
    const w = walkTables(f.rootPa, f.root, new Map([[f.leafPa, f.leaf]]));
    expect(w.tables).toEqual([f.rootPa, f.leafPa]);
    expect(w.branches).toEqual([{ vpn1: 0, pte: f.root[0], table: f.leafPa, leaves: 6 }]);
    expect(w.leaves).toHaveLength(7);
    expect(w.leaves.find((l) => l.level === 1)).toMatchObject({ va: 0x8000_0000, pa: 0x8040_0000, pteAddr: f.rootPa + 0x200 * 4 });
    expect(w.leaves.find((l) => l.va === 0x14000)).toMatchObject({ pa: 0x8030_a000, pteAddr: f.leafPa + 0x14 * 4 });
    expect(w.bad).toEqual([{ pteAddr: f.rootPa + 20, pte: f.root[5], level: 1 }]);
  });

  it('merges runs contiguous in VA and PA with equal flags', () => {
    const f = fixture();
    const ranges = mergeRanges(walkTables(f.rootPa, f.root, new Map([[f.leafPa, f.leaf]])).leaves);
    expect(ranges.map((r) => [r.va, r.pa, r.count, flagString(r.flags)])).toEqual([
      [0x10000, 0x8030_0000, 3, 'DA-UX-RV'],
      [0x13000, 0x8030_9000, 1, 'DA-UX-RV'], // PA gap: a new range
      [0x14000, 0x8030_a000, 1, 'DA-U-WRV'], // flags differ
      [0x20000, 0x8030_b000, 1, 'DA---WRV'], // guard page
      [0x8000_0000, 0x8040_0000, 1, 'DA-U-WRV'],
    ]);
    expect(rangeAt(ranges, 0x12fff)?.va).toBe(0x10000);
    expect(rangeAt(ranges, 0x8000_0000 + 0x3f_ffff)?.level).toBe(1);
    expect(rangeAt(ranges, 0x15000)).toBeUndefined();
  });

  it('a missing leaf table is skipped, not guessed', () => {
    const f = fixture();
    const w = walkTables(f.rootPa, f.root, new Map());
    expect(w.leaves.map((l) => l.va)).toEqual([0x8000_0000]);
    expect(w.tables).toEqual([f.rootPa, f.leafPa]);
  });

  it('satp: root page only in Sv32 mode', () => {
    expect(satpRoot(0x8008_0123)).toBe(0x8012_3000);
    expect(satpRoot(0x0008_0123)).toBeNull();
  });
});

describe('kernel.h parser', () => {
  it('evaluates constant expressions over defines', () => {
    const d = new Map([['PGSIZE', 4096], ['TOP', 0x0100_0000], ['N', 2]]); // prettier-ignore
    expect(evalConst('(TOP - (N + 1) * PGSIZE)', d)).toBe(0x00ff_d000);
    expect(evalConst('0x80000000', d)).toBe(0x8000_0000);
    expect(evalConst('1 << 4 | 1', d)).toBe(17);
    expect(evalConst('SECTOR / 64', d)).toBeUndefined();
    expect(evalConst('f(x)', d)).toBeUndefined();
  });

  it('lays out structs with typedefs, pointers, arrays and nested structs (ILP32, natural alignment)', () => {
    const h = parseHeader(`
      typedef unsigned int uint;
      typedef unsigned char uchar;
      #define NFILE 2
      #define DIRSIZ (10 + 2)
      #define F(x) ((x) + 1)
      struct inner { uchar tag; uint v; };  /* 8 bytes */
      struct outer {
        char c;            // 0
        struct inner in;   // 4
        uint *p;           // 12
        char name[DIRSIZ]; // 16
        short s;           // 28
        struct inner arr[NFILE]; // 32
      };
      struct broken { mystery_t x; };
    `);
    const o = h.structs.get('outer')!;
    expect(o.fields.map((f) => [f.name, f.offset, f.size])).toEqual([
      ['c', 0, 1],
      ['in', 4, 8],
      ['p', 12, 4],
      ['name', 16, 12],
      ['s', 28, 2],
      ['arr', 32, 16],
    ]);
    expect(o.size).toBe(48);
    expect(h.structs.has('broken')).toBe(false);
    expect(h.defines.get('DIRSIZ')).toBe(12);
    expect(h.defines.has('F')).toBe(false);
  });
});
