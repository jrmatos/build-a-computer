# Security policy

## Supported versions

Only the latest `main` (and the site deployed from it) gets security fixes.

## Reporting a vulnerability

Please do **not** open a public issue. Report privately through GitHub's
**Security → Report a vulnerability** (private vulnerability reporting) on this
repository. Include steps to reproduce and the impact you expect.

You should get an acknowledgement within 7 days. Once a fix ships we credit you
in the release notes unless you ask us not to.

## Threat model

Build a Computer v1 is a static site with no backend, no database and no accounts
([ADR-008](docs/adr/008-no-backend.md)). We hold no player data: boards and
progress live in the player's browser (IndexedDB) and in files the player saves
and opens. So the risks are on the client:

- **Imported files are untrusted.** A workspace file, saved board, level file or
  shared board may be written by an attacker. Every import is parsed as JSON
  (never evaluated), validated against the `packages/schema` zod schemas, and
  rejected past size and nesting-depth limits, with `__proto__`, `constructor`
  and `prototype` keys stripped (E-DATA-03). Saves from a newer version are
  refused, never overwritten (E-DATA-04).
- **No script from data.** Text from files (board names, labels, notes) is
  rendered as text, never as HTML.
- **Content Security Policy.** The production headers
  ([`docker/nginx/security-headers.conf`](docker/nginx/security-headers.conf))
  allow scripts only from the site itself, `connect-src 'self'`, no plugins, no
  framing of the site, and frames only from `youtube-nocookie.com`. A static
  host must send the same headers.
- **Simulation is sandboxed in a Web Worker** with event budgets, so a hostile
  circuit can at worst stall its own worker.
- **File System Access API.** The app only touches files the player picked;
  stored handles need the browser's permission again after a reload.

## Scope

In scope: the web app, CI workflows, and the Docker images in this repo.
Especially interesting:

- A save, workspace, level or shared file that runs script, pollutes
  prototypes, crashes the app persistently, or corrupts other saved data
- Escaping the simulation worker
- CSP or header weaknesses in `docker/nginx/`
- CI workflows that expose secrets to pull requests from forks (E-PLAT-07)

Out of scope: denial of service through very large circuits on your own machine
(the simulator has event budgets by design), tampering with your own local
"best" scores (they are honor-system and never presented as verified), and
reports from automated scanners without a working proof of concept.

## Design notes

- All simulation and storage run in the browser; there is no server of ours.
- Future Google Drive and Dropbox storage will stay client-side (OAuth with
  PKCE, the narrow `drive.file` scope) and will get its own review, including
  the CSP change it needs.
- CI uses `pull_request` with a read-only token and no secrets.
- Security code (import parsing, file access, CSP) always needs owner review
  before merge (AGENTS.md).
