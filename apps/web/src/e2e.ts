/**
 * End-to-end test hook (tools/e2e). Installed only when the page URL has
 * `?e2e=1`; normal play never loads this chunk. It reads state the canvas does
 * not expose to the DOM (the board model, pin positions on screen, simulator
 * values) so Playwright can aim the mouse at pins and check the model. It
 * changes nothing: every action in the tests goes through the real UI.
 */
import type { Board, Part } from '@build-a-computer/schema';
import { worldToScreen } from './editor/camera';
import { partPins, partRect } from './editor/geometry';
import { useEditor } from './editor/store';

export interface E2eHook {
  /** JSON-safe view of the editor state. */
  state(): {
    levelId: string | null;
    board: Board;
    selection: string[];
    tool: string;
    readOnly: boolean;
    completed: string[];
    camera: { x: number; y: number; zoom: number };
    powered: boolean | null;
    ticks: number | null;
    rv: { pc: number; instret: number; running: boolean } | null;
    source: string;
  };
  /** Client (page) coordinates of a pin; the part is found by id or label. */
  pin(part: string, pin: string): { x: number; y: number };
  /** Client coordinates of the centre of a part body. */
  partCenter(part: string): { x: number; y: number };
  /** Value on a part's pin from the live simulator snapshot (bus value, 0/1, or 2 for X). */
  pinValue(part: string, pin: string): number | null;
}

declare global {
  interface Window {
    __bac?: E2eHook;
  }
}

function findPart(key: string): Part {
  const parts = useEditor.getState().board.parts;
  const p = parts.find((x) => x.id === key) ?? parts.find((x) => x.label === key);
  if (!p) throw new Error(`e2e: no part "${key}"`);
  return p;
}

function toClient(wx: number, wy: number): { x: number; y: number } {
  const canvas = document.querySelector('canvas.board-canvas');
  const r = canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const s = worldToScreen(useEditor.getState().camera, wx, wy);
  return { x: r.left + s.x, y: r.top + s.y };
}

export function installE2eHook(): void {
  window.__bac = {
    state() {
      const s = useEditor.getState();
      const rv = s.rv?.state;
      return {
        levelId: s.level?.id ?? null,
        board: s.board,
        selection: s.selection,
        tool: s.tool,
        readOnly: s.readOnly,
        completed: s.completed,
        camera: s.camera,
        powered: s.snapshot?.powered ?? null,
        ticks: s.snapshot?.ticks ?? null,
        rv: rv ? { pc: rv.pc, instret: rv.instret, running: rv.running } : null,
        source: s.source,
      };
    },
    pin(part, name) {
      const p = partPins(findPart(part)).find((x) => x.name === name);
      if (!p) throw new Error(`e2e: part "${part}" has no pin "${name}"`);
      return toClient(p.wx, p.wy);
    },
    partCenter(part) {
      const r = partRect(findPart(part));
      return toClient(r.x + r.w / 2, r.y + r.h / 2);
    },
    pinValue(part, name) {
      const p = findPart(part);
      const snap = useEditor.getState().snapshot;
      if (!snap) return null;
      const key = `${p.id}:${name}`;
      const bus = snap.busPins[key];
      if (bus) return bus.x ? null : bus.v;
      return snap.pins[key] ?? null;
    },
  };
}
