/**
 * Fan-in cone: every wire and part that can affect an output, walking
 * backwards from it through the nets that drive each input pin. The walk
 * stops at state (flip-flops, registers, counters, the clock) and at the
 * board's own inputs, so the cone is "this tick's logic" — what explains the
 * value the output shows right now. Pure: board in, ids out.
 */
import type { Board, ChipMap, Part } from '@build-a-computer/schema';
import { pinsOf } from '@build-a-computer/sim-logic';

export interface Cone {
  parts: string[];
  wires: string[];
  /** Parts where the walk stopped: state elements and inputs (switches, buttons, constants, clocks). */
  sources: string[];
}

/** Parts whose outputs come from stored state, not from this tick's inputs. */
const STATE = new Set<Part['type']>(['dff', 'register', 'counter', 'clock', 'switch', 'button', 'const']);

/** Inputs that matter for a memory's (asynchronous) read output; the rest only act on a clock edge. */
const READ_INPUTS: Partial<Record<Part['type'], string[]>> = {
  ram: ['addr'],
  rom: ['addr'],
  regfile: ['rs1', 'rs2'],
};

const key = (part: string, pin: string) => `${part}:${pin}`;

/** Union-find over pins joined by wires: the nets of the board. */
function nets(board: Board): { netOf: (k: string) => string; wiresOf: Map<string, string[]>; pinsOn: Map<string, string[]> } {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (c !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const touch = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };
  for (const w of board.wires) {
    const a = key(w.from.part, w.from.pin);
    const b = key(w.to.part, w.to.pin);
    touch(a);
    touch(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const wiresOf = new Map<string, string[]>();
  for (const w of board.wires) {
    const n = find(key(w.from.part, w.from.pin));
    const list = wiresOf.get(n);
    if (list) list.push(w.id);
    else wiresOf.set(n, [w.id]);
  }
  const pinsOn = new Map<string, string[]>();
  for (const k of parent.keys()) {
    const n = find(k);
    const list = pinsOn.get(n);
    if (list) list.push(k);
    else pinsOn.set(n, [k]);
  }
  return { netOf: (k) => (parent.has(k) ? find(k) : k), wiresOf, pinsOn };
}

/** The fan-in cone of `partId` (usually an output lamp), including the part itself. */
export function fanInCone(board: Board, partId: string, chips: ChipMap = {}): Cone {
  const byId = new Map(board.parts.map((p) => [p.id, p]));
  const pinCache = new Map<string, ReturnType<typeof pinsOf>>();
  const pinsFor = (p: Part) => {
    let list = pinCache.get(p.id);
    if (!list) pinCache.set(p.id, (list = pinsOf(p, chips)));
    return list;
  };
  const isOutput = (k: string): boolean => {
    const cut = k.lastIndexOf(':');
    const p = byId.get(k.slice(0, cut));
    return !!p && pinsFor(p).some((q) => q.name === k.slice(cut + 1) && q.dir === 'out');
  };
  const { netOf, wiresOf, pinsOn } = nets(board);
  const parts = new Set<string>();
  const wires = new Set<string>();
  const sources = new Set<string>();
  const seenNets = new Set<string>();
  const queue: string[] = [];
  const start = byId.get(partId);
  if (!start) return { parts: [], wires: [], sources: [] };
  queue.push(partId);
  parts.add(partId);
  while (queue.length) {
    const p = byId.get(queue.shift()!)!;
    if (p.id !== partId && STATE.has(p.type)) {
      sources.add(p.id);
      continue;
    }
    const only = READ_INPUTS[p.type];
    for (const pin of pinsFor(p)) {
      if (pin.dir !== 'in' || (only && !only.includes(pin.name))) continue;
      const net = netOf(key(p.id, pin.name));
      if (seenNets.has(net)) continue;
      seenNets.add(net);
      for (const w of wiresOf.get(net) ?? []) wires.add(w);
      for (const k of pinsOn.get(net) ?? []) {
        if (!isOutput(k)) continue;
        const driver = k.slice(0, k.lastIndexOf(':'));
        if (parts.has(driver)) continue;
        parts.add(driver);
        queue.push(driver);
      }
    }
  }
  return { parts: [...parts], wires: [...wires], sources: [...sources] };
}

/** Wires attached to the labelled inputs' and outputs' pins (for pinning to the waveform), in label order. */
export function labelWires(board: Board, labels: readonly string[]): string[] {
  const out: string[] = [];
  for (const label of labels) {
    const part = board.parts.find((p) => p.label === label && (p.type === 'switch' || p.type === 'button' || p.type === 'lamp'));
    if (!part) continue;
    const pin = part.type === 'lamp' ? 'in' : 'out';
    const w = board.wires.find((x) => (x.from.part === part.id && x.from.pin === pin) || (x.to.part === part.id && x.to.pin === pin));
    if (w && !out.includes(w.id)) out.push(w.id);
  }
  return out;
}
