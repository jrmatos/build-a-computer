/**
 * Shared steps for the end-to-end tests. Pages open with `?e2e=1`, which makes
 * the app install `window.__bac` (apps/web/src/e2e.ts): a read-only view of the
 * editor model and pin positions. Every action still goes through the real UI.
 */
import { expect, type Page } from '@playwright/test';
import { CATALOG } from '../../../packages/content/src/catalog.data.ts';

export interface Part {
  id: string;
  type: string;
  x: number;
  y: number;
  rot: number;
  flip: boolean;
  label?: string;
  locked?: boolean;
}
export interface Wire {
  id: string;
  from: { part: string; pin: string };
  to: { part: string; pin: string };
}
export interface AppState {
  levelId: string | null;
  board: { parts: Part[]; wires: Wire[] };
  selection: string[];
  tool: string;
  readOnly: boolean;
  completed: string[];
  camera: { x: number; y: number; zoom: number };
  powered: boolean | null;
  ticks: number | null;
  rv: { pc: number; instret: number; running: boolean } | null;
  source: string;
}
interface Hook {
  state(): AppState;
  pin(part: string, pin: string): { x: number; y: number };
  partCenter(part: string): { x: number; y: number };
  pinValue(part: string, pin: string): number | null;
}
type HookWindow = Window & { __bac?: Hook };

export const state = (page: Page): Promise<AppState> =>
  page.evaluate(() => (window as HookWindow).__bac!.state());

export const pinPos = (page: Page, part: string, pin: string) =>
  page.evaluate(([a, b]) => (window as HookWindow).__bac!.pin(a, b), [part, pin] as const);

export const partCenter = (page: Page, part: string) =>
  page.evaluate((a) => (window as HookWindow).__bac!.partCenter(a), part);

export const pinValue = (page: Page, part: string, pin: string) =>
  page.evaluate(([a, b]) => (window as HookWindow).__bac!.pinValue(a, b), [part, pin] as const);

/** Wait until the app booted with the hook and has a level open. */
export async function ready(page: Page, levelId?: string): Promise<void> {
  await page.waitForFunction((id) => {
    const s = (window as HookWindow).__bac?.state();
    return !!s && s.levelId !== null && (!id || s.levelId === id);
  }, levelId);
  await expect(page.getByRole('button', { name: 'Main menu' })).toBeVisible();
}

/** Open the app on a level (it must be unlocked) and wait for its board to be fitted on screen. */
export async function openLevel(page: Page, id: string): Promise<void> {
  await page.goto(`./?e2e=1#level=${id}`);
  await ready(page, id);
  await settleCamera(page);
}

/** zoomToFit runs two animation frames after a level opens; wait until the camera stops changing. */
export async function settleCamera(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const cam = () => JSON.stringify((window as HookWindow).__bac!.state().camera);
        const before = cam();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(cam() === before))),
        );
      }),
  );
}

/** Press on one pin, drag to another and let go: one new wire. */
export async function drawWire(
  page: Page,
  from: [string, string],
  to: [string, string],
): Promise<void> {
  const before = (await state(page)).board.wires.length;
  const a = await pinPos(page, ...from);
  const b = await pinPos(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 7, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).board.wires.length).toBe(before + 1);
}

/** Pick a part in the toolbar and click the board where it goes. Returns the new part's id. */
export async function placePart(
  page: Page,
  name: string,
  at: { x: number; y: number },
): Promise<string> {
  const before = new Set((await state(page)).board.parts.map((p) => p.id));
  await page
    .getByRole('toolbar', { name: 'Tools' })
    .getByRole('button', { name: `Place ${name}` })
    .click();
  await page.mouse.click(at.x, at.y);
  let id = '';
  await expect
    .poll(async () => {
      id = (await state(page)).board.parts.find((p) => !before.has(p.id))?.id ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

/** A point on the board between two parts, in client coordinates. */
export async function between(page: Page, a: string, b: string): Promise<{ x: number; y: number }> {
  const p = await partCenter(page, a);
  const q = await partCenter(page, b);
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

/** The level panel's Run tests button, then the "n / n passed" summary. */
export async function runTests(page: Page): Promise<string> {
  const panel = page.getByRole('region', { name: 'Level' });
  await panel.getByRole('button', { name: 'Run tests' }).click();
  const summary = panel.getByText(/\d+ \/ \d+ passed/).first();
  await expect(summary).toBeVisible();
  return (await summary.textContent()) ?? '';
}

export async function expectAllPassed(page: Page): Promise<void> {
  const text = await runTests(page);
  const m = /(\d+) \/ (\d+) passed/.exec(text);
  expect(m, text).not.toBeNull();
  expect(m![1]).toBe(m![2]);
}

/** A progress file (LVL-06 format) with the given levels completed. */
export function progressFile(ids: string[]): string {
  const levels: Record<string, { status: 'completed'; levelVersion: number; completedAt: string }> =
    {};
  for (const id of ids) {
    const info = CATALOG.find((l) => l.id === id);
    if (!info) throw new Error(`no level ${id}`);
    levels[id] = {
      status: 'completed',
      levelVersion: info.version,
      completedAt: '2026-01-01T00:00:00.000Z',
    };
  }
  return JSON.stringify({ kind: 'build-a-computer/progress', version: 1, levels });
}

/** Every level in a track before `id`, in play order. */
export function levelsBefore(id: string): string[] {
  const target = CATALOG.find((l) => l.id === id);
  if (!target) throw new Error(`no level ${id}`);
  return CATALOG.filter(
    (l) =>
      l.track === target.track &&
      (l.phase < target.phase || (l.phase === target.phase && l.order < target.order)),
  ).map((l) => l.id);
}

/** Import progress through the level map so `id` unlocks, then open it. */
export async function unlockAndOpen(page: Page, id: string): Promise<void> {
  await page.goto('./?e2e=1');
  await ready(page);
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitem', { name: 'Levels…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Levels' });
  await expect(dialog).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Import progress' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'progress.json',
    mimeType: 'application/json',
    buffer: Buffer.from(progressFile(levelsBefore(id))),
  });
  await expect.poll(async () => (await state(page)).completed.length).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.evaluate((lv) => (location.hash = `level=${lv}`), id);
  await ready(page, id);
  await settleCamera(page);
}

/** The level's save as stored in IndexedDB right now (what a reload would load). */
export function storedSave(
  page: Page,
  levelId: string,
): Promise<{ board: { parts: Part[]; wires: Wire[] } } | null> {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('build-a-computer');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('saves')) {
            db.close();
            resolve(null);
            return;
          }
          const get = db.transaction('saves', 'readonly').objectStore('saves').get(id);
          get.onsuccess = () => {
            db.close();
            resolve(
              (get.result as { board: { parts: Part[]; wires: Wire[] } } | undefined) ?? null,
            );
          };
          get.onerror = () => reject(get.error);
        };
      }),
    levelId,
  );
}
