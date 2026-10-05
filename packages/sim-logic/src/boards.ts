import type { Board, Part, PartType, Wire } from '@build-a-computer/schema';

/** Small board builder for tests and benchmarks. Pins are written `part.pin`. */
export function boardBuilder() {
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const api = {
    part(id: string, type: PartType, label?: string) {
      parts.push({ id, type, x: 0, y: 0, rot: 0, flip: false, ...(label ? { label } : {}) });
      return api;
    },
    wire(from: string, to: string) {
      const [fp, fpin] = from.split('.') as [string, string];
      const [tp, tpin] = to.split('.') as [string, string];
      wires.push({ id: `w${wires.length}`, from: { part: fp, pin: fpin }, to: { part: tp, pin: tpin }, points: [] });
      return api;
    },
    build: (): Board => ({ parts, wires }),
  };
  return api;
}

/**
 * An n-bit ripple-carry adder flattened to NAND gates (9 per full adder).
 * Inputs: switches A0..A{n-1}, B0..B{n-1}, CIN. Outputs: lamps S0..S{n-1}, COUT.
 */
export function rippleAdderBoard(bits: number): Board {
  const b = boardBuilder();
  b.part('CIN', 'switch', 'CIN');
  for (let i = 0; i < bits; i++) b.part(`A${i}`, 'switch', `A${i}`).part(`B${i}`, 'switch', `B${i}`);
  let carry = 'CIN.out';
  for (let i = 0; i < bits; i++) {
    const g = (k: number) => `fa${i}_${k}`;
    for (let k = 1; k <= 9; k++) b.part(g(k), 'nand');
    const a = `A${i}.out`;
    const bb = `B${i}.out`;
    // h = a XOR b from four NANDs.
    b.wire(a, `${g(1)}.a`).wire(bb, `${g(1)}.b`);
    b.wire(a, `${g(2)}.a`).wire(`${g(1)}.out`, `${g(2)}.b`);
    b.wire(bb, `${g(3)}.a`).wire(`${g(1)}.out`, `${g(3)}.b`);
    b.wire(`${g(2)}.out`, `${g(4)}.a`).wire(`${g(3)}.out`, `${g(4)}.b`);
    // s = h XOR cin.
    b.wire(`${g(4)}.out`, `${g(5)}.a`).wire(carry, `${g(5)}.b`);
    b.wire(`${g(4)}.out`, `${g(6)}.a`).wire(`${g(5)}.out`, `${g(6)}.b`);
    b.wire(carry, `${g(7)}.a`).wire(`${g(5)}.out`, `${g(7)}.b`);
    b.wire(`${g(6)}.out`, `${g(8)}.a`).wire(`${g(7)}.out`, `${g(8)}.b`);
    // cout = NAND(NAND(a,b), NAND(h,cin)).
    b.wire(`${g(1)}.out`, `${g(9)}.a`).wire(`${g(5)}.out`, `${g(9)}.b`);
    b.part(`S${i}`, 'lamp', `S${i}`).wire(`${g(8)}.out`, `S${i}.in`);
    carry = `${g(9)}.out`;
  }
  b.part('COUT', 'lamp', 'COUT').wire(carry, 'COUT.in');
  return b.build();
}
