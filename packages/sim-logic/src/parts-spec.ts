import type { ChipDef, ChipMap, Part, PartType } from '@ground-up/schema';

/**
 * Pin contract shared by the engine, the chip flattener and the editor.
 * Pin lists are derived from the part's type and props (and, for chips,
 * from the ChipDef), so parametric parts like splitters, decoders and
 * custom chips get the right pins everywhere.
 */
export interface PinSpec {
  name: string;
  dir: 'in' | 'out';
  width: number;
}

export type PartCategory = 'io' | 'gate' | 'wiring' | 'memory' | 'arith' | 'chip';

export interface PartInfo {
  category: PartCategory;
  /** Has a clock input named 'clk' and samples it on the rising edge. */
  clocked: boolean;
  /** Keeps state across power cycles (ROM). */
  nonVolatile: boolean;
  /** Props a fresh part gets when placed. */
  defaults: Required<Pick<NonNullable<Part['props']>, 'width'>> & NonNullable<Part['props']>;
  /** Props the properties panel lets players edit. */
  editable: (keyof NonNullable<Part['props']>)[];
}

const w1 = { width: 1 } as const;

export const PART_INFO: Record<PartType, PartInfo> = {
  switch: { category: 'io', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  button: { category: 'io', clocked: false, nonVolatile: false, defaults: w1, editable: [] },
  const: { category: 'io', clocked: false, nonVolatile: false, defaults: { width: 1, value: 0 }, editable: ['width', 'value'] },
  lamp: { category: 'io', clocked: false, nonVolatile: false, defaults: { width: 1, format: 'hex' }, editable: ['width', 'format'] },
  clock: { category: 'io', clocked: false, nonVolatile: false, defaults: w1, editable: [] },
  nand: { category: 'gate', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  not: { category: 'gate', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  and: { category: 'gate', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  or: { category: 'gate', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  nor: { category: 'gate', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  xor: { category: 'gate', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  xnor: { category: 'gate', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  buffer: { category: 'wiring', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  tristate: { category: 'wiring', clocked: false, nonVolatile: false, defaults: w1, editable: ['width'] },
  splitter: { category: 'wiring', clocked: false, nonVolatile: false, defaults: { width: 8, chunk: 1 }, editable: ['width', 'chunk'] },
  joiner: { category: 'wiring', clocked: false, nonVolatile: false, defaults: { width: 8, chunk: 1 }, editable: ['width', 'chunk'] },
  dff: { category: 'memory', clocked: true, nonVolatile: false, defaults: w1, editable: [] },
  register: { category: 'memory', clocked: true, nonVolatile: false, defaults: { width: 8 }, editable: ['width'] },
  counter: { category: 'memory', clocked: true, nonVolatile: false, defaults: { width: 8 }, editable: ['width'] },
  ram: { category: 'memory', clocked: true, nonVolatile: false, defaults: { width: 8, addrWidth: 4 }, editable: ['width', 'addrWidth'] },
  rom: { category: 'memory', clocked: false, nonVolatile: true, defaults: { width: 8, addrWidth: 4, data: '' }, editable: ['width', 'addrWidth', 'data'] },
  mux: { category: 'arith', clocked: false, nonVolatile: false, defaults: { width: 1 }, editable: ['width'] },
  decoder: { category: 'arith', clocked: false, nonVolatile: false, defaults: { width: 1, selectBits: 2 }, editable: ['selectBits'] },
  adder: { category: 'arith', clocked: false, nonVolatile: false, defaults: { width: 8 }, editable: ['width'] },
  alu: { category: 'arith', clocked: false, nonVolatile: false, defaults: { width: 8 }, editable: ['width'] },
  chip: { category: 'chip', clocked: false, nonVolatile: false, defaults: w1, editable: [] },
};

/**
 * ALU operations on the 3-bit `op` input (Toy-8 and Phase 2 "8-bit ALU with flags").
 * Flags: zero = result is 0; neg = result's top bit; carry = carry out of add,
 * NOT borrow for sub (RISC-V/ARM convention: carry = 1 when a >= b unsigned).
 */
export const ALU_OPS = ['add', 'sub', 'and', 'or', 'xor', 'not', 'shl', 'shr'] as const;

const prop = (p: Part, key: 'width' | 'chunk' | 'selectBits' | 'addrWidth'): number =>
  (p.props?.[key] as number | undefined) ?? (PART_INFO[p.type].defaults[key] as number | undefined) ?? 1;

const io = (name: string, dir: 'in' | 'out', width = 1): PinSpec => ({ name, dir, width });

/** Name of a chip port pin: the port part's label, or its id when unlabelled. */
export function portName(def: ChipDef, partId: string): string {
  return def.board.parts.find((p) => p.id === partId)?.label?.trim() || partId;
}

/** Pins of a part, inputs first then outputs, each in display order (top to bottom). */
export function pinsOf(part: Part, chips?: ChipMap): PinSpec[] {
  const w = prop(part, 'width');
  switch (part.type) {
    case 'switch':
    case 'const':
      return [io('out', 'out', w)];
    case 'button':
    case 'clock':
      return [io('out', 'out')];
    case 'lamp':
      return [io('in', 'in', w)];
    case 'not':
    case 'buffer':
      return [io('in', 'in', w), io('out', 'out', w)];
    case 'nand':
    case 'and':
    case 'or':
    case 'nor':
    case 'xor':
    case 'xnor':
      return [io('a', 'in', w), io('b', 'in', w), io('out', 'out', w)];
    case 'tristate':
      return [io('in', 'in', w), io('en', 'in'), io('out', 'out', w)];
    case 'splitter': {
      const c = prop(part, 'chunk');
      const n = Math.max(1, Math.floor(w / c));
      return [io('in', 'in', w), ...Array.from({ length: n }, (_, i) => io(`o${i}`, 'out', c))];
    }
    case 'joiner': {
      const c = prop(part, 'chunk');
      const n = Math.max(1, Math.floor(w / c));
      return [...Array.from({ length: n }, (_, i) => io(`i${i}`, 'in', c)), io('out', 'out', w)];
    }
    case 'dff':
      return [io('d', 'in'), io('clk', 'in'), io('q', 'out')];
    case 'register':
      return [io('d', 'in', w), io('load', 'in'), io('clk', 'in'), io('q', 'out', w)];
    case 'counter':
      // On a rising edge: load ? d : en ? q + 1 : q.
      return [io('d', 'in', w), io('load', 'in'), io('en', 'in'), io('clk', 'in'), io('q', 'out', w)];
    case 'ram':
      // Asynchronous read of q at addr; write d on the rising edge when we = 1.
      return [io('addr', 'in', prop(part, 'addrWidth')), io('d', 'in', w), io('we', 'in'), io('clk', 'in'), io('q', 'out', w)];
    case 'rom':
      return [io('addr', 'in', prop(part, 'addrWidth')), io('q', 'out', w)];
    case 'mux':
      // sel = 0 selects a.
      return [io('a', 'in', w), io('b', 'in', w), io('sel', 'in'), io('out', 'out', w)];
    case 'decoder': {
      const n = prop(part, 'selectBits');
      return [io('in', 'in', n), ...Array.from({ length: 1 << n }, (_, i) => io(`o${i}`, 'out'))];
    }
    case 'adder':
      return [io('a', 'in', w), io('b', 'in', w), io('cin', 'in'), io('sum', 'out', w), io('cout', 'out')];
    case 'alu':
      return [
        io('a', 'in', w),
        io('b', 'in', w),
        io('op', 'in', 3),
        io('out', 'out', w),
        io('zero', 'out'),
        io('neg', 'out'),
        io('carry', 'out'),
      ];
    case 'chip': {
      const def = part.chip ? chips?.[part.chip] : undefined;
      if (!def) return [];
      const width = (id: string) => {
        const p = def.board.parts.find((q) => q.id === id);
        return p ? prop(p, 'width') : 1;
      };
      return [
        ...def.ports.inputs.map((id) => io(portName(def, id), 'in', width(id))),
        ...def.ports.outputs.map((id) => io(portName(def, id), 'out', width(id))),
      ];
    }
  }
}

export const inputsOf = (p: Part, chips?: ChipMap): PinSpec[] => pinsOf(p, chips).filter((x) => x.dir === 'in');
export const outputsOf = (p: Part, chips?: ChipMap): PinSpec[] => pinsOf(p, chips).filter((x) => x.dir === 'out');
export const widthOf = (p: Part): number => prop(p, 'width');
