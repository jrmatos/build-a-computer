# Build a Computer

**Play it: https://jrmatos.github.io/build-a-computer/**

Build a computer from scratch, in your browser. Build a Computer is a free,
open-source game that teaches computer science by construction: start with a
NAND gate, wire up logic, arithmetic and memory, build a CPU, then write the
assembler programs, C code and operating system that run on it. It is aimed at
programmers who are new to hardware.

Everything runs in your browser: the simulator in a Web Worker, your saves on
your own machine. There is no backend, no database and no account in v1
([ADR-008](docs/adr/008-no-backend.md)); the site is static files.

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

## Where your work is stored

- **Autosave**: boards, progress and settings save to your browser's IndexedDB
  as you work. If IndexedDB is unavailable (some private modes), the app runs in
  memory and offers an export so nothing is lost silently.
- **Workspace file**: export your whole workspace as one JSON file and import it
  in another browser or on another device. This is your backup and your sync.
- **Save to file**: like Excalidraw, save a board to a file you choose. In
  Chromium-based browsers the app keeps autosaving to that file (File System
  Access API); elsewhere it downloads and re-opens files.
- **Sharing** is by sending a file. Leaderboards are not in v1; each level shows
  your own local best.

Google Drive and Dropbox storage are planned for a later milestone, still fully
client-side (OAuth in the browser, no server of ours).

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
docker compose --profile prod down                  # stop everything
```

The dev container bind-mounts the repo and keeps `node_modules` in named Docker
volumes, so it never touches your host install. Copy `.env.example` to `.env` to
change the preview port; set `CHOKIDAR_USEPOLLING=true` there if hot reload
misses file changes on your Docker setup.

## Deploy

Every push to `main` deploys to GitHub Pages
([`.github/workflows/pages.yml`](.github/workflows/pages.yml)), built with
`VITE_BASE=/build-a-computer/` because Pages serves the site from that subpath.
Pages cannot set response headers, so the CSP there is the browser default.

The site is static: `pnpm build` writes it to `apps/web/dist`. Publish that
folder to Cloudflare Pages or any static host, with a SPA
fallback to `index.html` and the headers from
[`docker/nginx/security-headers.conf`](docker/nginx/security-headers.conf)
(CSP, `nosniff`, frame denial). Or run the `web-prod` image, which is that
build on nginx with the headers already set:

```sh
docker build --target prod -t build-a-computer-web .
docker run -p 8080:80 build-a-computer-web     # http://localhost:8080, health check at /healthz
```

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

Run one package with `pnpm --filter @build-a-computer/<name> <script>`.

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
| `Dockerfile`, `docker-compose.yml` | Dev, build and prod (static nginx) images                          |
| `.github/`                         | CI workflow, PR and issue templates                                |

Later milestones add `packages/rv32`, `asm`, `cc`, `libc`, `os-kit`, `tensor`,
`platform-core` and `tools/*` (see the plan). There is no `apps/api`
([ADR-008](docs/adr/008-no-backend.md)).

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
