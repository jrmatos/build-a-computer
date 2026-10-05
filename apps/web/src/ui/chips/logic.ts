/**
 * Pure helpers for the chip UI: port lists, keeping ports in sync with a
 * chip's board, dropping wires to pins that no longer exist, and merging
 * chips that arrive with a save into the local library.
 */
import type { Board, ChipDef, ChipMap, Part, Wire } from '@ground-up/schema';
import { pinsOf } from '@ground-up/sim-logic';

const byPosition = (a: Part, b: Part): number =>
  a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Switches (inputs) and lamps (outputs) on a board, top to bottom then left to right. */
export function portCandidates(board: Board): { inputs: Part[]; outputs: Part[] } {
  return {
    inputs: board.parts.filter((p) => p.type === 'switch').sort(byPosition),
    outputs: board.parts.filter((p) => p.type === 'lamp').sort(byPosition),
  };
}

/**
 * Ports after the chip's board changed: keep the player's order for ports that
 * still exist, drop removed ones, append new switches/lamps in board order.
 */
export function syncPorts(ports: ChipDef['ports'], board: Board): ChipDef['ports'] {
  const c = portCandidates(board);
  const side = (old: string[], parts: Part[]) => {
    const present = new Set(parts.map((p) => p.id));
    const kept = old.filter((id) => present.has(id));
    const keptSet = new Set(kept);
    return [...kept, ...parts.filter((p) => !keptSet.has(p.id)).map((p) => p.id)].slice(0, 64);
  };
  const inputs = side(ports.inputs, c.inputs);
  const outputs = side(ports.outputs, c.outputs);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return same(inputs, ports.inputs) && same(outputs, ports.outputs) ? ports : { inputs, outputs };
}

export interface DroppedWire {
  wire: Wire;
  /** Readable "Part label.pin" of the missing end. */
  end: string;
}

/**
 * Remove wires attached to chip pins that no longer exist (the chip's ports
 * changed). Tombstoned and unknown chips are left alone so old saves still load.
 */
export function pruneChipWires(
  board: Board,
  chips: ChipMap,
): { board: Board; dropped: DroppedWire[] } {
  const pinNames = new Map<string, Set<string> | null>();
  for (const p of board.parts) {
    if (p.type !== 'chip') continue;
    const def = p.chip ? chips[p.chip] : undefined;
    pinNames.set(p.id, def ? new Set(pinsOf(p, chips).map((x) => x.name)) : null);
  }
  if (!pinNames.size) return { board, dropped: [] };
  const dropped: DroppedWire[] = [];
  const name = (partId: string, pin: string) => {
    const p = board.parts.find((q) => q.id === partId);
    const chip = p?.chip ? chips[p.chip]?.name : undefined;
    return `${p?.label?.trim() || chip || partId}.${pin}`;
  };
  const wires = board.wires.filter((w) => {
    for (const end of [w.from, w.to]) {
      const pins = pinNames.get(end.part);
      if (pins && !pins.has(end.pin)) {
        dropped.push({ wire: w, end: name(end.part, end.pin) });
        return false;
      }
    }
    return true;
  });
  return dropped.length ? { board: { ...board, wires }, dropped } : { board, dropped };
}

/** JSON with sorted keys, for comparing chip definitions regardless of key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Rewrite chip references (part.chip) on a board. Returns the same board when nothing changes. */
export function remapBoardChips(board: Board, remap: Map<string, string>): Board {
  if (!remap.size || !board.parts.some((p) => p.type === 'chip' && p.chip && remap.has(p.chip)))
    return board;
  return {
    ...board,
    parts: board.parts.map((p) =>
      p.type === 'chip' && p.chip && remap.has(p.chip) ? { ...p, chip: remap.get(p.chip)! } : p,
    ),
  };
}

export interface MergeResult {
  chips: ChipMap;
  /** Imported id -> id it got locally (only for re-ided chips). */
  remap: Map<string, string>;
  /** Ids whose local definition changed (added, upgraded, or re-ided copies). */
  changed: string[];
}

/**
 * Merge chips embedded in a save into the local library. A local chip is never
 * overwritten by an older or equal version. The higher version wins. When the
 * same id and version hold different definitions, both are kept: the imported
 * one gets a fresh id and the save's references are rewritten to it.
 */
export function mergeChips(local: ChipMap, incoming: ChipMap): MergeResult {
  const out: ChipMap = { ...local };
  const remap = new Map<string, string>();
  const changed: string[] = [];
  const taken = new Set([...Object.keys(local), ...Object.keys(incoming)]);
  const freshId = (id: string) => {
    for (let n = 2; ; n++) {
      const c = `${id.slice(0, 56)}-copy${n === 2 ? '' : n}`;
      if (!taken.has(c)) {
        taken.add(c);
        return c;
      }
    }
  };
  const strip = (d: ChipDef) => stableStringify({ ...d, version: 0, deleted: undefined });
  // Decide ids first so references between imported chips can be rewritten.
  const accept: ChipDef[] = [];
  for (const def of Object.values(incoming)) {
    const mine = local[def.id];
    if (!mine) accept.push(def);
    else if (strip(mine) === strip(def)) {
      // Same content: keep the higher version (and the local tombstone state).
      if (def.version > mine.version) accept.push({ ...def, deleted: mine.deleted });
    } else if (def.version > mine.version) accept.push(def);
    else if (def.version === mine.version) {
      const id = freshId(def.id);
      remap.set(def.id, id);
      accept.push({ ...def, id });
    }
    // Older imported version: keep the local one.
  }
  for (const def of accept) {
    const board = remapBoardChips(def.board, remap);
    const d: ChipDef = board === def.board ? def : { ...def, board };
    if (d.deleted === undefined) delete d.deleted;
    out[d.id] = d;
    changed.push(d.id);
  }
  return { chips: out, remap, changed };
}

/** Chips that changed between two maps (added or different object), for persistence. */
export function changedChips(prev: ChipMap, next: ChipMap): ChipDef[] {
  return Object.values(next).filter((c) => prev[c.id] !== c);
}

/** A copy name that is not taken yet: "Adder (copy)", "Adder (copy 2)", ... */
export function copyName(name: string, chips: ChipMap): string {
  const names = new Set(Object.values(chips).map((c) => c.name));
  for (let n = 1; ; n++) {
    const s = `${name} (copy${n === 1 ? '' : ` ${n}`})`.slice(0, 40);
    if (!names.has(s)) return s;
  }
}
