import { defineConfig } from 'vitest/config';

// Reference solutions for 8- and 32-bit levels run thousands of vectors; give
// them room on a busy machine (parallel CI, Turbo running every package).
// The link checker's offline unit tests (CNT-02) run here too; its live check
// (tools/link-check/live.test.ts) runs only through `pnpm links`.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    include: ['src/**/*.test.ts', '../../tools/link-check/check.test.ts'],
  },
});
