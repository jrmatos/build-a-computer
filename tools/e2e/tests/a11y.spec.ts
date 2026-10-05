/**
 * Accessibility (docs/plan.md "Testing and quality"): axe finds no serious or
 * critical WCAG 2.1 A/AA violations in the menus, tutorials, test results and
 * dialogs, in both themes.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { drawWire, openLevel } from './helpers';

async function expectNoSeriousViolations(page: Page, include: string): Promise<void> {
  // Contrast is measured on rendered pixels: a dialog still fading in reads as
  // near-invisible text. Let every running animation/transition settle first.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const report = serious.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n').slice(1).join(' ').trim() ?? ''}`).join('\n  ')}`,
  );
  expect(report, `axe violations in ${include}`).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      // Reduced motion makes dialogs appear without fades (the app honours it), so
      // axe never samples a half-transparent frame on slow CI runners.
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await openLevel(page, 'wires-and-lamps');
      // The app keeps its own theme setting; switch it from the menu when needed.
      const current = await page.evaluate(() => document.documentElement.dataset.theme);
      if (current !== theme) {
        await page.getByRole('button', { name: 'Main menu' }).click();
        await page
          .getByRole('menuitem', { name: theme === 'dark' ? 'Dark theme' : 'Light theme' })
          .click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toBeHidden();
      }
    });

    test('main menu', async ({ page }) => {
      await page.getByRole('button', { name: 'Main menu' }).click();
      await expect(page.getByRole('menu', { name: 'Main menu' })).toBeVisible();
      await expectNoSeriousViolations(page, '.top-left');
    });

    test('level panel with tutorial and a hint', async ({ page }) => {
      const panel = page.getByRole('region', { name: 'Level' });
      await panel.getByRole('button', { name: /Show hint/ }).click();
      await expectNoSeriousViolations(page, '.right-dock');
      await expectNoSeriousViolations(page, '.top-center');
      await expectNoSeriousViolations(page, '.top-right');
    });

    test('test results after a run', async ({ page }) => {
      await drawWire(page, ['A', 'out'], ['Y', 'in']);
      const panel = page.getByRole('region', { name: 'Level' });
      await panel.getByRole('button', { name: 'Run tests' }).click();
      await expect(panel.getByRole('heading', { name: 'Level complete' })).toBeVisible();
      await expectNoSeriousViolations(page, '.right-dock');
    });

    test('failing test results', async ({ page }) => {
      const panel = page.getByRole('region', { name: 'Level' });
      await panel.getByRole('button', { name: 'Run tests' }).click();
      await expect(panel.getByText(/0 \/ \d+ passed/).first()).toBeVisible();
      await expectNoSeriousViolations(page, '.right-dock');
    });

    test('levels dialog', async ({ page }) => {
      await page.getByRole('button', { name: 'Main menu' }).click();
      await page.getByRole('menuitem', { name: 'Levels…' }).click();
      await expect(page.getByRole('dialog', { name: 'Levels' })).toBeVisible();
      await expectNoSeriousViolations(page, '[role="dialog"]');
    });

    test('achievements dialog', async ({ page }) => {
      await page.getByRole('button', { name: 'Main menu' }).click();
      await page.getByRole('menuitem', { name: 'Achievements' }).click();
      const dialog = page.getByRole('dialog', { name: /Achievements/ });
      await expect(dialog).toBeVisible();
      await expectNoSeriousViolations(page, '[role="dialog"]');
    });

    test('help dialog', async ({ page }) => {
      await page.getByRole('button', { name: 'Main menu' }).click();
      await page.getByRole('menuitem', { name: 'Help & shortcuts' }).click();
      await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
      await expectNoSeriousViolations(page, '[role="dialog"]');
    });
  });
}
