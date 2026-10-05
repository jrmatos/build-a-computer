import type { Board, Part } from '@build-a-computer/schema';
import { t } from '../../i18n';

/** Display name of a part type; falls back to the type in capitals while a key is missing. */
export function partKind(type: string): string {
  const key = `part.${type}`;
  const s = t(key);
  return s === key ? type.toUpperCase() : s;
}

/** Short name of a part for panels: its label, else its type. */
export function shortPart(p: Part | undefined): string {
  if (!p) return '?';
  return p.label?.trim() || partKind(p.type);
}

/** A wire as "SOURCE.pin → TARGET.pin". */
export function wireName(board: Board, wireId: string): string {
  const w = board.wires.find((x) => x.id === wireId);
  if (!w) return wireId;
  const part = (id: string) => board.parts.find((p) => p.id === id);
  return `${shortPart(part(w.from.part))}.${w.from.pin} → ${shortPart(part(w.to.part))}.${w.to.pin}`;
}

/** The one wire in the selection, if any. */
export function selectedWire(board: Board, selection: string[]): string | undefined {
  const wires = selection.filter((id) => board.wires.some((w) => w.id === id));
  return wires.length >= 1 ? wires[0] : undefined;
}
