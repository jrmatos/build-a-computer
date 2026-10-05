/** Pure helpers for the RV32 debugger panels (code levels). */

export const ABI_NAMES = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
] as const;

/** 8-digit hex, no prefix. */
export const hex32 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

export type Radix = 'hex' | 'dec';
export const formatReg = (v: number, radix: Radix): string => (radix === 'hex' ? `0x${hex32(v)}` : String(v | 0));

export interface Sym {
  name: string;
  addr: number;
}

/** Symbols sorted by address, without assembler-local labels (".L1"). */
export function sortSymbols(symbols: readonly Sym[]): Sym[] {
  return symbols.filter((s) => !s.name.startsWith('.')).sort((a, b) => (a.addr >>> 0) - (b.addr >>> 0));
}

/** "label+0x10" for an address, using the nearest symbol at or below it; null when none. */
export function symbolize(addr: number, sorted: readonly Sym[]): string | null {
  const a = addr >>> 0;
  let lo = 0;
  let hi = sorted.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.addr >>> 0 <= a) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return null;
  const s = sorted[best]!;
  const off = a - (s.addr >>> 0);
  // Far away from any label: probably data or another region.
  if (off > 0x10000) return null;
  return off ? `${s.name}+0x${off.toString(16)}` : s.name;
}

/**
 * Parse a memory target: hex ("0x8000_0000", "80000000"), decimal ("#1234"),
 * a register ("sp", "x2", "a0") or a symbol, each optionally "+ offset" or "- offset".
 */
export function parseAddress(text: string, regs: readonly number[] | undefined, symbols: readonly Sym[]): number | null {
  const m = /^\s*([^\s+-]+)\s*(?:([+-])\s*(\S+))?\s*$/.exec(text);
  if (!m) return null;
  const base = term(m[1]!, regs, symbols);
  if (base === null) return null;
  if (!m[2]) return base >>> 0;
  const off = term(m[3]!, undefined, []);
  if (off === null) return null;
  return (m[2] === '+' ? base + off : base - off) >>> 0;
}

