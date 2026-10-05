# ADR-004: Pin TypeScript to 6.0 until typescript-eslint supports 7

- Status: Accepted
- Date: 2026-10-04
- Deciders: project owner; M0 agent session
- Related: FND-01, ADR-001

## Context

TypeScript 7 (the native Go port) is out, but typescript-eslint 8 (our linter's
parser and type-aware rules) declares support only up to TypeScript 6.x. Running
it against 7 gives unsupported-version warnings and can break rules or crash.
Lint is a required CI check, so an unsupported pairing blocks every PR.

## Decision

- The root `devDependencies` pin `typescript` to 6.0 (currently `^6.0.3`,
  resolved to 6.0.3 in `pnpm-lock.yaml`; `^6` cannot pick up 7). No package
  declares its own `typescript`.
- Code stays compatible with TypeScript 7 where cheap: `isolatedModules`,
  `verbatimModuleSyntax`, `moduleResolution: "Bundler"`, no deprecated options.
- Do not add `@typescript/native-preview` or `tsgo` to scripts yet.

## Alternatives considered

| Option                                                      | Why not                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| TypeScript 7 for `tsc`, 6 only for ESLint                   | Two compilers can disagree; doubles the upgrade surface |
| TypeScript 7 and drop type-aware lint                       | Loses lint rules we rely on                             |
| TypeScript 7 and ignore typescript-eslint's version warning | Unsupported; failures would block CI unpredictably      |

## Consequences

- We miss TypeScript 7's faster type checking for now.
- Revisit when a typescript-eslint release declares TypeScript 7 support: bump
  both in one PR, run `pnpm check`, and mark this ADR superseded.
