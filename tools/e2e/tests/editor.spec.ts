/**
 * Board editing with the mouse and keyboard (EDIT-03, EDIT-04): the model in
 * the store must match what the player did.
 */
import { expect, test } from '@playwright/test';
import { between, drawWire, openLevel, partCenter, placePart, state } from './helpers';

test('EDIT-03: place, move, rotate and delete a NAND', async ({ page }) => {
  await openLevel(page, 'meet-nand');
  const id = await placePart(page, 'NAND', await between(page, 'B', 'Y'));

  let s = await state(page);
  let nand = s.board.parts.find((p) => p.id === id)!;
  expect(nand).toMatchObject({ type: 'nand', rot: 0, flip: false });
  expect(Number.isInteger(nand.x) && Number.isInteger(nand.y)).toBe(true);
  expect(s.selection).toEqual([id]);
  expect(s.tool).toBe('select');

  // Rotate the selection with R, twice.
  await page.keyboard.press('r');
  await expect
    .poll(async () => (await state(page)).board.parts.find((p) => p.id === id)?.rot)
    .toBe(90);
  await page.keyboard.press('r');
  await expect
    .poll(async () => (await state(page)).board.parts.find((p) => p.id === id)?.rot)
    .toBe(180);

  // Drag it: it moves and snaps to the grid.
  const c = await partCenter(page, id);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y + 50, { steps: 5 });
  await page.mouse.move(c.x + 62, c.y + 81, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await state(page)).board.parts.find((p) => p.id === id)?.y)
    .not.toBe(nand.y);
  s = await state(page);
  const moved = s.board.parts.find((p) => p.id === id)!;
  expect(moved.x).toBeGreaterThan(nand.x);
  expect(Number.isInteger(moved.x) && Number.isInteger(moved.y)).toBe(true);
  nand = moved;

  // Delete removes it; the level's own parts stay.
  await page.keyboard.press('Delete');
  await expect
    .poll(async () => (await state(page)).board.parts.some((p) => p.id === id))
    .toBe(false);
  s = await state(page);
  expect(s.board.parts.map((p) => p.label).sort()).toEqual(['A', 'B', 'Y']);

  // Undo brings it back exactly as it was.
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await state(page)).board.parts.find((p) => p.id === id))
    .toEqual(nand);
});

test('EDIT-04: draw wires between pins, delete one, undo', async ({ page }) => {
  await openLevel(page, 'meet-nand');
  const id = await placePart(page, 'NAND', await between(page, 'B', 'Y'));
  await drawWire(page, ['A', 'out'], [id, 'a']);
  await drawWire(page, ['B', 'out'], [id, 'b']);
  // Drawn backwards, input to output, it still connects output → input.
  await drawWire(page, ['Y', 'in'], [id, 'out']);

  let s = await state(page);
  const by = (label: string) => s.board.parts.find((p) => p.label === label)!.id;
  const ends = s.board.wires
    .map((w) => `${w.from.part}:${w.from.pin}->${w.to.part}:${w.to.pin}`)
    .sort();
  expect(ends).toEqual(
    [`${by('A')}:out->${id}:a`, `${by('B')}:out->${id}:b`, `${id}:out->${by('Y')}:in`].sort(),
  );

  // Deleting the gate removes its wires too.
  await page.mouse.click((await partCenter(page, id)).x, (await partCenter(page, id)).y);
  await expect.poll(async () => (await state(page)).selection).toEqual([id]);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await state(page)).board.wires.length).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await state(page)).board.wires.length).toBe(3);
  s = await state(page);
  expect(s.board.parts.some((p) => p.id === id)).toBe(true);
});
