/**
 * Pure logic behind the properties panel: validating per-type props and
 * applying a change to one or more parts, dropping wires whose pins vanished.
 */
import type { Board, ChipMap, Part, PartProps, PartType, Wire } from '@build-a-computer/schema';
import { MAX_WIDTH } from '@build-a-computer/schema';
import { PART_INFO, pinsOf } from '@build-a-computer/sim-logic';

export type EditableProp = keyof PartProps;

/** Props a freshly placed part gets (PART_INFO defaults, copied so parts never share objects). */
export function defaultProps(type: PartType): PartProps {
  return { ...PART_INFO[type].defaults };
}

/** Effective value of a numeric prop, falling back to the type default. */
export function numProp(part: Part, key: 'width' | 'chunk' | 'selectBits' | 'addrWidth' | 'value'): number {
  return (part.props?.[key] as number | undefined) ?? (PART_INFO[part.type].defaults[key] as number | undefined) ?? (key === 'value' ? 0 : 1);
}

export const PROP_LIMITS = {
  width: [1, MAX_WIDTH],
  chunk: [1, MAX_WIDTH],
  selectBits: [1, 5],
  addrWidth: [1, 16],
} as const;

/** RAM/ROM sizes at or above this many address bits get a "large memory" warning. */
export const LARGE_ADDR_WIDTH = 14;

/**
 * Check a part's props after a change. Returns an i18n key (with vars) for the
 * first problem, or null when the props are valid.
 */
export function validateProps(type: PartType, props: PartProps): { key: string; vars?: Record<string, number> } | null {
  for (const k of ['width', 'chunk', 'selectBits', 'addrWidth'] as const) {
    const v = props[k];
    if (v === undefined) continue;
    const [lo, hi] = PROP_LIMITS[k];
    if (!Number.isInteger(v) || v < lo || v > hi) return { key: 'props.err.range', vars: { min: lo, max: hi } };
  }
  if (type === 'splitter' || type === 'joiner') {
    const w = props.width ?? PART_INFO[type].defaults.width;
    const c = props.chunk ?? PART_INFO[type].defaults.chunk ?? 1;
    if (c > w || w % c !== 0) return { key: 'props.err.chunk', vars: { width: w, chunk: c } };
  }
  if (props.value !== undefined && (!Number.isInteger(props.value) || props.value < 0 || props.value > 0xffffffff)) {
    return { key: 'props.err.value' };
  }
  return null;
}

/** Mask a value to `width` bits, unsigned. */
export const maskTo = (v: number, width: number): number => (width >= 32 ? v >>> 0 : (v & ((1 << width) - 1)) >>> 0);

export interface PropChange {
  board: Board;
  /** Wires removed because a pin they used no longer exists. */
  dropped: Wire[];
  /** Parts that were not changed because the new props would be invalid for them. */
  rejected: string[];
}

/**
 * Apply a props patch to every part in `ids` (locked parts are skipped).
 * A const's value is masked to its new width. Wires attached to pins that no
 * longer exist are removed in the same step. Returns the input board when
 * nothing changed.
 */
export function applyProps(board: Board, ids: ReadonlySet<string>, patch: PartProps, chips?: ChipMap): PropChange {
  const rejected: string[] = [];
  const changed = new Map<string, Part>();
  const parts = board.parts.map((p) => {
    if (!ids.has(p.id) || p.locked) return p;
    const props: PartProps = { ...(p.props ?? {}), ...patch };
    if (p.type === 'const' && props.value !== undefined) props.value = maskTo(props.value, props.width ?? numProp(p, 'width'));
    if (validateProps(p.type, props)) {
      rejected.push(p.id);
      return p;
    }
    const same = Object.keys(props).every((k) => props[k as EditableProp] === p.props?.[k as EditableProp]) && Object.keys(p.props ?? {}).length === Object.keys(props).length;
    if (same) return p;
    const next = { ...p, props };
    changed.set(p.id, next);
    return next;
  });
  if (!changed.size) return { board, dropped: [], rejected };

  const pinNames = new Map<string, Set<string>>();
  for (const [id, p] of changed) pinNames.set(id, new Set(pinsOf(p, chips).map((x) => x.name)));
  const gone = (part: string, pin: string) => {
    const names = pinNames.get(part);
    return !!names && !names.has(pin);
  };
  const dropped: Wire[] = [];
  const wires = board.wires.filter((w) => {
    if (gone(w.from.part, w.from.pin) || gone(w.to.part, w.to.pin)) {
      dropped.push(w);
      return false;
    }
    return true;
  });
  return { board: { parts, wires }, dropped, rejected };
}

/** Short human name of a wire, e.g. "A.out → nand.a", using part labels when present. */
export function describeWire(board: Board, w: Wire): string {
  const name = (id: string) => {
    const p = board.parts.find((q) => q.id === id);
    return p?.label?.trim() || p?.type || id;
  };
  return `${name(w.from.part)}.${w.from.pin} → ${name(w.to.part)}.${w.to.pin}`;
}

/** Words a RAM or ROM with these props holds, and its approximate size in bytes. */
export function memorySize(width: number, addrWidth: number): { words: number; bytes: number } {
  const words = 2 ** addrWidth;
  return { words, bytes: words * Math.ceil(width / 8) };
}

/** True when chip `id` uses chip `target`, directly or through other chips (or is it). */
export function chipUses(chips: ChipMap, id: string, target: string, seen = new Set<string>()): boolean {
  if (id === target) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  const def = chips[id];
  if (!def) return false;
  return def.board.parts.some((p) => p.type === 'chip' && !!p.chip && chipUses(chips, p.chip, target, seen));
}

/**
 * Can chip `id` be placed while editing inside the chips in `editing`
 * (outermost first)? Not when it would contain itself (E-SIM-05).
 */
export function canPlaceChip(chips: ChipMap, id: string, editing: readonly string[]): boolean {
  const def = chips[id];
  if (!def || def.deleted) return false;
  return !editing.some((outer) => chipUses(chips, id, outer));
}
