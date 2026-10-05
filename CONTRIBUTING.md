# Contributing to Build a Computer

Thanks for helping. Build a Computer is built task by task from
[`docs/plan.md`](docs/plan.md); humans and AI agents follow the same rules in
[`AGENTS.md`](AGENTS.md).

## Setup

```sh
corepack enable          # pnpm version comes from package.json
pnpm install
pnpm dev                 # http://localhost:5173
```

Or with Docker only: `docker compose up web` (see README).

There is no backend or database to run: the app is a static site and stores
player data in the browser and in files the player owns
([ADR-008](docs/adr/008-no-backend.md)). `docker compose --profile prod up
--build web-prod` previews the production build on nginx.

## Workflow

1. Pick a task from the backlog in `docs/plan.md` whose dependencies are merged.
   Size L tasks must be split first.
2. Branch `<task-id>-<short-slug>` from `main`.
3. Write or update tests first. Edge case IDs go in test names.
4. Run `pnpm check` and `pnpm build`.
5. Open a PR using the template; tick every acceptance criterion and note any
   spec ambiguity you resolved.

## What needs extra review

Schema/save-format changes, security code (import parsing, file access, CSP), new dependencies or
licenses, curriculum text and resource links, and anything touching user data
need the project owner's approval. A new runtime dependency also needs an ADR in
`docs/adr/`.

## Style

Prettier (single quotes, 100 columns) and ESLint run in CI. Use
`pnpm format` and `pnpm lint:fix`. TypeScript is strict; avoid `any` and
non-null assertions outside typed-array hot paths.

## Content contributions

Levels, tutorials and hints live in `packages/content` and are licensed
CC BY-SA 4.0 (`LICENSE-CONTENT`). Every resource link must be fetched by you,
with the page title you saw recorded. Never add a URL you have not opened.

## Licensing of contributions

By contributing you agree that code is licensed under MIT and content under
CC BY-SA 4.0, as described in `LICENSE` and `LICENSE-CONTENT`.

## Conduct and security

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Report vulnerabilities privately
as described in [`SECURITY.md`](SECURITY.md).
