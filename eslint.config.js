import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Simulation packages run unchanged in the browser worker, in Node tests and in
 * the server verifier, so they never touch DOM, network or clock APIs
 * (AGENTS.md, docs/plan.md "Working agreement"). Add new sim packages here.
 */
const SIM_PACKAGES = 'packages/{sim-logic,det,rv32,asm,cc,tensor}/src/**/*.ts';

const banned = (names, message) => names.map((name) => ({ name, message }));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: [SIM_PACKAGES],
    rules: {
      'no-restricted-globals': [
        'error',
        ...banned(
          [
            'window',
            'document',
            'navigator',
            'location',
            'localStorage',
            'sessionStorage',
            'indexedDB',
          ],
          'Simulation packages must not touch the DOM or browser storage.',
        ),
        ...banned(
          ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
          'Simulation packages must not use the network.',
        ),
        ...banned(
          ['performance', 'setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame'],
          'Simulation must be deterministic: no clocks or timers.',
        ),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Simulation must be deterministic.' },
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG from @ground-up/det.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Simulation must be deterministic.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'react/*',
                'node:*',
                'fs',
                'net',
                'http',
                'https',
                'child_process',
                'worker_threads',
              ],
              message: 'Simulation packages are pure: no UI, Node or I/O imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests run only in Node and may compare against node:crypto and friends.
    files: ['packages/*/src/**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  { rules: { 'prefer-const': ['error', { destructuring: 'all' }], '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
