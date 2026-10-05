import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEVELS as FULL } from './full';
import { LEVELS, levelById, loadLevel, loadedLevel } from './index';
import { catalogSource } from './gen-catalog';

const dataFile = new URL('./catalog.data.ts', import.meta.url);

describe('level catalog', () => {
  it('is up to date with the full levels (regenerate with UPDATE_CATALOG=1)', () => {
    const src = catalogSource();
    if (process.env['UPDATE_CATALOG']) writeFileSync(dataFile, src);
    expect(readFileSync(dataFile, 'utf8') === src, 'catalog.data.ts is stale').toBe(true);
    expect(LEVELS.map((l) => l.id)).toEqual(FULL.map((l) => l.id));
  });

  it('loadLevel gives every level exactly as the full module defines it', async () => {
    for (const l of FULL) {
      expect(await loadLevel(l.id)).toEqual(l);
      expect(loadedLevel(l.id)).toEqual(l);
    }
    expect(await loadLevel('no-such-level')).toBeUndefined();
    expect(levelById('no-such-level')).toBeUndefined();
  });
});
