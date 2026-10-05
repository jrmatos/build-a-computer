/**
 * Saving (docs/plan.md "End to end"): autosave and reload (EDIT-08), the
 * whole-workspace export/import roundtrip (STO-01), two open tabs (E-DATA-01),
 * memory-only storage (E-DATA-02) and offline play (FND-09).
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { drawWire, openLevel, ready, settleCamera, state, storedSave } from './helpers';

const LEVEL = 'wires-and-lamps';

test('autosave survives a reload', async ({ page }) => {
  await openLevel(page, LEVEL);
  await drawWire(page, ['A', 'out'], ['Y', 'in']);
  const board = (await state(page)).board;
  // Autosave lands about a second after the last edit.
  await expect.poll(async () => (await storedSave(page, LEVEL))?.board.wires.length ?? 0).toBe(1);

  await page.reload();
  await ready(page, LEVEL);
  expect((await state(page)).board).toEqual(board);
});

test('workspace export and import roundtrip', async ({ page, browser }) => {
  await openLevel(page, LEVEL);
  await drawWire(page, ['A', 'out'], ['Y', 'in']);
  const board = (await state(page)).board;

  await page.getByRole('button', { name: 'Main menu' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export everything…' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^build-a-computer-workspace-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const path = await download.path();
  const text = await readFile(path, 'utf8');
  const workspace = JSON.parse(text) as { kind: string; saves: Record<string, { board: unknown }> };
  expect(workspace.kind).toBe('build-a-computer/workspace');
  expect(workspace.saves[LEVEL]?.board).toEqual(board);

  // A fresh browser profile: same level, empty board, then import the file.
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const fresh = await other.newPage();
    await openLevel(fresh, LEVEL);
    expect((await state(fresh)).board.wires).toHaveLength(0);
    await fresh.getByRole('button', { name: 'Main menu' }).click();
    const chooser = fresh.waitForEvent('filechooser');
    await fresh.getByRole('menuitem', { name: 'Import…' }).click();
    await (
      await chooser
    ).setFiles({
      name: download.suggestedFilename(),
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    const dialog = fresh.getByRole('dialog', { name: /^Import / });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await state(fresh)).board).toEqual(board);
  } finally {
    await other.close();
  }
});

test('E-DATA-01: a second tab on the same level is read-only until it takes over', async ({
  page,
  context,
}) => {
  await openLevel(page, LEVEL);
  const second = await context.newPage();
  await openLevel(second, LEVEL);

  const banner = second
    .getByRole('status')
    .filter({ hasText: 'This level is open in another tab' });
  await expect(banner).toBeVisible();
  expect((await state(second)).readOnly).toBe(true);
  await expect(
    second.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Wire' }),
  ).toBeDisabled();
  expect((await state(page)).readOnly).toBe(false);

  // The first tab's edit reaches the second when it takes over.
  await drawWire(page, ['A', 'out'], ['Y', 'in']);
  await banner.getByRole('button', { name: 'Take over' }).click();
  await expect.poll(async () => (await state(second)).readOnly).toBe(false);
  await expect(banner).toBeHidden();
  await expect.poll(async () => (await state(second)).board.wires.length).toBe(1);

  // Now the first tab is the read-only one.
  await expect(
    page.getByRole('status').filter({ hasText: 'Another tab took over this level' }),
  ).toBeVisible();
  expect((await state(page)).readOnly).toBe(true);
});

test('E-DATA-02: without storage the game runs from memory and offers an export', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
  });
  await openLevel(page, LEVEL);
  const banner = page.getByRole('alert').filter({ hasText: 'Storage is unavailable' });
  await expect(banner).toBeVisible();
  await drawWire(page, ['A', 'out'], ['Y', 'in']);
  const downloading = page.waitForEvent('download');
  await banner.getByRole('button', { name: 'Export board' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`build-a-computer-${LEVEL}.json`);
  const save = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    board: { wires: unknown[] };
  };
  expect(save.board.wires).toHaveLength(1);
});

test('FND-09: level 1 plays offline after one visit', async ({ page, context, browserName }) => {
  await openLevel(page, LEVEL);
  // Active = installed = the whole build is precached.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  const reloaded = await page.reload().then(
    () => null,
    (e: unknown) => String(e),
  );
  // Playwright's WebKit applies offline emulation below the service worker, so the
  // reload fails there before the worker can answer it. Chromium must pass.
  test.skip(
    reloaded !== null && browserName !== 'chromium',
    `${browserName}: offline emulation blocks service-worker responses under Playwright (${reloaded})`,
  );
  expect(reloaded).toBeNull();
  await ready(page, LEVEL);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await settleCamera(page);
  await drawWire(page, ['A', 'out'], ['Y', 'in']);
  const panel = page.getByRole('region', { name: 'Level' });
  await panel.getByRole('button', { name: 'Run tests' }).click();
  await expect(panel.getByRole('heading', { name: 'Level complete' })).toBeVisible();
});
