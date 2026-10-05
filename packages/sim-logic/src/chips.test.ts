import { describe, expect, it } from 'vitest';
import {
  chipDependencies,
  closure,
  findChipCycle,
  makeChipFromBoard,
  newChipId,
  tombstone,
  usagesOf,
  validatePorts,
  wouldCreateCycle,
} from './chips';
import { flattenBoard } from './flatten';
import { pinsOf } from './parts-spec';
import { andChip, board, def, notChip, orChip, toMap, xorChip, xorNand } from './chips.fixtures';

const chips = () => toMap(notChip(), andChip(), orChip(), xorChip(), xorNand());

describe('chip dependency graph (CHIP-03)', () => {
  it('lists direct dependencies', () => {
    const g = chipDependencies(chips());
    expect([...g.get('xor3')!].sort()).toEqual(['and1', 'not1', 'or1']);
    expect([...g.get('not1')!]).toEqual([]);
  });

  it('E-SIM-05: the editor blocks placing a chip inside itself directly', () => {
    expect(wouldCreateCycle(chips(), 'not1', 'not1')).toBe(true);
  });

  it('E-SIM-05: the editor blocks placing a chip that contains the target (indirect)', () => {
    // not1 is inside and1 is inside xor3: putting xor3 into not1 would loop.
    expect(wouldCreateCycle(chips(), 'not1', 'xor3')).toBe(true);
    expect(wouldCreateCycle(chips(), 'and1', 'xor3')).toBe(true);
    // Reusing a chip that does not contain the target is fine.
    expect(wouldCreateCycle(chips(), 'xor3', 'xor4')).toBe(false);
    expect(wouldCreateCycle(chips(), 'xor4', 'not1')).toBe(false);
  });

  it('E-SIM-05: the loader finds cycles in a save, direct and indirect', () => {
    expect(findChipCycle(chips())).toBeNull();
    const self = def('self', board().chip('me', 'self').build(), [], []);
    expect(findChipCycle({ self })).toEqual(['self', 'self']);
    const a = def('A', board().chip('x', 'B').build(), [], []);
    const b = def('B', board().chip('y', 'A').build(), [], []);
    const cyc = findChipCycle(toMap(a, b))!;
    expect(cyc[0]).toBe(cyc[cyc.length - 1]);
    expect(new Set(cyc)).toEqual(new Set(['A', 'B']));
  });

  it('E-DATA-08: usages of a chip are listed (boards and chips, direct and through other chips)', () => {
    const boards = [
      { name: 'Level 3', board: board().chip('n1', 'not1').chip('n2', 'not1').build() },
      { name: 'Level 5', board: board().chip('x', 'xor3').build() },
      { name: 'Level 6', board: board().chip('x', 'xor4').build() },
    ];
    const u = usagesOf('not1', boards, chips());
    expect(u).toEqual(
      expect.arrayContaining([
        { kind: 'board', name: 'Level 3', parts: ['n1', 'n2'], direct: true },
        { kind: 'board', name: 'Level 5', parts: ['x'], direct: false, via: ['xor3'] },
        { kind: 'chip', name: 'AND1', chipId: 'and1', parts: ['n'], direct: true },
        { kind: 'chip', name: 'OR1', chipId: 'or1', parts: ['na', 'nb'], direct: true },
        { kind: 'chip', name: 'XOR3', chipId: 'xor3', parts: ['inv'], direct: true },
      ]),
    );
    expect(u.find((x) => x.name === 'Level 6')).toBeUndefined();
    expect(u).toHaveLength(5);
    expect(usagesOf('xor4', [], chips())).toEqual([]);
  });

  it('E-DATA-08: deleting leaves a tombstone; boards using it still load', () => {
    const before = chips();
    const after = tombstone(before, 'xor3');
    expect(after.xor3).toEqual({ ...before.xor3, deleted: true });
    expect(before.xor3!.deleted).toBeUndefined(); // immutable
    const top = board().part('A', 'switch').part('B', 'switch').chip('c', 'xor3').wire('A.out', 'c.a').wire('B.out', 'c.b').build();
    const r = flattenBoard(top, after);
    expect(r.problems.map((p) => p.code)).toEqual(['deleted-chip']);
    expect(r.board.parts.filter((p) => p.type === 'nand')).toHaveLength(8);
    // Pins still resolve from the tombstoned definition.
    expect(pinsOf(top.parts[2]!, after).map((p) => p.name)).toEqual(['a', 'b', 'y']);
    // The tombstone is still embedded in saves of boards that use it.
    expect(Object.keys(closure(top, after)).sort()).toEqual(['and1', 'not1', 'or1', 'xor3']);
  });

  it('closure embeds every chip used, transitively, and nothing else', () => {
    const b = board().chip('c', 'and1').chip('d', 'missing').build();
    expect(Object.keys(closure(b, chips())).sort()).toEqual(['and1', 'not1']);
    expect(closure(board().build(), chips())).toEqual({});
  });
});

