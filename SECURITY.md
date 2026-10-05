# Security policy

## Supported versions

Only the latest `main` (and the site deployed from it) gets security fixes.

## Reporting a vulnerability

Please do **not** open a public issue. Report privately through GitHub's
**Security → Report a vulnerability** (private vulnerability reporting) on this
repository. Include steps to reproduce and the impact you expect.

You should get an acknowledgement within 7 days. Once a fix ships we credit you
in the release notes unless you ask us not to.

## Scope

In scope: the web app, the API (from M6), CI workflows, and the Docker images in
this repo. Especially interesting:

- Anything that lets a save file, level file or shared board run script, read
  another player's data, or escape the simulation worker
- Bypassing server-side verification of scores (E-PLAT-02)
- CI workflows that expose secrets to pull requests from forks (E-PLAT-07)
- CSP or header weaknesses in `docker/nginx/`

Out of scope: denial of service through very large circuits on your own machine
(the simulator has event budgets by design), and reports from automated scanners
without a working proof of concept.

## Design notes

- All simulation runs in the browser; the server only stores and re-verifies.
- CI uses `pull_request` with a read-only token and no secrets.
- Auth and security code always needs owner review before merge (AGENTS.md).
