import type { Board, Part, PartProps, PartType, Wire } from '@ground-up/schema';

/**
 * A tiny board builder for reference solutions written as code. Positions are
 * a plain grid; the game re-lays a solution out before showing it on
 * "Show solution" (ADR-007).
 */

/** A pin: [part id, pin name]. */
export type Pin = readonly [string, string];

export class BoardBuilder {
  readonly parts: Part[];
  readonly wires: Wire[] = [];
  private n = 0;

  constructor(starter: Board) {
    this.parts = starter.parts.map((p) => ({ ...p }));
    this.wires = starter.wires.map((w) => ({ ...w }));
  }

  /** Output pin of a locked level input (switch), by label. */
  in(label: string): Pin {
    return [this.byLabel(label), 'out'];
  }

  /** Input pin of a locked level output (lamp), by label. */
  out(label: string): Pin {
    return [this.byLabel(label), 'in'];
  }

  private byLabel(label: string): string {
    const p = this.parts.find((q) => q.label === label && q.locked);
    if (!p) throw new Error(`No level part labelled ${label}`);
    return p.id;
  }

  /** Place a part and return its id. */
  add(type: PartType, props?: PartProps): string {
    const k = this.n++;
    const id = `${type}-${k}`;
    this.parts.push({ id, type, x: 4 + (k % 16) * 6, y: -40 + Math.floor(k / 16) * 6, rot: 0, flip: false, ...(props ? { props } : {}) });
    return id;
  }

  wire(from: Pin, to: Pin): this {
    this.wires.push({ id: `w-${this.wires.length}`, from: { part: from[0], pin: from[1] }, to: { part: to[0], pin: to[1] }, points: [] });
    return this;
  }

  /** A two-input gate (or a mux-less bitwise gate of `width` bits); returns its output pin. */
  gate(type: 'nand' | 'and' | 'or' | 'nor' | 'xor' | 'xnor', a: Pin, b: Pin, width = 1): Pin {
    const id = this.add(type, width > 1 ? { width } : undefined);
    this.wire(a, [id, 'a']).wire(b, [id, 'b']);
    return [id, 'out'];
  }

  not(a: Pin, width = 1): Pin {
    const id = this.add('not', width > 1 ? { width } : undefined);
    this.wire(a, [id, 'in']);
    return [id, 'out'];
  }

  /** NOT made of one NAND (for levels before NOT is unlocked). */
  nandNot(a: Pin): Pin {
    return this.gate('nand', a, a);
  }

  /** Built-in mux block: sel = 0 picks a. */
  mux(a: Pin, b: Pin, sel: Pin, width = 1): Pin {
    const id = this.add('mux', width > 1 ? { width } : undefined);
    this.wire(a, [id, 'a']).wire(b, [id, 'b']).wire(sel, [id, 'sel']);
    return [id, 'out'];
  }

  constant(value: number, width = 1): Pin {
    return [this.add('const', { width, value }), 'out'];
  }

  /** Split a bus into `width / chunk` pins, bit 0 first. */
  split(bus: Pin, width: number, chunk = 1): Pin[] {
    const id = this.add('splitter', { width, chunk });
    this.wire(bus, [id, 'in']);
    return Array.from({ length: width / chunk }, (_, i) => [id, `o${i}`] as const);
  }

  /** Join pins (bit 0 first) into one bus. */
  join(bits: Pin[], chunk = 1): Pin {
    const id = this.add('joiner', { width: bits.length * chunk, chunk });
    bits.forEach((b, i) => this.wire(b, [id, `i${i}`]));
    return [id, 'out'];
  }

  /** Built-in adder block; returns [sum, cout]. */
  adder(a: Pin, b: Pin, cin: Pin, width: number): [Pin, Pin] {
    const id = this.add('adder', { width });
    this.wire(a, [id, 'a']).wire(b, [id, 'b']).wire(cin, [id, 'cin']);
    return [
      [id, 'sum'],
      [id, 'cout'],
    ];
  }

  /** Reduce pins with a 2-input gate, as a balanced tree. */
  tree(type: 'and' | 'or', pins: Pin[]): Pin {
    let level = pins;
    while (level.length > 1) {
      const next: Pin[] = [];
      for (let i = 0; i + 1 < level.length; i += 2) next.push(this.gate(type, level[i]!, level[i + 1]!));
      if (level.length % 2) next.push(level[level.length - 1]!);
      level = next;
    }
    return level[0]!;
  }

  board(): Board {
    return { parts: this.parts, wires: this.wires };
  }
}
