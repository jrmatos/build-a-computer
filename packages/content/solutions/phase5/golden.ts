import { build, formatDiagnostic } from '@build-a-computer/asm';
import { Bus, Hart, MemoryDevice, RAM_BASE } from '@build-a-computer/rv32';
import { EBREAK } from '../../src/phase5/rv';

/**
 * Test-only golden model for the Phase 5 CPU: the packages/rv32 hart on the
 * Phase 5 memory map (docs/rv32-datapath.md): program ROM at 0 (0x400 bytes,
 * read only), data RAM at 0x400..0xFFF, everything else unmapped. Runs until
 * the PC reaches `ebreak` (HALT). Any trap is an error: the Phase 5 CPU has none.
 */

export const CODE_BYTES = 0x400;
export const DATA_END = 0x1000;

/** Assemble RV32I source linked at address 0. Throws on any diagnostic or oversize image. */
export function assembleRv(source: string): Uint8Array {
  const r = build(source, { base: 0 });
  if (!r.ok || r.diagnostics.length) throw new Error(r.diagnostics.map(formatDiagnostic).join('\n'));
  if (r.image.length > CODE_BYTES) throw new Error(`program is ${r.image.length} bytes; the ROM holds ${CODE_BYTES}`);
  return r.image;
}

/** Program bytes as the `program` string of a test: two hex digits per byte. */
export const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export interface GoldenState {
  pc: number;
  /** x0..x31, unsigned. */
  x: number[];
  halted: boolean;
  /** Instructions executed (= cycles on the single-cycle CPU). */
  steps: number;
  /** Data RAM 0..0xFFF (bytes below 0x400 are zero on the Harvard board). */
  data: Uint8Array;
}

export class Golden {
  readonly hart: Hart;
  readonly code = new MemoryDevice('boot-rom', CODE_BYTES, false);
  readonly data = new MemoryDevice('data', DATA_END - CODE_BYTES);
  steps = 0;

  constructor(bytes: Uint8Array) {
    const bus = new Bus();
    bus.register(0, CODE_BYTES, this.code);
    bus.register(CODE_BYTES, DATA_END - CODE_BYTES, this.data);
    const ram = new MemoryDevice('unused-ram', 4096);
    bus.register(RAM_BASE, 4096, ram);
    this.code.bytes.set(bytes);
    this.hart = new Hart({ bus, ram: ram.bytes, resetVector: 0 });
  }

  get halted(): boolean {
    const pc = this.hart.pc;
    return pc < CODE_BYTES && this.code.read(pc, 4) >>> 0 === EBREAK;
  }

  /** Run up to `n` instructions, stopping at ebreak. Returns instructions executed. */
  run(n: number): number {
    let k = 0;
    while (k < n && !this.halted) {
      this.hart.step();
      if (this.hart.mcause !== 0) throw new Error(`trap ${this.hart.mcause} at pc 0x${this.hart.mepc.toString(16)} (step ${this.steps})`);
      k++;
      this.steps++;
    }
    return k;
  }

  state(): GoldenState {
    const data = new Uint8Array(DATA_END);
    data.set(this.data.bytes, CODE_BYTES);
    return { pc: this.hart.pc, x: Array.from({ length: 32 }, (_, i) => this.hart.reg(i)), halted: this.halted, steps: this.steps, data };
  }
}

/** Run a program to ebreak (throws if it does not halt within `maxSteps`). */
export function runToHalt(bytes: Uint8Array, maxSteps = 1_000_000): GoldenState {
  const g = new Golden(bytes);
  g.run(maxSteps);
  if (!g.halted) throw new Error(`program did not reach ebreak within ${maxSteps} instructions`);
  return g.state();
}
