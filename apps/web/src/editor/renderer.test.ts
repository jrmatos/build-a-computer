import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PART_TYPES, type Board, type ChipDef, type Part, type Rotation } from '@ground-up/schema';
import { describe, expect, it } from 'vitest';
import { toWorld } from './geometry';
import { mix, PALETTES } from './palette';
import { SpatialIndex } from './hit';
import { geomOf, setChipRegistry } from './parts';
import { bucketOf, findJunctions, formatValue, leadsOf, looksKey, partMatrix, wireWidths } from './renderer';

describe('partMatrix', () => {
  it('matches toWorld for every part type, rotation and flip', () => {
    for (const type of PART_TYPES) {
      for (const rot of [0, 90, 180, 270] as Rotation[]) {
        for (const flip of [false, true]) {
          const part: Part = { id: 'p', type, x: 7, y: -3, rot, flip };
          const [a, b, c, d, e, f] = partMatrix(part);
          const g = geomOf(part);
          const probes = [...g.pins.map((p) => [p.x, p.y] as const), [g.body.x, g.body.y] as const, [0.3, 1.7] as const];
          for (const [lx, ly] of probes) {
            const w = toWorld(part, lx, ly);
            expect(a * lx + c * ly + e).toBeCloseTo(w.x, 9);
            expect(b * lx + d * ly + f).toBeCloseTo(w.y, 9);
          }
        }
      }
    }
  });
});

describe('findJunctions', () => {
  it('marks points shared by two or more wires, once', () => {
    const paths = new Map([
      ['w1', [{ x: 3, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 0 }, { x: 10, y: 0 }]],
      ['w2', [{ x: 3, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 5 }, { x: 10, y: 5 }]],
      ['w3', [{ x: 20, y: 20 }, { x: 25, y: 20 }]],
    ]);
    const j = findJunctions(paths).map((p) => `${p.x},${p.y}`).sort();
    expect(j).toEqual(['3,1', '6,1']);
  });

  it('ignores a wire that revisits its own point', () => {
    const paths = new Map([['w1', [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }]]]);
    expect(findJunctions(paths)).toEqual([]);
  });
});

describe('signal buckets', () => {
  it('separates no value, 0, 1 and X', () => {
    expect([undefined, 0, 1, 2].map(bucketOf)).toEqual([0, 1, 2, 3]);
  });
});

describe('palette', () => {
  const css = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8');
  const block = (selector: string): string => {
    const start = css.indexOf(selector);
    return css.slice(start, css.indexOf('}', start));
  };
  const token = (text: string, name: string): string => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(text)![1]!.toLowerCase();

  it('keeps signal colors in sync with tokens.css', () => {
    for (const [theme, selector] of [
      ['light', ":root[data-theme='light']"],
      ['dark', ":root[data-theme='dark']"],
    ] as const) {
      const b = block(selector);
      const p = PALETTES[theme];
      expect(p.sig1).toBe(token(b, '--sig-1'));
      expect(p.sig0).toBe(token(b, '--sig-0'));
      expect(p.sigX).toBe(token(b, '--sig-x'));
      expect(p.board).toBe(token(b, '--board-bg'));
    }
  });

  it('mixes colors', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ff8000', 0.5)).toBe('#804000');
  });
});

describe('formatValue', () => {
  it('formats hex padded to the width, with ? for unknown nibbles', () => {
    expect(formatValue(0x2a, 0, 8)).toBe('0x2A');
    expect(formatValue(0x5, 0, 12)).toBe('0x005');
    expect(formatValue(0x2a, 0x0f, 8)).toBe('0x2?');
    expect(formatValue(0xdeadbeef, 0, 32)).toBe('0xDEADBEEF');
  });
  it('formats dec, signed and bin', () => {
    expect(formatValue(42, 0, 8, 'dec')).toBe('42');
    expect(formatValue(0xf6, 0, 8, 'signed')).toBe('-10');
    expect(formatValue(5, 0, 8, 'signed')).toBe('+5');
    expect(formatValue(0xffffffff, 0, 32, 'signed')).toBe('-1');
    expect(formatValue(0b1010, 0b0001, 4, 'bin')).toBe('101x');
    expect(formatValue(1, 1, 8, 'dec')).toBe('?');
  });
  it('masks values to the width', () => {
    expect(formatValue(0x1ff, 0, 8)).toBe('0xFF');
  });
});

