# ADR-009: Offline play with vite-plugin-pwa (Workbox), prompt-to-update

- Status: Accepted
- Date: 2026-10-05
- Deciders: agent session (feat/full-computer)
- Related: FND-09, E-DATA-09, E-DATA-04, `docs/plan.md` → Stack ("Offline"), Performance budgets

## Context

The plan picks "Service worker via vite-plugin-pwa" for offline play, and
FND-09 requires that level 1 plays after a reload with no network. The site is
served from a subpath on GitHub Pages (`/build-a-computer/`), so the worker's
scope and the manifest's `start_url` must follow `VITE_BASE`. The build has
lazy chunks (code editor, ML workspace, reference solutions) and a module
worker for the simulator; all of them must be cached for offline play, not
just the shell. E-DATA-09 says an update found on reconnect must not strand
saves and must prompt, never force a reload.

## Decision

- Dev dependency `vite-plugin-pwa@^2.0.0` (generateSW mode, Workbox 7) and
  runtime dependency `workbox-window@^7.4.1` (loaded lazily by the plugin's
  `virtual:pwa-register`, ~2 KB gzipped).
- `registerType: 'prompt'`, `skipWaiting: false`, `clientsClaim: false`. The
  new worker waits until the player clicks **Reload** in the update toast
  (`apps/web/src/pwa`). A tab whose worker was replaced by another tab only
  shows the toast; it never reloads on its own.
- Precache every built file (`**/*.{js,css,html,svg,png,…}`, up to 16 MB per
  file) so lazy chunks and the sim worker work offline. Navigations fall back to
  the precached `index.html`.
- The build emits `version.json` (`saveVersion`, `workspaceVersion`, build id),
  excluded from the precache. Before reloading, the tab fetches it and refuses
  the update when the new build has older save formats than this tab (a
  rollback would hit E-DATA-04), then flushes the autosave.
- Update checks: on registration, on the `online` event and hourly.
- Manifest `scope`, `start_url` and `id` are the Vite `base`; icons are PNGs
  rendered from `public/favicon.svg`.

## Alternatives considered

| Option                                    | Pros                  | Cons                                                | Why not                                                   |
| ----------------------------------------- | --------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| Hand-written service worker               | No dependency         | Precache manifest, revisioning and cleanup by hand  | Workbox does this correctly and the plan names the plugin |
| `registerType: 'autoUpdate'`              | Always current        | Reloads under the player mid-edit                   | Violates E-DATA-09                                        |
| Runtime caching only (cache on first use) | Smaller first install | Lazy chunks never opened online are missing offline | FND-09 needs full offline play                            |

## Consequences

- Every deploy installs the full build (~1.9 MB) in the background on the next
  visit; `pnpm bench:ci` checks offline play end to end (FND-09).
- Hosts must serve `sw.js` without long caching (nginx: `no-cache` for
  everything outside `/assets/`; GitHub Pages: 10 minutes).
- A schema version bump is safe; lowering one (rollback) blocks the update
  prompt until the player exports and updates manually.
