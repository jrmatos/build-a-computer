import type { Board, Part } from '@build-a-computer/schema';
import type { BusValue, Snapshot } from '@build-a-computer/worker';
import { dataToBytes } from './romCode';

export const MEMORY_TYPES = new Set(['ram', 'rom', 'register', 'counter']);

/** RAM, ROM, registers and counters on the board, in a stable order. */
export function memoryParts(board: Board): Part[] {
  const order = ['rom', 'ram', 'register', 'counter'];
  return board.parts
    .filter((p) => MEMORY_TYPES.has(p.type))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || (a.label ?? a.id).localeCompare(b.label ?? b.id));
}

/** Entries a part holds: 2^addrWidth for RAM/ROM, one for registers and counters. */
export function capacityOf(p: Part): number {
  if (p.type === 'ram' || p.type === 'rom') return 2 ** Math.min(16, Math.max(1, p.props?.addrWidth ?? 8));
  return 1;
}

export const widthOf = (p: Part): number => p.props?.width ?? 8;

/** Worker contents, or the ROM's own data when the worker has none yet. */
export function contentsOf(p: Part, fromWorker: number[] | undefined): number[] {
  const cap = capacityOf(p);
  const src = fromWorker?.length ? fromWorker : p.type === 'rom' ? dataToBytes(p.props?.data) : [];
  const out = new Array<number>(cap).fill(0);
  for (let i = 0; i < Math.min(cap, src.length); i++) out[i] = src[i]! >>> 0;
  return out;
}

/** Toy-8 naming (docs/toy8.md): parts labelled like this make the CPU view appear. */
export const CPU_REGS = ['PC', 'IR', 'R0', 'R1', 'R2', 'R3', 'OUT'] as const;
export const CPU_FLAGS = ['Z', 'N', 'C', 'HALT'] as const;

export interface CpuParts {
  regs: { name: string; part: Part }[];
  flags: { name: string; part: Part }[];
  /** FLAGS register, if the board keeps flags in one part. */
  flagsReg?: Part;
  rom?: Part;
}

const byLabel = (board: Board, name: string): Part | undefined =>
  board.parts.find((p) => (p.label ?? '').trim().toUpperCase() === name);

/** The CPU view shows when the board has a PC and at least one of IR or a register. */
export function findCpu(board: Board): CpuParts | null {
  const regs = CPU_REGS.flatMap((name) => {
    const part = byLabel(board, name);
    return part ? [{ name, part }] : [];
  });
  if (!regs.some((r) => r.name === 'PC') || regs.length < 2) return null;
  const flags = CPU_FLAGS.flatMap((name) => {
    const part = byLabel(board, name);
    return part ? [{ name, part }] : [];
  });
  const rom = byLabel(board, 'ROM') ?? board.parts.find((p) => p.type === 'rom');
  return { regs, flags, flagsReg: byLabel(board, 'FLAGS'), rom };
}

/**
 * Value a part shows, from the snapshot: its widest output pin (or, for
 * lamps and displays, the input). `memory` (registers) wins when known.
 */
export function partValue(p: Part, snapshot: Snapshot | null, memory?: number[]): BusValue | undefined {
  const w = widthOf(p);
  if (memory?.length === 1 && p.type !== 'ram' && p.type !== 'rom') return { w, v: memory[0]! >>> 0, x: 0 };
  if (!snapshot) return undefined;
  const prefix = `${p.id}:`;
  let best: BusValue | undefined;
  for (const k in snapshot.busPins) {
    if (!k.startsWith(prefix)) continue;
    const b = snapshot.busPins[k]!;
    // Prefer an output-ish pin name.
    const pin = k.slice(prefix.length);
    if (!best || /^(q|out|y|value)$/i.test(pin) || b.w > best.w) best = b;
  }
  if (best) return best;
  for (const k in snapshot.pins) {
    if (!k.startsWith(prefix)) continue;
    const v = snapshot.pins[k]!;
    return { w: 1, v: v === 1 ? 1 : 0, x: v === 2 ? 1 : 0 };
  }
  return undefined;
}

/** Indexes whose value differs between two dumps (the "changed since last step" highlight). */
export function changedCells(prev: readonly number[] | null, cur: readonly number[]): Set<number> {
  const out = new Set<number>();
  if (!prev) return out;
  for (let i = 0; i < cur.length; i++) if (prev[i] !== cur[i]) out.add(i);
  return out;
}