describe('leadsOf', () => {
  it('gives every pin of every part type exactly one lead, starting at the pin', () => {
    for (const type of PART_TYPES) {
      const part: Part = { id: 'p', type, x: 0, y: 0, rot: 0, flip: false };
      const g = geomOf(part);
      const L = leadsOf(part);
      const seen = new Set<number>();
      for (let j = 0; j < L.length; j += 5) {
        const pin = g.pins[L[j]!]!;
        expect(seen.has(L[j]!)).toBe(false);
        seen.add(L[j]!);
        // One end of the lead is on the pin.
        const atStart = L[j + 1] === pin.x && L[j + 2] === pin.y;
        const atEnd = L[j + 3] === pin.x && L[j + 4] === pin.y;
        expect(atStart || atEnd, `${type}:${pin.name}`).toBe(true);
      }
      expect(seen.size, type).toBe(g.pins.length);
    }
  });
});

describe('looksKey (sprite cache key)', () => {
  it('changes with every prop that changes the drawing, and with chip versions', () => {
    const base: Part = { id: 'p', type: 'splitter', x: 0, y: 0, rot: 0, flip: false, props: { width: 8, chunk: 1 } };
    expect(looksKey(base)).not.toBe(looksKey({ ...base, props: { width: 8, chunk: 4 } }));
    expect(looksKey({ ...base, type: 'const', props: { value: 1 } })).not.toBe(looksKey({ ...base, type: 'const', props: { value: 2 } }));
    // Live values are overlays, so a switch's initial value does not split sprites.
    expect(looksKey({ ...base, type: 'switch', props: { width: 8, value: 1 } })).toBe(looksKey({ ...base, type: 'switch', props: { width: 8, value: 2 } }));
    const chip: Part = { id: 'c', type: 'chip', chip: 'k', x: 0, y: 0, rot: 0, flip: false };
    const def = (version: number, color: string): ChipDef => ({ id: 'k', name: 'K', version, color, board: { parts: [], wires: [] }, ports: { inputs: [], outputs: [] } });
    setChipRegistry({ k: def(1, '#112233') });
    const k1 = looksKey(chip);
    setChipRegistry({ k: def(2, '#112233') });
    const k2 = looksKey(chip);
    setChipRegistry({ k: def(2, '#445566') });
    expect(new Set([k1, k2, looksKey(chip)]).size).toBe(3);
    setChipRegistry({});
  });
});

describe('wireWidths', () => {
  it('marks wires between multi-bit pins as buses', () => {
    const board: Board = {
      parts: [
        { id: 's', type: 'switch', x: 0, y: 0, rot: 0, flip: false, props: { width: 8 } },
        { id: 'l', type: 'lamp', x: 6, y: 0, rot: 0, flip: false, props: { width: 8 } },
        { id: 'a', type: 'switch', x: 0, y: 6, rot: 0, flip: false },
        { id: 'b', type: 'lamp', x: 6, y: 6, rot: 0, flip: false },
      ],
      wires: [
        { id: 'bus', from: { part: 's', pin: 'out' }, to: { part: 'l', pin: 'in' }, points: [] },
        { id: 'bit', from: { part: 'a', pin: 'out' }, to: { part: 'b', pin: 'in' }, points: [] },
      ],
    };
    const { widths, buses } = wireWidths(new SpatialIndex(board));
    expect(widths.get('bus')).toBe(8);
    expect(widths.has('bit')).toBe(false);
    expect(buses.map((b) => b.id)).toEqual(['bus']);
  });
});
