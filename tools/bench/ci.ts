/**
 * `pnpm bench:ci`: every performance budget from docs/plan.md, plus the FND-09
 * offline check, in one run. Exits 1 when any budget is missed.
 *
 *  1. Production build of apps/web under the GitHub Pages subpath (with a Vite manifest).
 *  2. First-level JS, gzipped, from the manifest.
 *  3. Adder settle (tools/bench/sim-logic.bench.test.ts) and RV32 MIPS (tools/isa-runner/bench.test.ts).
 *  4. Headless Chromium: renderer frame time (bench page), time to interactive, offline reload.
 *
 * Writes bench-results.json (BENCH_OUT_DIR, default tools/bench/out) and, on
 * GitHub Actions, a summary table to $GITHUB_STEP_SUMMARY.
 * Flags: --skip-build reuses apps/web/dist and the bench build from a previous run.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { BUDGETS, CI_TTI_MULTIPLIER, type Result } from './lib/budgets.ts';
import { serveDist } from './lib/serve.ts';
import { firstLevelJs } from './lib/size.ts';
import { frameTime, offlineCheck, timeToInteractive } from './lib/web.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const web = join(repo, 'apps/web');
const dist = join(web, 'dist');
const out = resolve(process.env.BENCH_OUT_DIR ?? join(here, 'out'));
const benchDist = join(out, 'dist'); // "dist" keeps ESLint and Prettier out of it
const BASE = '/build-a-computer/';
const skipBuild = process.argv.includes('--skip-build');
mkdirSync(out, { recursive: true });

const results: Result[] = [];
const fmt = (n: number, d = 2) => n.toFixed(d);

function run(cmd: string, args: string[], env: Record<string, string> = {}): string {
  const r = spawnSync(cmd, args, {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0 && !/Test Files/.test(output))
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${output}`);
  return output;
}

function step(name: string): void {
  console.log(`\n▶ ${name}`);
}

// ---------------------------------------------------------------- builds
if (!skipBuild) {
  step('Production build (VITE_BASE=/build-a-computer/, with manifest)');
  run('pnpm', ['--filter', '@build-a-computer/web', 'exec', 'vite', 'build', '--manifest'], {
    VITE_BASE: BASE,
  });
  step('Bench page build');
  await build({
    root: web,
    configFile: join(web, 'vite.config.ts'),
    base: '/',
    logLevel: 'warn',
    build: {
      outDir: benchDist,
      emptyOutDir: true,
      rollupOptions: { input: { bench: join(web, 'bench.html') } },
    },
  });
}

// ---------------------------------------------------------------- bundle size
step('First-level JavaScript');
const size = firstLevelJs(dist);
for (const f of size.files) console.log(`  ${f.file}  ${fmt(f.gzipKb, 1)} KB gz`);
results.push({
  metric: 'JavaScript for the first level, gzipped',
  value: size.totalKb,
  unit: 'KB',
  budget: `≤ ${BUDGETS.firstLevelJsKb} KB`,
  pass: size.totalKb <= BUDGETS.firstLevelJsKb,
  note: `${size.files.length} files: entry + static imports + worker`,
});

// ---------------------------------------------------------------- adder settle
step('Adder settle (SIM-12)');
const simJson = join(out, 'sim-logic.json');
const simOut = run('pnpm', ['--filter', '@build-a-computer/sim-logic', 'bench'], {
  BENCH_OUT: simJson,
});
if (!existsSync(simJson)) throw new Error(`sim-logic bench wrote no results:\n${simOut}`);
const sim = JSON.parse(readFileSync(simJson, 'utf8')) as {
  rows: { engine: string; scenario: string; meanUs: number }[];
};
const worstSettle =
  Math.max(...sim.rows.filter((r) => r.engine === 'fast').map((r) => r.meanUs)) / 1000;
results.push({
  metric: 'Settle of a flattened 32-bit ripple adder',
  value: worstSettle,
  unit: 'ms',
  budget: `≤ ${BUDGETS.adderSettleMs} ms`,
  pass: worstSettle <= BUDGETS.adderSettleMs,
  note: 'worst mean over fast-engine scenarios',
});

// ---------------------------------------------------------------- rv32
step('RV32 interpreter (RV-04)');
const rvOut = run('pnpm', [
  'exec',
  'vitest',
  'run',
  '--root',
  'tools/isa-runner',
  'bench.test.ts',
  '--reporter=verbose',
  '--silent=false',
]);
const mips = Number(/best ([\d.]+)\)/.exec(rvOut)?.[1] ?? NaN);
results.push({
  metric: 'RISC-V interpreter speed',
  value: Number.isFinite(mips) ? mips : null,
  unit: 'MIPS',
  budget: `≥ ${BUDGETS.rv32Mips} MIPS`,
  pass: mips >= BUDGETS.rv32Mips,
  note: 'best of 3, V8 (Node)',
});

// ---------------------------------------------------------------- browser
const browser = await chromium.launch();
try {
  step('Editor frame time, 2,000 parts');
  const bench = await serveDist(benchDist, '/');
  try {
    const st = await frameTime(browser, `${bench.url}bench.html`);
    console.log(
      `  draw mean ${fmt(st.drawMean)} ms, p95 ${fmt(st.drawP95)} ms, ${fmt(st.fps, 1)} fps, ${st.visible} visible`,
    );
    results.push({
      metric: 'Editor frame time, 2,000 components',
      value: st.drawP95,
      unit: 'ms',
      budget: `≤ ${BUDGETS.frameMs} ms`,
      pass: st.drawP95 <= BUDGETS.frameMs && st.parts >= 2000,
      note: `p95 draw over ${st.frames} frames; mean ${fmt(st.drawMean)} ms`,
    });
  } finally {
    await bench.close();
  }

  step('Time to interactive (median of 3 cold loads)');
  const app = await serveDist(dist, BASE);
  try {
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) runs.push(await timeToInteractive(browser, app.url));
    runs.sort((a, b) => a - b);
    const tti = runs[1]!;
    console.log(`  ${runs.map((r) => fmt(r, 0)).join(', ')} ms`);
    results.push({
      metric: 'Time to interactive',
      value: tti,
      unit: 'ms',
      budget: `≤ ${BUDGETS.ttiMs} ms (2 s × ${CI_TTI_MULTIPLIER} CI)`,
      pass: tti <= BUDGETS.ttiMs,
      note: 'median of 3 cold loads of level 1',
    });
  } finally {
    await app.close();
  }

  step('Offline play (FND-09)');
  const offline = await offlineCheck(browser, await serveDist(dist, BASE), dist);
  for (const s of offline.steps) console.log(`  ${s}`);
  results.push({
    metric: 'Level 1 plays after reload with no network',
    value: null,
    unit: '',
    budget: 'works',
    pass: offline.pass,
    note: offline.steps.at(-1),
  });
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- report
const show = (r: Result) =>
  r.value === null ? (r.pass ? 'ok' : 'failed') : `${fmt(r.value)} ${r.unit}`;
console.log('\nPerformance budgets');
console.table(
  results.map((r) => ({
    metric: r.metric,
    value: show(r),
    budget: r.budget,
    pass: r.pass ? 'yes' : 'NO',
  })),
);
writeFileSync(join(out, 'bench-results.json'), JSON.stringify({ results }, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '## Performance budgets',
    '',
    '| | Metric | Result | Budget | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.pass ? '✅' : '❌'} | ${r.metric} | ${show(r)} | ${r.budget} | ${r.note ?? ''} |`,
    ),
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

const missed = results.filter((r) => !r.pass);
if (missed.length) {
  console.error(`\n${missed.length} budget(s) missed: ${missed.map((r) => r.metric).join('; ')}`);
  process.exit(1);
}
console.log('\nAll budgets met.');
