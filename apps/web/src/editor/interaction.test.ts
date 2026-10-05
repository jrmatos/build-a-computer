import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Level } from '@build-a-computer/schema';
import { partPins } from './geometry';
import { Interaction, clickActionOf, ghostOrigin, snap, snapDelta, wheelAction, type PointerInput } from './interaction';
import { addPart, addWire } from './ops';
import { commandFor, parseClip } from './shortcuts';
import { useEditor } from './store';
import { paletteShortcuts } from './tools';

const S = 20; // pixels per cell at zoom 1 with the camera at the origin

const ptr = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({
  id: 1,
  x: x * S,
  y: y * S,
  button: 0,
  shift: false,
  alt: false,
  mod: false,
  pointerType: 'mouse',
  ...extra,
});

function drag(ctrl: Interaction, from: [number, number], to: [number, number], extra: Partial<PointerInput> = {}) {
  ctrl.down(ptr(from[0], from[1], extra));
  ctrl.move(ptr((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra));
  ctrl.move(ptr(to[0], to[1], extra));
  ctrl.up(ptr(to[0], to[1], extra));
}

const click = (ctrl: Interaction, x: number, y: number, extra: Partial<PointerInput> = {}) => {
  ctrl.down(ptr(x, y, extra));
  ctrl.up(ptr(x, y, extra));
};

function reset() {
  useEditor.setState({
    board: { parts: [], wires: [] },
    past: [],
    future: [],
    transientBase: null,
    selection: [],
    tool: 'select',
    toolLocked: false,
    camera: { x: 0, y: 0, zoom: 1 },
    readOnly: false,
    level: null,
    contextMenu: null,
    editingLabel: null,
  });
}

function withParts(...specs: [Parameters<typeof addPart>[1], number, number][]): string[] {
  let b = useEditor.getState().board;
  const ids: string[] = [];
  for (const [type, x, y] of specs) {
    const [nb, p] = addPart(b, type, x, y);
    b = nb;
    ids.push(p.id);
  }
  useEditor.setState({ board: b });
  return ids;
}

describe('pure helpers', () => {
  it('wheel pans, shift pans sideways, mod zooms', () => {
    expect(wheelAction({ x: 0, y: 0, deltaX: 0, deltaY: 30, deltaMode: 0, mod: false, shift: false })).toEqual({ kind: 'pan', dx: 0, dy: 30 });
    expect(wheelAction({ x: 0, y: 0, deltaX: 0, deltaY: 30, deltaMode: 0, mod: false, shift: true })).toEqual({ kind: 'pan', dx: 30, dy: 0 });
    expect(wheelAction({ x: 0, y: 0, deltaX: 0, deltaY: 3, deltaMode: 1, mod: false, shift: false })).toEqual({ kind: 'pan', dx: 0, dy: 48 });
    const z = wheelAction({ x: 0, y: 0, deltaX: 0, deltaY: -100, deltaMode: 0, mod: true, shift: false });
    expect(z.kind).toBe('zoom');
    if (z.kind === 'zoom') expect(z.factor).toBeGreaterThan(1);
    const out = wheelAction({ x: 0, y: 0, deltaX: 0, deltaY: 4, deltaMode: 0, mod: true, shift: false });
    if (out.kind === 'zoom') expect(out.factor).toBeLessThan(1);
  });

  it('snaps to whole cells', () => {
    expect(snap({ x: 1.4, y: -2.6 })).toEqual({ x: 1, y: -3 });
    expect(snapDelta({ x: 0.2, y: 0.2 }, { x: 2.9, y: 0.4 })).toEqual({ x: 3, y: 0 });
    // A NAND body is 3x3 from (0,-0.5): centered on the cursor.
    expect(ghostOrigin('nand', { x: 10, y: 10 })).toEqual({ x: 9, y: 9 });
  });

  it('palette shortcuts follow PART_ORDER and the level palette', () => {
    const level = { palette: ['nand', 'switch', 'lamp'] } as Pick<Level, 'palette'>;
    expect(paletteShortcuts(level)).toEqual([
      { key: '3', type: 'switch' },
      { key: '4', type: 'lamp' },
      { key: '5', type: 'nand' },
    ]);
    const all = paletteShortcuts(null);
    expect(all).toHaveLength(7);
    expect(all[6]).toEqual({ key: '9', type: 'nor' });
  });

  it('maps keys to commands', () => {
    const k = (key: string, code: string, m: Partial<{ shift: boolean; alt: boolean; mod: boolean }> = {}) =>
      commandFor({ key, code, shift: false, alt: false, mod: false, ...m }, { palette: ['nand'] });
    expect(k('1', 'Digit1')).toEqual({ kind: 'tool', tool: 'select' });
    expect(k('w', 'KeyW')).toEqual({ kind: 'tool', tool: 'wire' });
    expect(k('3', 'Digit3')).toEqual({ kind: 'tool', tool: 'place:nand' });
    expect(k('4', 'Digit4')).toBeNull();
    expect(k('!', 'Digit1', { shift: true })).toEqual({ kind: 'fit' });
    expect(k('@', 'Digit2', { shift: true })).toEqual({ kind: 'fitSelection' });
    expect(k('H', 'KeyH', { shift: true })).toEqual({ kind: 'flip' });
    expect(k('h', 'KeyH')).toEqual({ kind: 'tool', tool: 'hand' });
    expect(k('R', 'KeyR', { shift: true })).toEqual({ kind: 'rotate', dir: -1 });
    expect(k('Z', 'KeyZ', { mod: true, shift: true })).toEqual({ kind: 'redo' });
    expect(k('z', 'KeyZ', { mod: true })).toEqual({ kind: 'undo' });
    expect(k('0', 'Digit0', { mod: true })).toEqual({ kind: 'resetZoom' });
    expect(k("'", 'Quote', { mod: true })).toEqual({ kind: 'grid' });
    expect(k('Î', 'KeyD', { alt: true, shift: true })).toEqual({ kind: 'theme' });
    expect(k('?', 'Slash', { shift: true })).toEqual({ kind: 'help' });
    expect(k('ArrowLeft', 'ArrowLeft', { shift: true })).toEqual({ kind: 'nudge', dx: -5, dy: 0 });
    expect(k('c', 'KeyC', { mod: true })).toBeNull(); // handled by the copy event
  });

  it('only accepts well-formed clipboard JSON', () => {
    expect(parseClip('hello')).toBeNull();
    expect(parseClip('{"kind":"build-a-computer/clipboard","parts":[{"id":1}],"wires":[]}')).toBeNull();
    const ok = parseClip(
      JSON.stringify({ kind: 'build-a-computer/clipboard', parts: [{ id: 'p1', type: 'nand', x: 0, y: 0, rot: 0, flip: false }], wires: [] }),
    );
    expect(ok?.parts).toHaveLength(1);
  });

  it('legacy ground-up kinds load: a pre-rename clipboard paste still parses', () => {
    const legacy = parseClip(
      JSON.stringify({ kind: 'ground-up/clipboard', parts: [{ id: 'p1', type: 'nand', x: 0, y: 0, rot: 0, flip: false }], wires: [] }),
    );
    expect(legacy?.kind).toBe('build-a-computer/clipboard');
    expect(legacy?.parts).toHaveLength(1);
    expect(parseClip(JSON.stringify({ kind: 'other/clipboard', parts: [], wires: [] }))).toBeNull();
  });
});

describe('Interaction', () => {
  let ctrl: Interaction;
  const toggle = vi.fn();
  beforeEach(() => {
    reset();
    toggle.mockReset();
    ctrl = new Interaction({ toggleSwitch: toggle });
  });

  it('places a part with the place tool, selects it and returns to select', () => {
    useEditor.getState().setTool('place:nand');
    click(ctrl, 10, 10);
    const s = useEditor.getState();
    expect(s.board.parts).toHaveLength(1);
    expect(s.board.parts[0]).toMatchObject({ type: 'nand', x: 9, y: 9 });
    expect(s.selection).toEqual([s.board.parts[0]!.id]);
    expect(s.tool).toBe('select');
  });

  it('keeps the place tool when locked', () => {
    useEditor.setState({ toolLocked: true });
    useEditor.getState().setTool('place:not');
    click(ctrl, 10, 10);
    click(ctrl, 20, 10);
    expect(useEditor.getState().board.parts).toHaveLength(2);
    expect(useEditor.getState().tool).toBe('place:not');
  });

  it('drags a part by whole cells as one undo step', () => {
    const [id] = withParts(['nand', 0, 0]);
    drag(ctrl, [1.5, 1], [4.3, 3.1]);
    const s = useEditor.getState();
    expect(s.board.parts[0]).toMatchObject({ x: 3, y: 2 });
    expect(s.selection).toEqual([id]);
    expect(s.past).toHaveLength(1);
    s.undo();
    expect(useEditor.getState().board.parts[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('alt+drag duplicates and moves the copy', () => {
    const [id] = withParts(['nand', 0, 0]);
    drag(ctrl, [1.5, 1], [6.5, 1], { alt: true });
    const s = useEditor.getState();
    expect(s.board.parts).toHaveLength(2);
    expect(s.board.parts.find((p) => p.id === id)).toMatchObject({ x: 0, y: 0 });
    const copy = s.board.parts.find((p) => p.id !== id)!;
    expect(copy).toMatchObject({ x: 5, y: 0 });
    expect(s.selection).toEqual([copy.id]);
    expect(s.past).toHaveLength(1);
  });

  it('box selects only fully contained parts, shift adds', () => {
    const [a, b] = withParts(['nand', 0, 0], ['nand', 10, 0]);
    drag(ctrl, [-1, -2], [4, 4]);
    expect(useEditor.getState().selection).toEqual([a]);
    drag(ctrl, [-1, -2], [12, 4]); // b is only partly inside
    expect(useEditor.getState().selection).toEqual([a]);
    drag(ctrl, [9, -2], [14, 4], { shift: true });
    expect(useEditor.getState().selection.sort()).toEqual([a, b].sort());
    click(ctrl, 30, 30);
    expect(useEditor.getState().selection).toEqual([]);
  });

  it('shift-click toggles membership', () => {
    const [a, b] = withParts(['nand', 0, 0], ['nand', 10, 0]);
    click(ctrl, 1.5, 1);
    click(ctrl, 11.5, 1, { shift: true });
    expect(useEditor.getState().selection).toEqual([a, b]);
    click(ctrl, 1.5, 1, { shift: true });
    expect(useEditor.getState().selection).toEqual([b]);
  });

  it('clicking a switch toggles it and selects it; dragging does not toggle', () => {
    const [sw] = withParts(['switch', 0, 0]);
    click(ctrl, 0.8, 1);
    expect(toggle).toHaveBeenCalledWith(sw);
    expect(useEditor.getState().selection).toEqual([sw]);
    drag(ctrl, [0.8, 1], [5, 1]);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('drags a wire from pin to pin', () => {
    const [sw, lamp] = withParts(['switch', 0, 0], ['lamp', 6, 0]);
    // switch out pin at (2,1), lamp in pin at (6,1)
    drag(ctrl, [2, 1], [6, 1]);
    const w = useEditor.getState().board.wires;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ from: { part: sw, pin: 'out' }, to: { part: lamp, pin: 'in' }, points: [] });
    expect(ctrl.mode.kind).toBe('idle');
  });

  it('shows a wire preview and highlights the target pin while dragging', () => {
    withParts(['switch', 0, 0], ['lamp', 6, 0]);
    ctrl.down(ptr(2, 1));
    ctrl.move(ptr(4, 3));
    expect(ctrl.overlay.wirePreview?.[0]).toEqual({ x: 2, y: 1 });
    ctrl.move(ptr(6.1, 1));
    expect(ctrl.overlay.hoverPin).toEqual({ x: 6, y: 1 });
    expect(ctrl.cursor).toBe('crosshair');
  });

  it('click-to-route adds waypoints and finishes on a pin', () => {
    const [, lamp] = withParts(['switch', 0, 0], ['lamp', 6, 10]);
    click(ctrl, 2, 1); // click a pin: start routing
    expect(ctrl.mode.kind).toBe('route');
    click(ctrl, 4.2, 1.1);
    click(ctrl, 3.9, 11.2);
    click(ctrl, 6, 11);
    const w = useEditor.getState().board.wires;
    expect(w).toHaveLength(1);
    expect(w[0]!.points).toEqual([
      [4, 1],
      [4, 11],
    ]);
    expect(w[0]!.to.part).toBe(lamp);
  });

  it('drag released on empty continues routing; Escape-style cancel adds nothing', () => {
    withParts(['switch', 0, 0]);
    drag(ctrl, [2, 1], [5, 4]);
    expect(ctrl.mode).toMatchObject({ kind: 'route', points: [[5, 4]] });
    expect(ctrl.cancel()).toBe(true);
    expect(useEditor.getState().board.wires).toHaveLength(0);
    expect(ctrl.overlay.wirePreview).toBeUndefined();
  });

  it('never wires a pin to itself', () => {
    withParts(['switch', 0, 0]);
    click(ctrl, 2, 1);
    click(ctrl, 2, 1);
    expect(useEditor.getState().board.wires).toHaveLength(0);
    expect(ctrl.mode.kind).toBe('idle');
  });

  it('right-click cancels routing without a menu, otherwise opens the menu and selects', () => {
    const [sw] = withParts(['switch', 0, 0], ['lamp', 6, 0]);
    click(ctrl, 2, 1);
    ctrl.down(ptr(8, 8, { button: 2 }));
    ctrl.contextMenu(8 * S, 8 * S, 8 * S, 8 * S);
    expect(ctrl.mode.kind).toBe('idle');
    expect(useEditor.getState().contextMenu).toBeNull();
    ctrl.down(ptr(0.8, 1, { button: 2 }));
    ctrl.contextMenu(0.8 * S, 1 * S, 100, 200);
    expect(useEditor.getState().selection).toEqual([sw]);
    expect(useEditor.getState().contextMenu).toMatchObject({ x: 100, y: 200 });
  });

  it('pans with the hand tool, space and the middle button', () => {
    useEditor.getState().setTool('hand');
    drag(ctrl, [5, 5], [3, 4]);
    expect(useEditor.getState().camera).toMatchObject({ x: 2, y: 1 });
    useEditor.getState().setTool('select');
    drag(ctrl, [5, 5], [6, 5], { button: 1 });
    expect(useEditor.getState().camera).toMatchObject({ x: 1, y: 1 });
    ctrl.setSpace(true);
    expect(ctrl.cursor).toBe('grab');
  });

  it('zooms at the cursor on mod+wheel', () => {
    const before = { x: 7, y: 3 };
    ctrl.wheel({ x: 7 * S, y: 3 * S, deltaX: 0, deltaY: -50, deltaMode: 0, mod: true, shift: false });
    const c = useEditor.getState().camera;
    expect(c.zoom).toBeGreaterThan(1);
    const s = c.zoom * S;
    expect((7 * S) / s + c.x).toBeCloseTo(before.x);
    expect((3 * S) / s + c.y).toBeCloseTo(before.y);
  });

  it('pinch zooms with two touches', () => {
    const t = (id: number, x: number, y: number): PointerInput => ({ ...ptr(x, y), id, pointerType: 'touch' });
    ctrl.down(t(1, 4, 5));
    ctrl.down(t(2, 6, 5));
    ctrl.move(t(2, 8, 5));
    expect(useEditor.getState().camera.zoom).toBeCloseTo(2);
    ctrl.up(t(2, 8, 5));
    ctrl.up(t(1, 4, 5));
    expect(ctrl.mode.kind).toBe('idle');
  });

  it('read-only boards select and toggle but do not move, wire or place', () => {
    const [sw] = withParts(['switch', 0, 0], ['lamp', 6, 0]);
    useEditor.setState({ readOnly: true });
    drag(ctrl, [0.8, 1], [4, 1]);
    expect(useEditor.getState().board.parts[0]).toMatchObject({ x: 0, y: 0 });
    drag(ctrl, [2, 1], [6, 1]);
    expect(useEditor.getState().board.wires).toHaveLength(0);
    click(ctrl, 0.8, 1);
    expect(toggle).toHaveBeenCalledWith(sw);
    expect(ctrl.place('nand', { x: 20, y: 20 })).toBeNull();
  });

  it('double-click starts label editing', () => {
    const [id] = withParts(['nand', 0, 0]);
    ctrl.doubleClick(1.5 * S, 1 * S);
    expect(useEditor.getState().editingLabel).toBe(id);
  });

  it('pin positions used in these tests are right', () => {
    const [sw] = withParts(['switch', 0, 0]);
    const part = useEditor.getState().board.parts.find((p) => p.id === sw)!;
    expect(partPins(part).map((p) => [p.wx, p.wy])).toEqual([[2, 1]]);
  });
});

describe('Interaction: inputs, chips and probes', () => {
  let ctrl: Interaction;
  const toggle = vi.fn();
  const press = vi.fn();
  const openNumber = vi.fn();
  const enter = vi.fn();
  beforeEach(() => {
    reset();
    for (const f of [toggle, press, openNumber, enter]) f.mockReset();
    ctrl = new Interaction({ toggleSwitch: toggle, press, openNumberInput: openNumber, enterChip: enter });
  });

  const setProps = (id: string, props: Record<string, unknown>) =>
    useEditor.setState({ board: { ...useEditor.getState().board, parts: useEditor.getState().board.parts.map((p) => (p.id === id ? { ...p, props } : p)) } });

  it('placing a part gives it the type defaults', () => {
    useEditor.getState().setTool('place:ram');
    click(ctrl, 10, 10);
    expect(useEditor.getState().board.parts[0]!.props).toEqual({ width: 8, addrWidth: 4 });
    useEditor.getState().setTool('place:nand');
    click(ctrl, 30, 10);
    expect(useEditor.getState().board.parts[1]!.props).toEqual({ width: 1 });
  });

  it('a 1-bit switch toggles; a wide switch opens the number input', () => {
    const [sw] = withParts(['switch', 0, 0]);
    click(ctrl, 1, 1);
    expect(toggle).toHaveBeenCalledWith(sw);
    setProps(sw!, { width: 8 });
    click(ctrl, 1, 1);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(openNumber).toHaveBeenCalledWith(sw);
  });

  it('a clock does nothing on click besides selecting', () => {
    const [clk] = withParts(['clock', 0, 0]);
    click(ctrl, 1, 1);
    expect(toggle).not.toHaveBeenCalled();
    expect(useEditor.getState().selection).toEqual([clk]);
  });

  it('a button is held while pressed and does not drag', () => {
    const [b] = withParts(['button', 0, 0]);
    ctrl.down(ptr(1, 1));
    expect(press).toHaveBeenLastCalledWith(b, true);
    ctrl.move(ptr(4, 4));
    expect(useEditor.getState().board.parts[0]).toMatchObject({ x: 0, y: 0 });
    ctrl.up(ptr(4, 4));
    expect(press).toHaveBeenLastCalledWith(b, false);
    expect(press).toHaveBeenCalledTimes(2);
  });

  it('a button is released when the pointer leaves the canvas', () => {
    const [b] = withParts(['button', 0, 0]);
    ctrl.down(ptr(1, 1));
    ctrl.leave();
    expect(press).toHaveBeenLastCalledWith(b, false);
  });

  it('a selected button can still be dragged away', () => {
    const [b] = withParts(['button', 0, 0]);
    useEditor.getState().setSelection([b!]);
    drag(ctrl, [1, 1], [5, 1]);
    expect(useEditor.getState().board.parts[0]).toMatchObject({ x: 4, y: 0 });
    expect(press).toHaveBeenLastCalledWith(b, false);
  });

  it('read-only boards still accept inputs', () => {
    const [sw, b] = withParts(['switch', 0, 0], ['button', 10, 0]);
    useEditor.setState({ readOnly: true });
    click(ctrl, 1, 1);
    expect(toggle).toHaveBeenCalledWith(sw);
    click(ctrl, 11, 1);
    expect(press).toHaveBeenCalledWith(b, true);
  });

  it('double-clicking a chip enters it; other parts edit their label', () => {
    let board = useEditor.getState().board;
    const [b1, chipPart] = addPart(board, 'chip', 0, 0, { chip: 'c1' });
    board = b1;
    const [b2, nand] = addPart(board, 'nand', 20, 0);
    useEditor.setState({ board: b2 });
    ctrl.doubleClick(1 * S, 0.5 * S);
    expect(enter).toHaveBeenCalledWith(chipPart.id);
    ctrl.doubleClick(21.5 * S, 1 * S);
    expect(useEditor.getState().editingLabel).toBe(nand.id);
  });

  it('places chips only when they exist and would not contain themselves', () => {
    const def = { id: 'c1', name: 'C', version: 1, board: { parts: [], wires: [] }, ports: { inputs: [], outputs: [] } };
    useEditor.setState({ chips: { c1: def } });
    expect(ctrl.place('chip', { x: 5, y: 5 }, 'nope')).toBeNull();
    const id = ctrl.place('chip', { x: 5, y: 5 }, 'c1');
    expect(useEditor.getState().board.parts.find((p) => p.id === id)).toMatchObject({ type: 'chip', chip: 'c1' });
    useEditor.setState({ editStack: [{ chipId: 'c1', parentBoard: { parts: [], wires: [] }, parentPast: [], parentFuture: [], parentSelection: [] }] });
    expect(ctrl.place('chip', { x: 5, y: 5 }, 'c1')).toBeNull();
    useEditor.setState({ chips: {}, editStack: [] });
  });

  it('EDIT-09: hovering a wire targets the probe; Alt+hover targets a pin', () => {
    const [n, l] = withParts(['nand', 0, 0], ['lamp', 10, 0]);
    const st = useEditor.getState();
    st.commit((b) => addWire(b, { part: n!, pin: 'out' }, { part: l!, pin: 'in' })[0]);
    const wid = useEditor.getState().board.wires[0]!.id;
    ctrl.move(ptr(6, 1));
    expect(ctrl.probe?.target).toEqual({ kind: 'wire', id: wid });
    ctrl.move(ptr(10, 1));
    expect(ctrl.probe).toBeNull();
    ctrl.setAlt(true);
    expect(ctrl.probe?.target).toEqual({ kind: 'pin', ref: { part: l, pin: 'in' } });
    ctrl.leave();
    expect(ctrl.probe).toBeNull();
  });

  it('clickActionOf', () => {
    expect(clickActionOf({ id: 'a', type: 'switch', x: 0, y: 0, rot: 0, flip: false })).toBe('toggle');
    expect(clickActionOf({ id: 'a', type: 'switch', x: 0, y: 0, rot: 0, flip: false, props: { width: 4 } })).toBe('number');
    expect(clickActionOf({ id: 'a', type: 'clock', x: 0, y: 0, rot: 0, flip: false })).toBeNull();
  });
});
