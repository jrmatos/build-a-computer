# AGENTS.md

Rules for AI agents (and humans) working in this repo. The spec is
[`docs/plan.md`](docs/plan.md); these rules copy its "How AI agents use this
plan" section. If the two disagree, the plan wins; fix this file in your PR.

## Working agreement

- One task per branch and per pull request. Branch name: `<task-id>-<short-slug>`
  (e.g. `sim-03-reference-engine`).
- Read the task, its dependencies and its spec section in `docs/plan.md` before
  writing code.
- Write or update tests first when behavior changes. A task is not done while
  any test fails.
- Never weaken, skip or delete a test to get a green build. Flag the problem in
  the PR instead.
- No new runtime dependency without an ADR in `docs/adr/` (copy
  `docs/adr/000-template.md`).
- Simulation packages (`sim-logic`, `det`, `rv32`, `asm`, `cc`, `tensor`) never
  import DOM, network or clock APIs. See "Package boundaries".
- Never invent a URL. Every resource link is fetched by the agent, and the title
  it saw is recorded (`verifiedAt`, `verifiedTitle`).
- Any schema change needs a version bump, a forward migration, and migration
  tests.
- When a spec is ambiguous, take the simplest reading, note it in the PR, and
  add it to "Open questions" in `docs/plan.md`.
- Every edge case ID named in a task gets a test whose name contains that ID.

## Commands

Node 24 (`.nvmrc`), pnpm 10 via corepack (`corepack enable`).

| Command                                             | What it does                                            |
| --------------------------------------------------- | ------------------------------------------------------- |
| `pnpm install`                                      | Install all workspaces                                  |
| `pnpm dev`                                          | Vite dev server for `apps/web` on http://localhost:5173 |
| `pnpm check`                                        | Lint + typecheck + test (run before every PR)           |
| `pnpm lint` / `pnpm lint:fix`                       | ESLint over the whole repo (Turbo-cached)               |
| `pnpm typecheck`                                    | `tsc` per package                                       |
| `pnpm test`                                         | Vitest per package                                      |
| `pnpm build`                                        | Build every package; `apps/web` → `apps/web/dist`       |
| `pnpm --filter @ground-up/sim-logic test`           | One package only                                        |
| `pnpm format`                                       | Prettier                                                |
| `docker compose up web`                             | Dev server in Docker (hot reload), port 5173            |
| `docker compose --profile prod up --build web-prod` | nginx production build, port 8080                       |

## No backend

v1 is a static site with no backend, database or accounts
([ADR-008](docs/adr/008-no-backend.md)). Do not add a server, API package,
database service or third-party data service. Player data lives in IndexedDB
(autosave), in a workspace JSON file the player exports and imports, and in
files saved through the File System Access API (download/upload fallback).
Every imported or opened file is untrusted: validate it with the
`packages/schema` zod schemas and the E-DATA-03 size, depth and prototype-key
limits. Later cloud storage (Google Drive, Dropbox) stays client-side (OAuth
PKCE in the browser) and needs its own ADR plus a CSP review.

## Package boundaries

| Package              | May depend on     | Must not                                                  |
| -------------------- | ----------------- | --------------------------------------------------------- |
| `packages/schema`    | zod               | import any other workspace package                        |
| `packages/det`       | nothing           | use DOM, network, clock, `Math.random`                    |
| `packages/sim-logic` | schema, det       | use DOM, network, clock, `Math.random`, `Date`            |
| `packages/content`   | schema            | be imported by sim packages                               |
| `packages/worker`    | schema, sim-logic | render UI                                                 |
| `apps/web`           | everything above  | simulate on the main thread (send commands to the worker) |

`eslint.config.js` enforces the simulation rule for every package listed in
`SIM_PACKAGES`: it bans `window`, `document`, `fetch`, `WebSocket`, timers,
`performance`, `Date.now`, `new Date()`, `Math.random`, and imports of `react`,
`node:*` and I/O modules. Test files may import `node:*`. When you add `rv32`,
`asm`, `cc` or `tensor`, they are already covered by the glob. Randomness comes
from the seeded PRNG in `@ground-up/det`; 32-bit math uses `Math.imul`, `>>> 0`
and `| 0`.

## Tests

- Vitest, colocated as `src/**/*.test.ts`. Property tests use fast-check with a
  fixed seed.
- Name edge-case tests with the ID first, e.g.
  `it('E-SIM-01: a NOT gate wired to itself is reported unstable', ...)`.
  `grep -rn "E-SIM-01" packages apps` must find the test.
- Snapshot files are reviewed like code.

## Definition of done

- Every acceptance criterion is ticked in the PR description
  (`.github/pull_request_template.md`).
- Lint, type check, unit, property and end-to-end tests pass in CI.
- Performance budgets still pass.
- Public APIs have TSDoc comments, and `docs/plan.md` is updated if behavior
  changed.

## Human review gates

The project owner approves before merge for:

- schema and save-format changes
- security code (import parsing, file access, CSP and headers)
- new dependencies or licenses
- curriculum text and resource links
- anything touching user data

ADRs start as "Proposed" and become "Accepted" only after owner review.

## Licenses

Code: MIT (`LICENSE`). Curriculum content in `packages/content`: CC BY-SA 4.0
(`LICENSE-CONTENT`). Do not import third-party code or text without recording
its license and getting owner approval.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