function term(s: string, regs: readonly number[] | undefined, symbols: readonly Sym[]): number | null {
  const clean = s.replace(/_/g, '');
  if (/^#\d+$/.test(clean)) return Number(clean.slice(1));
  if (/^0x[0-9a-f]+$/i.test(clean)) return parseInt(clean.slice(2), 16);
  const sym = symbols.find((x) => x.name === s);
  if (sym) return sym.addr >>> 0;
  if (regs) {
    const lower = s.toLowerCase();
    const x = /^x(\d{1,2})$/.exec(lower);
    const idx = x ? Number(x[1]) : lower === 'fp' ? 8 : ABI_NAMES.indexOf(lower as (typeof ABI_NAMES)[number]);
    if (idx >= 0 && idx < 32 && regs[idx] !== undefined) return regs[idx]! >>> 0;
  }
  if (/^[0-9a-f]+$/i.test(clean)) return parseInt(clean, 16);
  return null;
}

// ---------- CSRs ----------

export const CSR_ORDER = ['mstatus', 'mepc', 'mcause', 'mtval', 'mtvec', 'mie', 'mip', 'satp'] as const;

const EXCEPTIONS: Record<number, string> = {
  0: 'instMisaligned',
  1: 'instAccessFault',
  2: 'illegalInstruction',
  3: 'breakpoint',
  4: 'loadMisaligned',
  5: 'loadAccessFault',
  6: 'storeMisaligned',
  7: 'storeAccessFault',
  8: 'ecallU',
  9: 'ecallS',
  11: 'ecallM',
  12: 'instPageFault',
  13: 'loadPageFault',
  15: 'storePageFault',
};
const INTERRUPTS: Record<number, string> = { 1: 'ssi', 3: 'msi', 5: 'sti', 7: 'mti', 9: 'sei', 11: 'mei' };

/** i18n key suffix for an mcause value: "exc.illegalInstruction", "irq.mti" or null when unknown. */
export function causeKey(mcause: number): string | null {
  const irq = (mcause >>> 31) === 1;
  const code = mcause & 0x7fffffff;
  const name = (irq ? INTERRUPTS : EXCEPTIONS)[code];
  return name ? `${irq ? 'irq' : 'exc'}.${name}` : null;
}

/** Interrupt-enable / pending bits set in mie or mip, as short names (MTI, MEI...). */
export function irqBits(v: number): string[] {
  return Object.entries(INTERRUPTS)
    .filter(([bit]) => (v >>> Number(bit)) & 1)
    .map(([, n]) => n.toUpperCase());
}

const PRIV_NAMES: Record<number, string> = { 0: 'U', 1: 'S', 3: 'M' };

/** mstatus as flags: "MIE MPIE MPP=M". */
export function decodeMstatus(v: number): string {
  const out: string[] = [];
  const flags: [string, number][] = [
    ['SIE', 1],
    ['MIE', 3],
    ['SPIE', 5],
    ['MPIE', 7],
    ['SPP', 8],
    ['MPRV', 17],
    ['SUM', 18],
    ['MXR', 19],
  ];
  for (const [n, b] of flags) if ((v >>> b) & 1) out.push(n);
  out.push(`MPP=${PRIV_NAMES[(v >>> 11) & 3] ?? '?'}`);
  return out.join(' ');
}

/** satp for Sv32: "Bare" or "Sv32 ppn=0x80010". */
export function decodeSatp(v: number): string {
  if (!(v >>> 31)) return 'Bare';
  return `Sv32 asid=${(v >>> 22) & 0x1ff} ppn=0x${(v & 0x3fffff).toString(16)}`;
}

/** mtvec: base and mode. */
export function decodeMtvec(v: number): string {
  const mode = v & 3;
  return `${mode === 1 ? 'vectored' : 'direct'} base=0x${hex32(v & ~3)}`;
}

// ---------- call stack ----------

export interface Frame {
  /** Address in the frame's function: pc for frame 0, a return address above it. */
  addr: number;
  /** How the frame was found. */
  via: 'pc' | 'ra' | 'fp';
}

/**
 * Walk frames with the standard frame-pointer layout (saved ra at fp-4,
 * caller's fp at fp-8). Frame 0 is pc, frame 1 is ra; the fp chain adds more
 * when it looks valid. `read32` returns a word or null when unknown.
 */
export function walkStack(
  pc: number,
  regs: readonly number[],
  read32: (addr: number) => number | null,
  maxFrames = 32,
): Frame[] {
  const frames: Frame[] = [{ addr: pc >>> 0, via: 'pc' }];
  const ra = (regs[1] ?? 0) >>> 0;
  if (ra) frames.push({ addr: ra, via: 'ra' });
  const sp = (regs[2] ?? 0) >>> 0;
  let fp = (regs[8] ?? 0) >>> 0;
  const seen = new Set<number>();
  while (frames.length < maxFrames && fp && fp % 4 === 0 && fp > sp && fp - sp < 0x100000 && !seen.has(fp)) {
    seen.add(fp);
    const ret = read32(fp - 4);
    const next = read32(fp - 8);
    if (ret === null || next === null || !ret) break;
    if ((ret >>> 0) !== frames[frames.length - 1]!.addr) frames.push({ addr: ret >>> 0, via: 'fp' });
    if ((next >>> 0) <= fp) break;
    fp = next >>> 0;
  }
  return frames;
}

// ---------- console ----------

/**
 * Text printed since the console was cleared. `uart` is the machine's last
 * 64 KiB of output (it slides once full; a reload empties it); `cleared` is
 * what it held when the player pressed Clear.
 */
export function sinceClear(uart: string, cleared: string): string {
  if (!cleared) return uart;
  if (uart.startsWith(cleared)) return uart.slice(cleared.length);
  if (uart.length < cleared.length) return uart;
  // The buffer slid: find where the cleared text ends by its tail.
  const tail = cleared.slice(-256);
  const at = uart.lastIndexOf(tail);
  return at >= 0 ? uart.slice(at + tail.length) : uart;
}

/** Text a console keystroke sends, or null for keys the console leaves alone. */
export function keyText(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): string | null {
  if (e.metaKey || e.altKey) return null;
  if (e.ctrlKey) {
    // Ctrl+letter sends the control code (Ctrl+C = 0x03), except copy/paste keys.
    if (/^[a-z]$/i.test(e.key) && !/^[cvx]$/i.test(e.key)) return String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64);
    return null;
  }
  if (e.key === 'Enter') return '\n';
  if (e.key === 'Backspace') return '\b';
  if (e.key === 'Tab') return '\t';
  if (e.key.length === 1) return e.key;
  return null;
}

// ---------- framebuffer ----------

/** Fill RGBA pixels from 8-bit indices and a 0x00RRGGBB palette; the screen is always opaque. */
export function paintFramebuffer(pixels: Uint8Array, palette: Uint32Array, out: Uint8ClampedArray): void {
  const n = Math.min(pixels.length, out.length >> 2);
  for (let i = 0; i < n; i++) {
    const c = palette[pixels[i]!] ?? 0;
    const o = i << 2;
    out[o] = (c >>> 16) & 255;
    out[o + 1] = (c >>> 8) & 255;
    out[o + 2] = c & 255;
    out[o + 3] = 255;
  }
}
