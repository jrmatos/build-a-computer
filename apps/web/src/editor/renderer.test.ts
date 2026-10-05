import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PART_TYPES, type Part, type Rotation } from '@ground-up/schema';
import { describe, expect, it } from 'vitest';
import { toWorld } from './geometry';
import { mix, PALETTES } from './palette';
import { GEOMETRY } from './parts';
import { bucketOf, findJunctions, partMatrix } from './renderer';

describe('partMatrix', () => {
  it('matches toWorld for every part type, rotation and flip', () => {
    for (const type of PART_TYPES) {
      for (const rot of [0, 90, 180, 270] as Rotation[]) {
        for (const flip of [false, true]) {
          const part: Part = { id: 'p', type, x: 7, y: -3, rot, flip };
          const [a, b, c, d, e, f] = partMatrix(part);
          const g = GEOMETRY[type];
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
