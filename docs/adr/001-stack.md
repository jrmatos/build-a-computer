# ADR-001: Technology stack

- Status: Proposed (owner review required: FND-04)
- Date: 2026-10-04
- Deciders: project owner; M0 agent session
- Related: FND-01, FND-04, `docs/plan.md` → "Tech stack", "Architecture"
- Amended by: [ADR-008](008-no-backend.md) (no backend in v1)

## Context

Ground Up is a browser game where players build a computer from NAND gates up
to an OS. It needs a deterministic simulator that runs the same in a browser
worker, in Node tests and in a server verifier; a fast 2D editor; offline play;
and, from M6, optional accounts. One maintainer plus AI agents do the work, so
one language and boring, well-documented tools matter more than peak speed.

## Decision

TypeScript everywhere, in a pnpm-workspace monorepo built with Turborepo.

| Layer          | Choice (version pinned in M0)                                         |
| -------------- | --------------------------------------------------------------------- |
| Language       | TypeScript 6.0, `strict` + `noUncheckedIndexedAccess` (see ADR-004)   |
| Runtime        | Node.js 24 LTS (`.nvmrc`)                                             |
| Monorepo       | pnpm 10 workspaces + Turborepo 2                                      |
| Web app        | React 19 + Vite 8, Zustand 5 for UI state                             |
| Circuit editor | Custom Canvas 2D renderer behind a `Renderer` interface               |
| Code editor    | CodeMirror 6 (from M8)                                                |
| Simulation     | Pure TS packages on typed arrays, run in a Web Worker                 |
| Worker calls   | Comlink + transferable `ArrayBuffer`s (no SharedArrayBuffer, ADR-002) |
| Local data     | IndexedDB via Dexie 4                                                 |
| Contracts      | zod 4 schemas in `packages/schema`                                    |
| Tests          | Vitest 5, fast-check, Playwright, axe                                 |
| Lint/format    | ESLint 10 flat config + typescript-eslint 8, Prettier 3               |
| API (M6)       | NestJS on Node 24, PostgreSQL 17 + Drizzle, pg-boss                   |
| Auth (M6)      | See ADR-003                                                           |
| Hosting        | Static site (Cloudflare Pages); one API container; managed Postgres   |
| Local dev      | Docker Compose: Vite dev server, nginx production preview, Postgres   |

> **Amended by [ADR-008](008-no-backend.md) (2026-10-05).** v1 has no backend:
> the API (NestJS, PostgreSQL, Drizzle, pg-boss) and Auth (ADR-003, superseded)
> rows are dropped, hosting is a static site only (no API container or
> Postgres), and local dev in Docker Compose is the Vite dev server and the nginx
> production preview. The server verifier mentioned under Context is not built
> in v1. The table above is kept as the original decision.

## Alternatives considered

| Area                | Alternative                          | Why not                                                                                                                     |
| ------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Monorepo            | npm/yarn workspaces, Nx              | pnpm is faster and strict about phantom deps; Turbo is simpler than Nx for ~15 packages                                     |
| UI                  | Svelte, Solid, Vue                   | Smaller bundles, but React is what the owner and most agents know best; the hot path is the canvas, not the DOM             |
| Bundler             | Webpack, Rspack, Parcel              | Vite is the de facto default for React SPAs, has first-class worker support, fast HMR                                       |
| Editor rendering    | SVG/DOM nodes, PixiJS (WebGL), Konva | DOM per part fails at 2,000 parts; PixiJS stays the fallback if the 60 fps benchmark fails                                  |
| Simulation language | Rust/WASM, AssemblyScript            | Second toolchain and harder debugging; typed-array TS is fast enough for the budgets; revisit for rv32 if 10 MIPS is missed |
| Worker RPC          | Raw `postMessage`, SharedArrayBuffer | Comlink is tiny and typed; SAB needs COOP/COEP (ADR-002)                                                                    |
| State               | Redux Toolkit, Jotai                 | Zustand is smaller and usable outside React (the renderer reads the store directly)                                         |
| Validation          | Valibot, TypeBox, io-ts              | zod has the widest ecosystem and JSON Schema export                                                                         |
| Tests               | Jest, Mocha                          | Vitest shares Vite config, is ESM-native and faster                                                                         |
| API                 | Fastify alone, Hono, Express         | NestJS gives modules/guards/DI the owner already knows; heavier, but the API is small                                       |
| ORM                 | Prisma, Kysely, TypeORM              | Drizzle is SQL-first with plain migration files and no engine binary                                                        |
| Queue               | BullMQ + Redis                       | pg-boss keeps the stack to one datastore                                                                                    |

## Consequences

- One language and one test runner across simulator, UI, API and tools.
- Simulation packages must stay pure (no DOM, network or clock); ESLint enforces
  it (`eslint.config.js`, `SIM_PACKAGES`).
- New runtime dependencies need their own ADR.
- Revisit the editor renderer if the 2,000-part 60 fps budget fails, and the
  simulation language if rv32 misses 10 MIPS in Chromium.
