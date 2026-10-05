/**
 * Simulation controls (EDIT-12, E-SIM-08): a power cycle through the toolbar
 * clears every register and keeps the ROM. Uses the Phase 4 fetch level: a
 * ROM, a program counter and an instruction register on one clock.
 */
import { expect, test, type Page } from '@playwright/test';
import { pinValue, state, unlockAndOpen } from './helpers';

const sim = (page: Page) => page.getByRole('toolbar', { name: 'Simulation' });

async function showSolution(page: Page): Promise<void> {
  const panel = page.getByRole('region', { name: 'Level' });
  const before = (await state(page)).board.parts.length;
  await panel.getByRole('button', { name: 'Show solution' }).click();
  await panel.getByRole('button', { name: 'Show it' }).click();
  await expect.poll(async () => (await state(page)).board.parts.length).toBeGreaterThan(before);
}

/** PC, IR and PHASE lamps, read from the live simulator. */
const readout = async (page: Page) => ({
  PC: await pinValue(page, 'PC', 'in'),
  IR: await pinValue(page, 'IR', 'in'),
  PHASE: await pinValue(page, 'PHASE', 'in'),
});

/** Click "Step one tick" n times; the readout after each step. */
async function steps(page: Page, n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ticks = (await state(page)).ticks ?? 0;
    await sim(page).getByRole('button', { name: 'Step one tick' }).click();
    await expect.poll(async () => (await state(page)).ticks).toBe(ticks + 1);
    out.push(await readout(page));
  }
  return out;
}

test('E-SIM-08: power off and on clears registers and keeps the ROM', async ({ page }) => {
  await unlockAndOpen(page, 'fetch');
  await showSolution(page);
  const rom = (await state(page)).board.parts.find((p) => p.type === 'rom')!;

  if ((await state(page)).powered === false)
    await sim(page).getByRole('button', { name: 'Power on' }).click();
  await expect.poll(async () => (await state(page)).powered).toBe(true);
  await expect.poll(() => readout(page)).toEqual({ PC: 0, IR: 0, PHASE: 0 });

  const first = await steps(page, 6);
  // The first fetch read ROM[0] = 0x11 into IR, and PC moved on.
  expect(first.some((r) => r.IR === 0x11)).toBe(true);
  expect(first[first.length - 1]!.PC).toBeGreaterThan(0);

  await sim(page).getByRole('button', { name: 'Power off' }).click();
  await expect.poll(async () => (await state(page)).powered).toBe(false);
  await expect(sim(page).getByRole('button', { name: 'Power on' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await sim(page).getByRole('button', { name: 'Power on' }).click();
  await expect.poll(async () => (await state(page)).powered).toBe(true);

  // Registers start from zero again; the ROM still holds the program, so the same steps replay exactly.
  await expect.poll(() => readout(page)).toEqual({ PC: 0, IR: 0, PHASE: 0 });
  expect(await steps(page, 6)).toEqual(first);
  expect((await state(page)).board.parts.find((p) => p.id === rom.id)).toEqual(rom);
});
