import { describe, expect, it } from 'vitest';
import { levelById } from '@build-a-computer/content';
import { memoryStorage } from './db';
import type { Board, ChipDef, ChipMap } from '@build-a-computer/schema';
import { adoptSaveChips, decodeProgress, decodeSave, makeSave, sourceFor, sourceToSave } from './saves';
import { devLevelById } from '../code/devLevel';
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

describe('code level source', () => {
  const code = devLevelById('dev-code')!;
  it('round-trips the player source through a save', () => {
    const save = makeSave(code, code.starter, {}, new Date(0), sourceToSave(code, 'li a0, 1\n'));
    const d = decodeSave(JSON.parse(JSON.stringify(save)), code.id);
    expect(d.kind === 'ok' && d.save.source).toBe('li a0, 1\n');
    expect(sourceFor(code, d.kind === 'ok' ? d.save : null)).toBe('li a0, 1\n');
  });
  it('starts from the level starter without a save; board levels keep no source', () => {
    expect(sourceFor(code)).toBe(code.code!.starter);
    expect(sourceToSave(level, 'x')).toBeUndefined();
    expect('source' in makeSave(level, level.starter)).toBe(false);
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

describe('chips in saves', () => {
  const chipDef = (id: string, inner?: string, extra: Partial<ChipDef> = {}): ChipDef => ({
    id,
    name: id.toUpperCase(),
    version: 1,
    board: {
      parts: [
        { id: 's', type: 'switch', x: 0, y: 0, rot: 0, flip: false },
        { id: 'l', type: 'lamp', x: 6, y: 0, rot: 0, flip: false },
        ...(inner ? [{ id: 'i', type: 'chip' as const, chip: inner, x: 2, y: 4, rot: 0 as const, flip: false }] : []),
      ],
      wires: [],
    },
    ports: { inputs: ['s'], outputs: ['l'] },
    ...extra,
  });
  const uses = (id: string): Board => ({ parts: [{ id: 'c', type: 'chip', chip: id, x: 0, y: 0, rot: 0, flip: false }], wires: [] });

  it('embeds only the chips the board uses, transitively', () => {
    const chips: ChipMap = { a: chipDef('a', 'b'), b: chipDef('b'), c: chipDef('c') };
    const save = makeSave(level, uses('a'), chips);
    expect(Object.keys(save.chips).sort()).toEqual(['a', 'b']);
    expect(decodeSave(JSON.parse(JSON.stringify(save)), level.id).kind).toBe('ok');
  });

  it('E-SIM-05: the loader rejects a save whose chips contain themselves, naming them', () => {
    const save = { ...makeSave(level, uses('a')), chips: { a: chipDef('a', 'b'), b: chipDef('b', 'a') } };
    const d = decodeSave(JSON.parse(JSON.stringify(save)), level.id);
    expect(d.kind).toBe('invalid');
    expect(d.kind === 'invalid' && d.error).toMatch(/cannot contain itself: (A → B → A|B → A → B)/);
  });

  it('adopting a save merges its chips and re-points the board at re-ided ones', () => {
    const local: ChipMap = { a: chipDef('a', undefined, { name: 'Mine' }) };
    const save = makeSave(level, uses('a'), { a: chipDef('a', undefined, { name: 'Theirs' }) });
    const r = adoptSaveChips(local, save);
    const id = r.board.parts[0]!.chip!;
    expect(id).not.toBe('a');
    expect(r.chips[id]!.name).toBe('Theirs');
    expect(r.chips.a!.name).toBe('Mine');
  });
});
