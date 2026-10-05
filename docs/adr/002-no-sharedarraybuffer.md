# ADR-002: No SharedArrayBuffer and no cross-origin isolation in v1

- Status: Proposed (owner review required: FND-04)
- Date: 2026-10-04
- Deciders: project owner; M0 agent session
- Related: E-PLAT-06, `docs/plan.md` → "Tech stack" (Worker calls), "Security and privacy"

## Context

`SharedArrayBuffer` (and `Atomics.wait`) only work on cross-origin isolated
pages, which must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). With COEP,
every cross-origin subresource and iframe must opt in. Tutorials embed YouTube
videos (privacy-enhanced `youtube-nocookie.com`), which do not send the needed
headers, so they would be blocked (E-PLAT-06). Cloudflare Pages can set the
headers, but every future embed and CDN asset would have to comply.

The simulator runs in a Web Worker. The UI needs only snapshots of watched nets
that changed, a few KB per frame, so copying them is cheap.

## Decision

- v1 sends **no** COEP or COOP header and uses **no** `SharedArrayBuffer`.
- Worker ↔ UI traffic uses Comlink with transferable `ArrayBuffer`s (zero-copy
  ownership transfer) for snapshots.
- Stop must always work without shared memory: the worker yields every 8 ms and
  checks a pause flag between slices.
- Video embeds load on click (facade), from `https://www.youtube-nocookie.com`.
- The production CSP (`docker/nginx/security-headers.conf`) allows
  `worker-src 'self' blob:` and `frame-src https://www.youtube-nocookie.com`.

## Alternatives considered

| Option                                                    | Why not                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| COOP + COEP `require-corp`, SAB ring buffer for snapshots | Blocks YouTube and any non-CORP embed                                    |
| COEP `credentialless`                                     | Not supported in every target browser (Safari); still breaks some embeds |
| Isolate only a sub-route (e.g. `/play`)                   | Two header regimes, confusing navigation and service-worker caching      |
| Open videos in a new tab                                  | Worse learning flow; kept only as a fallback                             |

## Consequences

- No `Atomics.wait`-based synchronous stop; cancellation is cooperative.
- Snapshot transfer costs a `postMessage` per frame; measured by `tools/bench`.
- Revisit if the RISC-V or tensor engine needs shared memory for its speed
  budget. That change needs a new ADR and a plan for embeds.
