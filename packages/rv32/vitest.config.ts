import { defineConfig } from 'vitest/config';

// Fuzz and differential suites run thousands of cases; CI runners are slower than dev machines.
export default defineConfig({ test: { testTimeout: 30_000 } });
