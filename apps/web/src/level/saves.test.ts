import { describe, expect, it } from 'vitest';
import { levelById } from '@ground-up/content';
import { memoryStorage } from './db';
import { decodeProgress, decodeSave, makeSave } from './saves';
import { emptyProgress } from './progress';

const level = levelById('meet-nand')!;

describe('save validation', () => {
  it('accepts a current save', () => {
    const save = makeSave(level, level.starter);
    const d = decodeSave(JSON.parse(JSON.stringify(save)), level.id);
    expect(d).toEqual({ kind: 'ok', save, migrated: false });
  });
  it('refuses a newer save (E-DATA-04)', () => {
    const save = { ...makeSave(level, level.starter), version: 7 };
    expect(decodeSave(save, level.id)).toEqual({ kind: 'newer', found: 7 });
  });
  it('rejects garbage, wrong level and bad boards', () => {
    expect(decodeSave('nope', level.id).kind).toBe('invalid');
    expect(decodeSave({ version: 'x' }, level.id).kind).toBe('invalid');
    expect(decodeSave(makeSave(level, level.starter), 'other').kind).toBe('invalid');
    expect(decodeSave({ ...makeSave(level, level.starter), board: { parts: 3 } }, level.id).kind).toBe('invalid');
  });
  it('does not mutate the stored record (E-DATA-05)', () => {
    const raw = JSON.parse(JSON.stringify(makeSave(level, level.starter)));
    const copy = structuredClone(raw);
    decodeSave(raw, level.id);
    expect(raw).toEqual(copy);
  });
  it('decodes progress', () => {
    expect(decodeProgress(emptyProgress()).kind).toBe('ok');
    expect(decodeProgress({ ...emptyProgress(), version: 2 }).kind).toBe('newer');
    expect(decodeProgress({ kind: 'x' }).kind).toBe('invalid');
    expect(decodeProgress(undefined).kind).toBe('invalid');
  });
});

describe('memory storage (E-DATA-02)', () => {
  it('stores copies and falls through to the previous storage', async () => {
    const base = memoryStorage();
    await base.putSave('a', { v: 1 });
    const mem = memoryStorage(base);
    expect(await mem.getSave('a')).toEqual({ v: 1 });
    const obj = { v: 2 };
    await mem.putSave('a', obj);
    obj.v = 3;
    expect(await mem.getSave('a')).toEqual({ v: 2 });
    expect(await base.getSave('a')).toEqual({ v: 1 });
  });
});
