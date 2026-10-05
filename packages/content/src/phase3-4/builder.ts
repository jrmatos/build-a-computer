import type { Board, Part, PartProps, PartType, Wire } from '@ground-up/schema';

/** A pin reference written `partId.pin`. */
export type Pin = string;

export interface PartOptions {
  id?: string;
  label?: string;
  locked?: boolean;
  props?: PartProps;
  x?: number;
  y?: number;
}

/**
 * Small board builder for level starters and reference solutions. Parts get
 * stable ids (`type` + counter) and are laid out on a loose grid; wires go
 * from an output pin to an input pin.
 */
export class BoardBuilder {
  readonly parts: Part[] = [];
  readonly wires: Wire[] = [];
  private n = 0;

  constructor(base?: Board) {
    if (base) {
      for (const p of base.parts) this.parts.push(structuredClone(p));
      for (const w of base.wires) this.wires.push(structuredClone(w));
      this.n = this.parts.length + this.wires.length;
    }
  }

  /** Add a part; returns its id. */
  part(type: PartType, o: PartOptions = {}): string {
    const id = o.id ?? `${type}_${++this.n}`;
    if (this.parts.some((p) => p.id === id)) throw new Error(`duplicate part id ${id}`);
    const k = this.parts.length;
    const part: Part = { id, type, x: o.x ?? 4 + (k % 16) * 8, y: o.y ?? 4 + Math.floor(k / 16) * 8, rot: 0, flip: false };
    if (o.label !== undefined) part.label = o.label;
    if (o.locked) part.locked = true;
    if (o.props) part.props = o.props;
    this.parts.push(part);
    return id;
  }

  /** Wire an output pin to an input pin (`part.pin`). */
  wire(from: Pin, to: Pin): this {
    const [fp, fpin] = split(from);
    const [tp, tpin] = split(to);
    this.wires.push({ id: `w_${++this.n}`, from: { part: fp, pin: fpin }, to: { part: tp, pin: tpin }, points: [] });
    return this;
  }

  // ---------------------------------------------------- level I/O (locked)

  /** Locked input switch labelled `label` (id = label). */
  input(label: string, width = 1, x = -20, y = 0): Pin {
    this.part('switch', { id: label, label, locked: true, x, y, ...(width > 1 ? { props: { width } } : {}) });
    return `${label}.out`;
  }

  /** Locked output lamp labelled `label` (id = label). Returns its input pin. */
  output(label: string, width = 1, x = 20, y = 0): Pin {
    this.part('lamp', { id: label, label, locked: true, x, y, ...(width > 1 ? { props: { width, format: 'hex' } } : {}) });
    return `${label}.in`;
  }

  /** Locked clock labelled CLK (id CLK). */
  clock(x = -20, y = -12): Pin {
    this.part('clock', { id: 'CLK', label: 'CLK', locked: true, x, y });
    return 'CLK.out';
  }

  // --------------------------------------------- combinational helpers

  /** A 1-input gate (`not`, `buffer`). */
  g1(type: 'not' | 'buffer', a: Pin, width = 1): Pin {
    const id = this.part(type, width > 1 ? { props: { width } } : {});
    this.wire(a, `${id}.in`);
    return `${id}.out`;
  }

  /** A 2-input gate. */
  g2(type: 'nand' | 'and' | 'or' | 'nor' | 'xor' | 'xnor', a: Pin, b: Pin, width = 1): Pin {
    const id = this.part(type, width > 1 ? { props: { width } } : {});
    this.wire(a, `${id}.a`).wire(b, `${id}.b`);
    return `${id}.out`;
  }

  not = (a: Pin, w = 1): Pin => this.g1('not', a, w);
  and = (a: Pin, b: Pin, w = 1): Pin => this.g2('and', a, b, w);
  or = (a: Pin, b: Pin, w = 1): Pin => this.g2('or', a, b, w);
  nand = (a: Pin, b: Pin, w = 1): Pin => this.g2('nand', a, b, w);

  /** AND of many 1-bit signals. */
  andAll(...xs: Pin[]): Pin {
    return xs.reduce((acc, x) => this.and(acc, x));
  }

  orAll(...xs: Pin[]): Pin {
    return xs.reduce((acc, x) => this.or(acc, x));
  }

  /** Constant of `width` bits. */
  konst(value: number, width = 1): Pin {
    const id = this.part('const', { props: { width, value } });
    return `${id}.out`;
  }

  /** 2:1 mux: sel = 0 → a. */
  mux(a: Pin, b: Pin, sel: Pin, width = 1): Pin {
    const id = this.part('mux', { props: { width } });
    this.wire(a, `${id}.a`).wire(b, `${id}.b`).wire(sel, `${id}.sel`);
    return `${id}.out`;
  }

  /** 4:1 mux from three 2:1 muxes; s0 is the low select bit. */
  mux4(ins: [Pin, Pin, Pin, Pin], s0: Pin, s1: Pin, width = 1): Pin {
    return this.mux(this.mux(ins[0], ins[1], s0, width), this.mux(ins[2], ins[3], s0, width), s1, width);
  }

  /** 2^k:1 mux tree; sel[0] is the low select bit. */
  muxTree(ins: Pin[], sel: Pin[], width = 1): Pin {
    let level = ins;
    for (const s of sel) {
      const next: Pin[] = [];
      for (let i = 0; i < level.length; i += 2) next.push(this.mux(level[i]!, level[i + 1]!, s, width));
      level = next;
    }
    if (level.length !== 1) throw new Error('muxTree: inputs must be 2^sel.length');
    return level[0]!;
  }

  /** Split a bus into chunks (o0 = least significant). */
  split(bus: Pin, width: number, chunk = 1): Pin[] {
    const id = this.part('splitter', { props: { width, chunk } });
    this.wire(bus, `${id}.in`);
    return Array.from({ length: width / chunk }, (_, i) => `${id}.o${i}`);
  }

  /** Join chunks into a bus (first = least significant). */
  join(chunks: Pin[], chunk = 1): Pin {
    const id = this.part('joiner', { props: { width: chunks.length * chunk, chunk } });
    chunks.forEach((c, i) => this.wire(c, `${id}.i${i}`));
    return `${id}.out`;
  }

  /** Decoder with `selectBits` select bits; returns the output pins o0.. */
  decoder(sel: Pin, selectBits: number): Pin[] {
    const id = this.part('decoder', { props: { selectBits } });
    this.wire(sel, `${id}.in`);
    return Array.from({ length: 1 << selectBits }, (_, i) => `${id}.o${i}`);
  }

  // ------------------------------------------------------ clocked helpers

  /** A register; returns its id (wire `d`/`load` later for feedback). */
  register(width: number, clk: Pin, d?: Pin, load?: Pin): string {
    const id = this.part('register', { props: { width } });
    this.wire(clk, `${id}.clk`);
    if (d) this.wire(d, `${id}.d`);
    if (load) this.wire(load, `${id}.load`);
    return id;
  }

  build(): Board {
    return { parts: this.parts, wires: this.wires };
  }
}

function split(ref: Pin): [string, string] {
  const i = ref.lastIndexOf('.');
  if (i <= 0) throw new Error(`bad pin reference '${ref}'`);
  return [ref.slice(0, i), ref.slice(i + 1)];
}
