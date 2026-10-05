import { describe, expect, it } from 'vitest';
import { Resource } from '@build-a-computer/schema';
import { LEVELS } from './full';
import { RESOURCES } from './resources';

const withResources = LEVELS.filter((l) => l.resources.length > 0);
const all = LEVELS.flatMap((l) => l.resources.map((r) => ({ level: l.id, r })));

describe('level resources (resource policy)', () => {
  it('E-RES-05: every resource records the title an agent saw and when', () => {
    for (const { level, r } of all) {
      expect(Resource.safeParse(r).success, `${level}: ${r.url}`).toBe(true);
      expect(r.verifiedTitle.trim(), `${level}: ${r.url}`).not.toBe('');
      const at = Date.parse(r.verifiedAt);
      expect(Number.isNaN(at), `${level}: ${r.url} verifiedAt`).toBe(false);
      expect(at, `${level}: ${r.url} verifiedAt is in the future`).toBeLessThanOrEqual(Date.now());
    }
  });

  it('E-RES-05: the raw resource map carries verifiedTitle and verifiedAt too', () => {
    for (const [id, list] of Object.entries(RESOURCES)) {
      for (const r of list) {
        expect(typeof r.verifiedTitle === 'string' && r.verifiedTitle.length > 0, `${id}: ${r.url}`).toBe(true);
        expect(typeof r.verifiedAt === 'string' && r.verifiedAt.length > 0, `${id}: ${r.url}`).toBe(true);
      }
    }
  });

  it('every key in the resource map is a real level id', () => {
    const ids = new Set(LEVELS.map((l) => l.id));
    expect(Object.keys(RESOURCES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('each level has at most 4 resources, and at least 2 with one tagged start-here when it has any', () => {
    for (const l of withResources) {
      expect(l.resources.length, l.id).toBeLessThanOrEqual(4);
      expect(l.resources.length, l.id).toBeGreaterThanOrEqual(2);
      expect(
        l.resources.filter((r) => r.tags.includes('start-here')).length,
        `${l.id} needs one start-here resource`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('links are https and a level never lists the same URL twice', () => {
    for (const l of withResources) {
      const urls = l.resources.map((r) => r.url);
      expect(new Set(urls).size, l.id).toBe(urls.length);
      for (const u of urls) expect(new URL(u).protocol, `${l.id}: ${u}`).toBe('https:');
    }
  });

  it('a URL shared between levels records the same verified title everywhere', () => {
    const seen = new Map<string, string>();
    for (const { level, r } of all) {
      const prev = seen.get(r.url);
      if (prev !== undefined) expect(r.verifiedTitle, `${level}: ${r.url}`).toBe(prev);
      else seen.set(r.url, r.verifiedTitle);
    }
  });

  it('E-RES-03: a differsNote, when present, is a short non-empty sentence', () => {
    for (const { level, r } of all) {
      if (r.differsNote === undefined) continue;
      expect(r.differsNote.trim().length, `${level}: ${r.url}`).toBeGreaterThan(0);
      expect(r.differsNote.length, `${level}: ${r.url}`).toBeLessThanOrEqual(200);
    }
  });
});
