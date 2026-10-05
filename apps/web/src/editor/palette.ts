/**
 * Board colors per theme. The chrome follows Excalidraw (violet accent); the
 * board follows Turing Complete (dark grid, chunky tiles, glowing signals).
 *
 * Signal colors must stay in sync with --sig-1 / --sig-0 / --sig-x in
 * styles/tokens.css (a unit test checks this). Color never carries meaning
 * alone: 1 is bright, solid and glowing, 0 is dim, X is dashed or striped.
 */
import type { Theme } from './store';

export interface Palette {
  board: string;
  gridMinor: string;
  gridMajor: string;
  /** Part tile body. */
  tile: string;
  tileEdge: string;
  tileShadow: string;
  /** Gate symbol body and outline. */
  symbolFill: string;
  symbolStroke: string;
  /** Text drawn on top of a symbol body (gate captions, DFF letters). */
  symbolText: string;
  /** Hollow parts inside a tile: inversion bubble fill, switch track off, lamp off. */
  inset: string;
  knob: string;
  /** Border and lock glyph for level-owned parts. */
  locked: string;
  label: string;
  /** Wire with no simulation snapshot. */
  wire: string;
  pinRing: string;
  sig1: string;
  sig0: string;
  sigX: string;
  /** Alpha of the halo drawn under wires carrying 1. */
  glowAlpha: number;
  accent: string;
  /** Box-select fill. */
  accentFill: string;
  handleFill: string;
  danger: string;
}

export const PALETTES: Record<Theme, Palette> = {
  dark: {
    board: '#16181d',
    gridMinor: 'rgba(255,255,255,0.045)',
    gridMajor: 'rgba(255,255,255,0.09)',
    tile: '#262a33',
    tileEdge: '#3a404c',
    tileShadow: 'rgba(0,0,0,0.45)',
    symbolFill: '#dfe3ea',
    symbolStroke: '#f4f6f9',
    symbolText: '#262a33',
    inset: '#1b1e24',
    knob: '#eef0f4',
    locked: '#5aa9e6',
    label: '#c9ced8',
    wire: '#6b7385',
    pinRing: '#16181d',
    sig1: '#5ef38c',
    sig0: '#3a4150',
    sigX: '#f59e0b',
    glowAlpha: 0.22,
    accent: '#a8a5ff',
    accentFill: 'rgba(168,165,255,0.10)',
    handleFill: '#16181d',
    danger: '#ff6b6b',
  },
  light: {
    board: '#fbfbfc',
    gridMinor: 'rgba(20,24,35,0.05)',
    gridMajor: 'rgba(20,24,35,0.10)',
    tile: '#ffffff',
    tileEdge: '#c9ced8',
    tileShadow: 'rgba(15,18,25,0.08)',
    symbolFill: '#2b303a',
    symbolStroke: '#1b1e25',
    symbolText: '#ffffff',
    inset: '#eef0f4',
    knob: '#ffffff',
    locked: '#1c7ed6',
    label: '#3d4350',
    wire: '#5d6474',
    pinRing: '#ffffff',
    sig1: '#16a34a',
    sig0: '#b8bec9',
    sigX: '#d97706',
    glowAlpha: 0.18,
    accent: '#6965db',
    accentFill: 'rgba(105,101,219,0.10)',
    handleFill: '#ffffff',
    danger: '#e03131',
  },
};

/** Color for a signal value: 1, 0, 2 (X), or undefined when nothing is simulated. */
export function signalColor(p: Palette, v: number | undefined): string {
  return v === 1 ? p.sig1 : v === 0 ? p.sig0 : v === 2 ? p.sigX : p.wire;
}

/** Opaque blend of two #rrggbb colors: t = 0 gives `a`, t = 1 gives `b`. Memoized. */
export function mix(a: string, b: string, t: number): string {
  const key = `${a}${b}${t}`;
  let out = mixCache.get(key);
  if (out) return out;
  const pa = parseHex(a);
  const pb = parseHex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  out = `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  mixCache.set(key, out);
  return out;
}

const mixCache = new Map<string, string>();

function parseHex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
