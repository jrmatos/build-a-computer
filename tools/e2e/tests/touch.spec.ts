/**
 * EDIT-07: pan and zoom with touch, on a phone-sized WebKit (iPhone) and
 * Chromium (Pixel). Playwright has no multi-touch API, so two-finger gestures
 * are dispatched as touch pointer events on the canvas, which is what the
 * browser turns real fingers into (the canvas has touch-action: none).
 */
import { expect, test, type Page } from '@playwright/test';
import { openLevel, state } from './helpers';

type Finger = { id: number; x: number; y: number };

async function touch(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  fingers: Finger[],
): Promise<void> {
  await page.evaluate(
    ([type, fingers]) => {
      const canvas = document.querySelector('canvas.board-canvas')!;
      fingers.forEach((f, i) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: f.id,
            pointerType: 'touch',
            isPrimary: i === 0,
            clientX: f.x,
            clientY: f.y,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    },
    [type, fingers] as const,
  );
}

/** Move fingers from `from` to `to` in a few steps, as a gesture. */
async function gesture(page: Page, from: Finger[], to: Finger[], steps = 6): Promise<void> {
  await touch(page, 'pointerdown', from);
  for (let s = 1; s <= steps; s++) {
    const k = s / steps;
    await touch(
      page,
      'pointermove',
      from.map((f, i) => ({
        id: f.id,
        x: f.x + (to[i]!.x - f.x) * k,
        y: f.y + (to[i]!.y - f.y) * k,
      })),
    );
  }
  await touch(page, 'pointerup', to);
}

test('EDIT-07: pinch zooms, two-finger drag and the hand tool pan', async ({ page }) => {
  await openLevel(page, 'meet-nand');
  const vp = page.viewportSize()!;
  const cx = vp.width / 2;
  const cy = vp.height / 2;

  // Pinch out: fingers move apart, zoom goes up.
  const z0 = (await state(page)).camera.zoom;
  await gesture(
    page,
    [
      { id: 11, x: cx - 40, y: cy },
      { id: 12, x: cx + 40, y: cy },
    ],
    [
      { id: 11, x: cx - 120, y: cy },
      { id: 12, x: cx + 120, y: cy },
    ],
  );
  const z1 = (await state(page)).camera.zoom;
  expect(z1).toBeGreaterThan(z0 * 2);

  // Pinch in zooms back out.
  await gesture(
    page,
    [
      { id: 13, x: cx - 120, y: cy },
      { id: 14, x: cx + 120, y: cy },
    ],
    [
      { id: 13, x: cx - 60, y: cy },
      { id: 14, x: cx + 60, y: cy },
    ],
  );
  const z2 = (await state(page)).camera.zoom;
  expect(z2).toBeLessThan(z1 * 0.7);

  // Two fingers moving together pan without zooming; nothing on the board changes.
  const board = (await state(page)).board;
  const c0 = (await state(page)).camera;
  await gesture(
    page,
    [
      { id: 15, x: cx - 50, y: cy },
      { id: 16, x: cx + 50, y: cy },
    ],
    [
      { id: 15, x: cx - 50 + 80, y: cy + 60 },
      { id: 16, x: cx + 50 + 80, y: cy + 60 },
    ],
  );
  const c1 = (await state(page)).camera;
  expect(c1.zoom).toBeCloseTo(c0.zoom, 5);
  // Content follows the fingers: the world point under them moves right and down, so the camera moves left and up.
  expect(c1.x).toBeLessThan(c0.x);
  expect(c1.y).toBeLessThan(c0.y);
  expect((await state(page)).board).toEqual(board);

  // Hand tool: tap it, then one finger drags the board.
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Hand' }).tap();
  await expect.poll(async () => (await state(page)).tool).toBe('hand');
  await gesture(page, [{ id: 17, x: cx, y: cy }], [{ id: 17, x: cx - 100, y: cy - 40 }]);
  const c2 = (await state(page)).camera;
  expect(c2.x).toBeGreaterThan(c1.x);
  expect(c2.y).toBeGreaterThan(c1.y);
  expect(c2.zoom).toBeCloseTo(c1.zoom, 5);
});
