import { useEffect, useState } from 'react';
import { useEditor } from '../../editor/store';
import type { WaveColors } from './waveform';

function read(el: Element | null): WaveColors {
  const cs = el ? getComputedStyle(el) : null;
  const v = (name: string, fb: string) => cs?.getPropertyValue(name).trim() || fb;
  return {
    text: v('--text', '#e6e8ec'),
    muted: v('--text-muted', '#a3a9b6'),
    faint: v('--text-faint', '#6b7280'),
    grid: v('--island-border', '#30343d'),
    high: v('--sig-1', '#5ef38c'),
    low: v('--text-faint', '#6b7280'),
    x: v('--sig-x', '#f59e0b'),
    accent: v('--accent', '#a8a5ff'),
    bg: v('--island', '#22252c'),
  };
}

/** Theme colors for canvas drawing, re-read when the theme changes. */
export function useCssColors(): WaveColors {
  const theme = useEditor((s) => s.theme);
  const [colors, setColors] = useState(() => read(typeof document === 'undefined' ? null : document.documentElement));
  useEffect(() => {
    // The theme attribute is applied after the store changes; read on the next frame.
    const id = requestAnimationFrame(() => setColors(read(document.documentElement)));
    return () => cancelAnimationFrame(id);
  }, [theme]);
  return colors;
}
