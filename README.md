# Ground Up

Build a computer from the ground up, in your browser. Ground Up is a free,
open-source game that teaches computer science by construction: start with a
NAND gate, wire up logic, arithmetic and memory, build a CPU, then write the
assembler programs, C code and operating system that run on it. It is aimed at
programmers who are new to hardware.

All simulation runs in the browser (a Web Worker); the server, when it arrives,
only stores and re-verifies.

- Spec and backlog: [`docs/plan.md`](docs/plan.md)
- Plan as a shared doc: <https://claude.ai/artifact/SHKETuSK6EnuuL993dDKWi>
- Decisions: [`docs/adr/`](docs/adr/)
- Rules for contributors and AI agents: [`AGENTS.md`](AGENTS.md)

## Status

| Milestone                                                         | State                                 |
| ----------------------------------------------------------------- | ------------------------------------- |
| M0 Foundations: monorepo, CI, schemas, agent rules, ADRs          | Mostly done (ADRs await owner review) |
| M1 Logic simulation core: reference engine, compile, power, clock | Reference engine in place             |
| M2 Board editor                                                   | In progress                           |
| M3 Levels and first playable (first public release)               | Next                                  |

## Quick start

With Node 24 and pnpm 10:

```sh
corepack enable
pnpm install
pnpm dev            # http://localhost:5173
```

With Docker only (no local Node needed):

```sh
docker compose up web                               # dev server + hot reload, http://localhost:5173
docker compose --profile prod up --build web-prod   # production build on nginx, http://localhost:8080
docker compose --profile api up -d db               # Postgres 17, for the API (M6)
docker compose --profile prod --profile api down    # stop everything
```

The dev container bind-mounts the repo and keeps `node_modules` in named Docker
volumes, so it never touches your host install. Copy `.env.example` to `.env` to
change ports or Postgres credentials; set `CHOKIDAR_USEPOLLING=true` there if
hot reload misses file changes on your Docker setup.

## Scripts

| Script                                            | Does                                                   |
| ------------------------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                                        | Vite dev server for `apps/web`                         |
| `pnpm check`                                      | Lint + typecheck + test                                |
| `pnpm lint`                                       | ESLint, whole repo, via Turbo                          |
| `pnpm typecheck`                                  | `tsc` in every package                                 |
| `pnpm test`                                       | Vitest in every package                                |
| `pnpm build`                                      | Build every package; the site lands in `apps/web/dist` |
| `pnpm format`                                     | Prettier                                               |
| `pnpm docker:dev` / `docker:prod` / `docker:down` | Compose shortcuts                                      |

Run one package with `pnpm --filter @ground-up/<name> <script>`.

## Repo layout

| Path                               | What                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| `apps/web`                         | React 19 + Vite app: board editor, level panels, sim client        |
| `packages/schema`                  | zod schemas and types: levels, boards, saves, progress             |
| `packages/det`                     | Seeded PRNG, 32-bit helpers, canonical JSON, SHA-256               |
| `packages/sim-logic`               | Gate-level simulator: netlist compiler, reference engine, checkers |
| `packages/worker`                  | Worker host and command protocol for the simulator                 |
| `packages/content`                 | Tracks, levels and tutorials (content is CC BY-SA 4.0)             |
| `docs/plan.md`                     | Full spec, edge cases and milestone backlog                        |
| `docs/adr/`                        | Architecture decision records                                      |
| `docker/nginx/`                    | Production nginx config: SPA fallback, caching, CSP                |
| `Dockerfile`, `docker-compose.yml` | Dev, build and prod images; Postgres                               |
| `.github/`                         | CI workflow, PR and issue templates                                |

Later milestones add `packages/rv32`, `asm`, `cc`, `libc`, `os-kit`, `tensor`,
`platform-core`, `apps/api` and `tools/*` (see the plan).

## Tech

TypeScript 6 (strict) · Node 24 · pnpm workspaces + Turborepo · React 19 +
Vite 8 · Zustand · Canvas 2D · Comlink workers · Dexie · zod · Vitest. See
[ADR-001](docs/adr/001-stack.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md). Please
follow the [Code of Conduct](CODE_OF_CONDUCT.md) and report security issues as
described in [`SECURITY.md`](SECURITY.md).

## License

Code: [MIT](LICENSE). Curriculum content in `packages/content`:
[CC BY-SA 4.0](LICENSE-CONTENT).