describe('ports (CHIP-01)', () => {
  it('validatePorts accepts good ports and names each problem', () => {
    expect(validatePorts(xorNand())).toEqual([]);
    const b = board().part('a', 'switch', { label: 'x' }).part('b', 'switch', { label: 'x' }).part('g', 'nand').part('y', 'lamp').build();
    const codes = validatePorts(def('d', b, ['a', 'b', 'g', 'nope', 'a'], ['y', 'a'])).map((p) => p.code);
    expect(codes).toEqual(['duplicate-name', 'wrong-type', 'missing-port', 'duplicate-port', 'wrong-type']);
    const many = board();
    const ids: string[] = [];
    for (let i = 0; i < 65; i++) {
      many.part(`s${i}`, 'switch');
      ids.push(`s${i}`);
    }
    expect(validatePorts(def('m', many.build(), ids, [])).map((p) => p.code)).toEqual(['too-many']);
  });

  it('makeChipFromBoard orders ports by y then x, keeps ids, makes a unique id', () => {
    const b = board()
      .part('lo', 'switch', { x: 0, y: 5 })
      .part('hi', 'switch', { x: 3, y: 1 })
      .part('hi0', 'switch', { x: 1, y: 1 })
      .part('out2', 'lamp', { x: 9, y: 4 })
      .part('out1', 'lamp', { x: 9, y: 2 })
      .part('g', 'nand')
      .build();
    const d = makeChipFromBoard(b, { name: 'My Gate!', taken: ['chip-my-gate'], color: '#4c6ef5' });
    expect(d.id).toBe('chip-my-gate-2');
    expect(d.ports).toEqual({ inputs: ['hi0', 'hi', 'lo'], outputs: ['out1', 'out2'] });
    expect(d.version).toBe(1);
    expect(d.color).toBe('#4c6ef5');
    expect(d.board.parts.map((p) => p.id)).toEqual(b.parts.map((p) => p.id));
    expect(d.board).not.toBe(b);
    // Explicit order.
    expect(makeChipFromBoard(b, { name: 'g', inputs: ['lo'], outputs: ['out2'] }).ports).toEqual({ inputs: ['lo'], outputs: ['out2'] });
    expect(() => makeChipFromBoard(b, { name: 'g', inputs: ['g'] })).toThrow(/switch/);
  });

  it('newChipId is deterministic and avoids taken ids', () => {
    expect(newChipId('Full Adder')).toBe('chip-full-adder');
    expect(newChipId('Full Adder', ['chip-full-adder', 'chip-full-adder-2'])).toBe('chip-full-adder-3');
    expect(newChipId('!!!')).toBe('chip-chip');
  });

  it('a chip made from a board works in another board (pins from labels or ids)', () => {
    const d = makeChipFromBoard(xorNand().board, { name: 'xor', id: 'mx' });
    const top = board().part('A', 'switch').part('B', 'switch').chip('c', 'mx').part('Y', 'lamp')
      .wire('A.out', 'c.a').wire('B.out', 'c.b').wire('c.y', 'Y.in').build();
    const r = flattenBoard(top, { mx: d });
    expect(r.problems).toEqual([]);
    expect(r.board.parts.filter((p) => p.type === 'nand')).toHaveLength(4);
  });
});
