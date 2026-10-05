/**
 * Smoke tests for the code workspaces: a Phase 6 assembly level (with the
 * debugger) and a Track 2 JavaScript level. Show solution, run the tests, pass.
 */
import { expect, test, type Page } from '@playwright/test';
import { openLevel, state, unlockAndOpen } from './helpers';

async function showSolution(page: Page): Promise<void> {
  const panel = page.getByRole('region', { name: 'Level' });
  const before = (await state(page)).source;
  await panel.getByRole('button', { name: 'Show solution' }).click();
  await panel.getByRole('button', { name: 'Show it' }).click();
  await expect.poll(async () => (await state(page)).source).not.toBe(before);
}

async function runAndPass(page: Page): Promise<void> {
  const panel = page.getByRole('region', { name: 'Level' });
  await panel.getByRole('button', { name: 'Run tests' }).click();
  await expect(panel.getByRole('heading', { name: 'Level complete' })).toBeVisible({
    timeout: 30_000,
  });
  const summary =
    (await panel
      .getByText(/\d+ \/ \d+ passed/)
      .first()
      .textContent()) ?? '';
  const m = /(\d+) \/ (\d+) passed/.exec(summary);
  expect(m?.[1]).toBe(m?.[2]);
}

test('Phase 6 code level: solution passes and the debugger steps', async ({ page }) => {
  await unlockAndOpen(page, 'hand-encode');
  await expect(page.getByTestId('code-workspace')).toBeVisible();
  await showSolution(page);
  await runAndPass(page);

  // Debugger: reset, then step one instruction at a time.
  const controls = page.getByRole('toolbar', { name: 'Debugger' });
  await controls.getByRole('button', { name: 'Reset to the start' }).click();
  await expect.poll(async () => (await state(page)).rv?.instret).toBe(0);
  const pc = (await state(page)).rv!.pc;
  await controls.getByRole('button', { name: 'Step one instruction' }).click();
  await expect.poll(async () => (await state(page)).rv?.instret).toBe(1);
  expect((await state(page)).rv!.pc).not.toBe(pc);
  await controls.getByRole('button', { name: 'Step one instruction' }).click();
  await expect.poll(async () => (await state(page)).rv?.instret).toBe(2);
});

test('Track 2 JavaScript level: solution passes', async ({ page }) => {
  await openLevel(page, 'vectors-dot');
  await expect(page.getByTestId('js-workspace')).toBeVisible();
  await showSolution(page);
  await runAndPass(page);
});
