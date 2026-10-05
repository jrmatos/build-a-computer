/**
 * Solve the first levels with the mouse (docs/plan.md "End to end", LVL-03):
 * wire level 1, then build NAND and NOT from NAND, and unlock the next level.
 */
import { expect, test, type Page } from '@playwright/test';
import { between, drawWire, expectAllPassed, openLevel, placePart, state } from './helpers';

async function expectComplete(page: Page, next: string): Promise<void> {
  const panel = page.getByRole('region', { name: 'Level' });
  await expect(panel.getByRole('heading', { name: 'Level complete' })).toBeVisible();
  await expect(panel.getByRole('button', { name: `Next: ${next}` })).toBeVisible();
}

test('level 1: wire the switch to the lamp, pass, and unlock level 2', async ({ page }) => {
  await openLevel(page, 'wires-and-lamps');
  await expect(
    page.getByRole('region', { name: 'Level' }).getByRole('heading', { name: 'Wires and lamps' }),
  ).toBeVisible();

  await drawWire(page, ['A', 'out'], ['Y', 'in']);
  const { board } = await state(page);
  const a = board.parts.find((p) => p.label === 'A')!;
  const y = board.parts.find((p) => p.label === 'Y')!;
  expect(board.wires).toEqual([
    expect.objectContaining({ from: { part: a.id, pin: 'out' }, to: { part: y.id, pin: 'in' } }),
  ]);

  await expectAllPassed(page);
  await expectComplete(page, 'Switches');
  expect((await state(page)).completed).toContain('wires-and-lamps');

  // The next level is open now.
  await page
    .getByRole('region', { name: 'Level' })
    .getByRole('button', { name: 'Next: Switches' })
    .click();
  await expect.poll(async () => (await state(page)).levelId).toBe('switches');
  await expect(
    page.getByRole('region', { name: 'Level' }).getByRole('heading', { name: 'Switches' }),
  ).toBeVisible();
});

test('LVL-03: build NOT from NAND with the mouse and unlock AND', async ({ page }) => {
  // Meet NAND is open from the start; solving it unlocks NOT.
  await openLevel(page, 'meet-nand');
  const nand = await placePart(page, 'NAND', await between(page, 'B', 'Y'));
  await drawWire(page, ['A', 'out'], [nand, 'a']);
  await drawWire(page, ['B', 'out'], [nand, 'b']);
  await drawWire(page, [nand, 'out'], ['Y', 'in']);
  await expectAllPassed(page);
  await expectComplete(page, 'NOT');

  await page
    .getByRole('region', { name: 'Level' })
    .getByRole('button', { name: 'Next: NOT' })
    .click();
  await expect.poll(async () => (await state(page)).levelId).toBe('not-gate');
  await expect(
    page.getByRole('region', { name: 'Level' }).getByRole('heading', { name: 'NOT' }),
  ).toBeVisible();

  const not = await placePart(page, 'NAND', await between(page, 'A', 'Y'));
  await drawWire(page, ['A', 'out'], [not, 'a']);
  await drawWire(page, ['A', 'out'], [not, 'b']);
  await drawWire(page, [not, 'out'], ['Y', 'in']);
  await expectAllPassed(page);
  await expectComplete(page, 'AND');
  expect((await state(page)).completed).toEqual(expect.arrayContaining(['meet-nand', 'not-gate']));
});
