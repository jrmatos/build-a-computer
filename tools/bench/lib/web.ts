/**
 * Browser measurements in headless Chromium (Playwright): renderer frame time
 * on the EDIT-01 bench page, time to interactive of the production build, and
 * the FND-09 offline check.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import type { Served } from './serve.ts';

/** The first level of the game (the only one unlocked on a fresh profile). */
export const LEVEL_1 = 'wires-and-lamps';

interface BenchStats {
  parts: number;
  visible: number;
  drawMean: number;
  drawP95: number;
  fps: number;
  frames: number;
}

/** Draw 2,000 parts with a moving camera for `ms`, then read the page's own stats. */
export async function frameTime(
  browser: Browser,
  benchUrl: string,
  ms = 6000,
): Promise<BenchStats> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await ctx.newPage();
    await page.goto(`${benchUrl}?n=2000&nohud`);
    await page.waitForFunction(() => '__bench' in window);
    await page.waitForTimeout(ms); // the page keeps the last 240 frames
    return await page.evaluate(() =>
      (window as unknown as { __bench: () => BenchStats }).__bench(),
    );
  } finally {
    await ctx.close();
  }
}

/**
 * Time to interactive of a cold first visit to level 1: the later of the app
 * shell being rendered (the main menu button exists) and the end of the last
 * long task (>50 ms) before a 1-second quiet window, like Lighthouse's TTI.
 */
export async function timeToInteractive(browser: Browser, appUrl: string): Promise<number> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  });
  try {
    await ctx.addInitScript(() => {
      const w = window as unknown as { __lt: number[]; __ready?: number };
      w.__lt = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__lt.push(e.startTime + e.duration);
      }).observe({ type: 'longtask', buffered: true });
      const mo = new MutationObserver(() => {
        if (w.__ready === undefined && document.querySelector('[aria-label="Main menu"]')) {
          w.__ready = performance.now();
          mo.disconnect();
        }
      });
      mo.observe(document, { subtree: true, childList: true });
    });
    const page = await ctx.newPage();
    await page.goto(`${appUrl}#level=${LEVEL_1}`);
    await page.waitForFunction(
      () => (window as unknown as { __ready?: number }).__ready !== undefined,
      null,
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __lt: number[] };
        const last = w.__lt.length ? Math.max(...w.__lt) : 0;
        return performance.now() - last > 1000;
      },
      null,
      { timeout: 30_000, polling: 100 },
    );
    return await page.evaluate(() => {
      const w = window as unknown as { __lt: number[]; __ready: number };
      return Math.max(w.__ready, ...w.__lt);
    });
  } finally {
    await ctx.close();
  }
}

export interface OfflineReport {
  pass: boolean;
  steps: string[];
}

/**
 * FND-09: load level 1 once, stop the server and go offline, reload: the app
 * and level 1 (with its tests running in the worker) still work, and every
 * built JS/CSS file, lazy chunks included (code editor, ML, solutions), is
 * served by the service worker.
 */
export async function offlineCheck(
  browser: Browser,
  served: Served,
  dist: string,
): Promise<OfflineReport> {
  const steps: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${served.url}#level=${LEVEL_1}`);
    await page.getByRole('button', { name: 'Main menu' }).waitFor();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready; // active = install finished = everything precached
    });
    steps.push('online: first load, service worker active');

    await served.close();
    await ctx.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: 'Main menu' }).waitFor({ timeout: 15_000 });
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
    if (!controlled) throw new Error('page is not controlled by the service worker after reload');
    steps.push('offline: reload served by the service worker');

    await page.getByRole('button', { name: 'Run tests' }).first().click();
    await page
      .getByText(/\d+ \/ \d+ passed/)
      .first()
      .waitFor({ timeout: 15_000 });
    steps.push(`offline: level ${LEVEL_1} runs its tests in the worker`);

    const assets = readdirSync(join(dist, 'assets')).filter((f) => /\.(js|css)$/.test(f));
    const missing = await page.evaluate(async (files) => {
      const bad: string[] = [];
      for (const f of files) {
        const ok = await fetch(`assets/${f}`).then(
          (r) => r.ok,
          () => false,
        );
        if (!ok) bad.push(f);
      }
      return bad;
    }, assets);
    if (missing.length) throw new Error(`not available offline: ${missing.join(', ')}`);
    steps.push(
      `offline: all ${assets.length} JS/CSS files (lazy chunks included) served from the cache`,
    );
    return { pass: true, steps };
  } catch (e) {
    steps.push(`FAILED: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    return { pass: false, steps };
  } finally {
    await ctx.close();
  }
}
