# ADR-008: No backend in v1

- Status: Accepted (owner decision, 2026-10-05)
- Date: 2026-10-05
- Deciders: project owner
- Related: E-DATA-02, E-DATA-03, E-PLAT-01 to E-PLAT-07 (redefined for files,
  see below); supersedes ADR-003; amends ADR-001; `docs/plan.md` → "Storage and
  files" (replaces "Backend"), M6 "Files and cloud storage", M14

## Context

The original plan (ADR-001, ADR-003, `docs/plan.md` M6) added a NestJS API on
PostgreSQL 17 with Drizzle and pg-boss, Better Auth accounts (magic link and
GitHub), server-side save sync, server re-verification of scores for
leaderboards, and shared boards stored on the server.

All simulation already runs in the browser, and every save is already
validated client-side by the zod schemas in `packages/schema`. The server would
mainly store data and re-run checks. Running it means:

- personal data (emails, OAuth ids, sessions) and the LGPD/GDPR duties that come
  with it: export, deletion, a privacy policy, a minimum age;
- a database, backups, migrations, an API container, secrets and monitoring
  for one maintainer to run and pay for;
- a larger attack surface (auth, CSRF, abuse of share titles).

Players also want to own their work: a board they can keep on disk, back up
and send to a friend without an account.

## Decision

Ground Up v1 has **no backend and no database**. It is a static site.

- **Autosave**: the board, progress and settings are saved to IndexedDB (Dexie)
  as the player works. If IndexedDB is missing or full, the app runs in memory
  with a banner and an export button (E-DATA-02).
- **Workspace file**: the player can export the whole workspace (progress,
  custom chips, boards) as one JSON file and import it on another browser or
  device. This is the backup and the way to move between devices.
- **Save to file**: like Excalidraw, a board can be saved to a file the player
  picks. Where the File System Access API is available (Chromium), the app keeps
  the file handle and autosaves to it; elsewhere it falls back to download and
  upload.
- **Imports are untrusted**: every imported file goes through schema, size and
  depth limits with prototype keys stripped (E-DATA-03), and migrations for old
  formats (E-DATA-04, E-DATA-05).
- **Sharing**: by sending a file. A compressed board in the URL fragment for
  small boards may come later; the fragment never reaches the server.
- **Leaderboards**: none in v1. The app shows the player's own local best per
  level, on the honor system; it is never presented as verified.
- **Hosting**: any static host. The reference deploy is Cloudflare Pages; the
  `web-prod` Docker image (nginx, `docker/nginx/`) serves the same build with
  the CSP and security headers.
- `docker-compose.yml` has no `db` service and no `api` profile; there is no
  `apps/api` package. CI runs lint, typecheck, test, build and the production
  image build, with no service containers.

## Alternatives considered

| Option                                     | Pros                                                                              | Cons                                                                                         | Why not                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| NestJS + Postgres + Better Auth (original) | Trusted leaderboards, accounts, sync across devices, server-hosted shares         | Personal data and LGPD/GDPR duties, ops cost, auth code to audit, a second deployable to run | The game works without it; the cost lands on one maintainer before any player needs it  |
| BaaS (Supabase, Firebase)                  | Accounts and storage with little code                                             | Still personal data, now with a vendor; lock-in; quotas and pricing; rules files to secure   | Keeps most of the privacy surface and adds a dependency, for features v1 can do without |
| Static site, client-side storage (chosen)  | No personal data, zero ops, offline-first, free static hosting, players own files | No trusted leaderboards, no accounts, no automatic sync, sharing is manual                   | -                                                                                       |

## Consequences

What we lose:

- **Trusted leaderboards.** Scores cannot be verified. Only a local,
  honor-system best is shown.
- **Accounts and sync.** No sign-in, no automatic multi-device sync; the
  workspace file replaces it.
- **Server-hosted sharing.** No share links stored on a server, no moderation
  queue.

The plan's account-era edge cases E-PLAT-01 to E-PLAT-05 were redefined for
files: import conflicts, a lost or revoked file handle, browsers without the
File System Access API, storage eviction, and (later) two devices editing one
cloud file. E-PLAT-06 and E-PLAT-07 are unchanged.

What we gain:

- **No personal data.** We collect nothing, so there is no LGPD/GDPR export or
  deletion flow, no age gate and no breach surface on our side.
- **Zero ops.** No database, backups, migrations, secrets or API uptime.
- **Offline-first.** The app works fully without a network once loaded.
- **Static hosting.** Cloudflare Pages, GitHub Pages, any CDN, or the `web-prod`
  image.
- **Players own their work** as plain files.

What we must now do:

- Treat every imported or opened file as hostile; E-DATA-03 tests cover it.
- Keep the CSP strict (`connect-src 'self'`); any new origin needs a review.
- Remove backend tasks from the v1 backlog in `docs/plan.md` (coordinator).
- ADR-003 (auth library) is superseded; ADR-001's API, auth and hosting rows are
  amended.

## Later

- **Google Drive and Dropbox storage**, entirely client-side: OAuth 2.0 with
  PKCE in the browser, the narrow `drive.file` scope (only files the app
  created or the player opened), tokens kept in memory or IndexedDB, files
  stored in the player's own cloud. This needs the provider origins added to
  `connect-src` in the CSP and its own ADR; it still needs no server of ours.
- **An optional backend**, only if verified leaderboards or hosted sharing
  become worth the cost. It would start from the original plan (ADR-001's API
  row, ADR-003) and need a new ADR that revisits this one, including the
  privacy and LGPD/GDPR work.
