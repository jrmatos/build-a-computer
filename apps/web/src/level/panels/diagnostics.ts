import type { Board, Part } from '@ground-up/schema';
import type { Snapshot } from '@ground-up/worker';
import { t } from '../../i18n';
import { partKind } from './names';

/** One row of the diagnostics panel (EDIT-10). */
export interface DiagEntry {
  key: string;
  code: string;
  severity: 'error' | 'warning';
  text: string;
  /** Parts and wires to zoom to and flash. */
  ids: string[];
  /** Found while running (from the snapshot), not by the compiler. */
  live: boolean;
}

/**
 * Diagnostics come from several producers (compiler, engine, chip flattener),
 * so they are read loosely: any `part`/`parts`/`wire`/`wires` fields name what
 * to show, and unknown codes fall back to a generic sentence.
 */
type LooseDiag = { code: string } & Record<string, unknown>;

/** The parts of a snapshot the panel reads. */
export type LivePins = Pick<Snapshot, 'contentionPins' | 'unstablePins'>;

const ERRORS = new Set(['contention', 'unstable', 'bad-wire', 'width-mismatch', 'unsupported-part']);

export function partName(board: Board, id: string): string {
  const p: Part | undefined = board.parts.find((q) => q.id === id);
  if (!p) return id;
  const kind = partKind(p.type);
  return p.label ? `${p.label} (${kind})` : kind;
}

const strs = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const partOf = (pinKey: string): string => pinKey.slice(0, pinKey.lastIndexOf(':'));

/** Parts and wires touching the given `${part}:${pin}` keys. */
function idsForPins(board: Board, pinKeys: string[]): string[] {
  const pins = new Set(pinKeys);
  const ids = new Set(pinKeys.map(partOf));
  for (const w of board.wires) {
    if (pins.has(`${w.from.part}:${w.from.pin}`) || pins.has(`${w.to.part}:${w.to.pin}`)) ids.add(w.id);
  }
  return [...ids];
}

function names(board: Board, ids: string[]): string {
  const parts = ids.filter((id) => board.parts.some((p) => p.id === id));
  const shown = parts.slice(0, 3).map((id) => partName(board, id));
  const more = parts.length - shown.length;
  return more > 0 ? t('panels.diag.andMore', { list: shown.join(', '), n: more }) : shown.join(', ');
}

function describe(board: Board, d: LooseDiag, snapshot: LivePins | null): Omit<DiagEntry, 'key' | 'live'> {
  const parts = [...strs(d.part), ...strs(d.parts)];
  const wires = [...strs(d.wire), ...strs(d.wires)];
  let ids = [...parts, ...wires];
  const severity = ERRORS.has(d.code) ? 'error' : 'warning';
  const pin = typeof d.pin === 'string' ? d.pin : '';
  switch (d.code) {
    case 'floating-input':
      return { code: d.code, severity, ids, text: t('panels.diag.floating', { part: names(board, parts), pin }) };
    case 'bad-wire':
      return { code: d.code, severity, ids, text: t('panels.diag.badWire') };
    case 'contention':
      return { code: d.code, severity, ids, text: t('panels.diag.contention', { parts: names(board, parts) }) };
    case 'unstable': {
      // The compiler names nets, which the UI cannot see; use the snapshot's unstable pins.
      if (!ids.length && snapshot?.unstablePins.length) ids = idsForPins(board, snapshot.unstablePins);
      return {
        code: d.code,
        severity,
        ids,
        text: ids.length ? t('panels.diag.unstableAt', { parts: names(board, ids) }) : t('panels.diag.unstable'),
      };
    }
    case 'width-mismatch': {
      const a = d.expected ?? d.want ?? d.a;
      const b = d.actual ?? d.got ?? d.b;
      const text =
        typeof a === 'number' && typeof b === 'number'
          ? t('panels.diag.widthBits', { a, b })
          : t('panels.diag.width');
      return { code: d.code, severity, ids, text };
    }
    case 'unsupported-part':
      return { code: d.code, severity, ids, text: t('panels.diag.unsupported', { part: names(board, parts) || String(d.type ?? '') }) };
    default: {
      const msg = typeof d.message === 'string' ? d.message : t('panels.diag.generic', { code: d.code });
      return { code: d.code, severity, ids, text: msg };
    }
  }
}

/** Compile diagnostics plus contention and oscillation seen in the latest snapshot. */
export function collectDiagnostics(board: Board, compiled: readonly unknown[] | undefined, snapshot: LivePins | null): DiagEntry[] {
  const out: DiagEntry[] = [];
  const seen = new Set<string>();
  const known = new Set([...board.parts.map((p) => p.id), ...board.wires.map((w) => w.id)]);
  const push = (e: Omit<DiagEntry, 'key'>) => {
    const ids = e.ids.filter((id) => known.has(id));
    const key = `${e.code}:${[...ids].sort().join(',')}:${e.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...e, ids, key });
  };
  for (const d of compiled ?? []) {
    if (!d || typeof d !== 'object' || typeof (d as LooseDiag).code !== 'string') continue;
    push({ ...describe(board, d as LooseDiag, snapshot), live: false });
  }
  if (snapshot?.contentionPins.length) {
    // One row per group of parts fighting on the same wires: group by connected pins.
    for (const group of groupPins(board, snapshot.contentionPins)) {
      const ids = idsForPins(board, group);
      push({ code: 'contention', severity: 'error', ids, live: true, text: t('panels.diag.contention', { parts: names(board, ids) }) });
    }
  }
  if (snapshot?.unstablePins.length && !out.some((e) => e.code === 'unstable')) {
    const ids = idsForPins(board, snapshot.unstablePins);
    push({ code: 'unstable', severity: 'error', ids, live: true, text: t('panels.diag.unstableAt', { parts: names(board, ids) }) });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Split pin keys into groups joined by wires (approximates nets without the netlist). */
export function groupPins(board: Board, pinKeys: string[]): string[][] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const k of pinKeys) parent.set(k, k);
  for (const w of board.wires) {
    const a = `${w.from.part}:${w.from.pin}`;
    const b = `${w.to.part}:${w.to.pin}`;
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  }
  const groups = new Map<string, string[]>();
  for (const k of pinKeys) {
    const r = find(k);
    groups.set(r, [...(groups.get(r) ?? []), k]);
  }
  return [...groups.values()];
}
