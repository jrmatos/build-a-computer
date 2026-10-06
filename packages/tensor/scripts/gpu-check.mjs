#!/usr/bin/env node
/* global console, process, URL, window */
/**
 * Real-GPU check: opens /gpu-check.html (served by the web app's Vite dev
 * server) in Chrome with WebGPU enabled and prints the report as JSON.
 *
 *   pnpm --filter @build-a-computer/web exec vite --port 5193 --strictPort &
 *   node packages/tensor/scripts/gpu-check.mjs [url] [--swiftshader] [--headful]
 *
 * Chrome flags: headless Chrome reaches the real GPU through Vulkan
 * (--enable-features=Vulkan --use-angle=vulkan); without them it falls back to
 * SwiftShader (a CPU implementation of WebGPU), which --swiftshader forces.
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../tools/e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5193/gpu-check.html';
const swiftshader = args.includes('--swiftshader');
const headful = args.includes('--headful');
const chromeArgs = swiftshader
  ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader']
  : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan'];
if (!headful) chromeArgs.unshift('--headless=new');

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: !headful,
  args: chromeArgs,
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => process.stderr.write(`[page] ${m.text()}\n`));
  page.on('pageerror', (e) => process.stderr.write(`[page error] ${e.message}\n`));
  await page.goto(url);
  await page.waitForFunction(() => window.__gpuCheck !== undefined, null, { timeout: Number(process.env.GPU_CHECK_TIMEOUT ?? 600_000) });
  const report = await page.evaluate(() => window.__gpuCheck);
  console.log(JSON.stringify(report, null, 2));
  const failed = [...(report.compile ?? []), ...(report.selfTest ?? []), ...(report.training ?? []), ...(report.sandbox ?? [])].filter((r) => r.ok === false);
  if (report.error || failed.length) process.exitCode = 1;
} finally {
  await browser.close();
}
