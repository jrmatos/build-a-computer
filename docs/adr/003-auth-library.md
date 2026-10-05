# ADR-003: Authentication library

- Status: **Superseded by [ADR-008](008-no-backend.md)** (2026-10-05: v1 has no backend and no accounts; the text below is kept as history)
- Date: 2026-10-04
- Deciders: project owner
- Related: API-03, E-PLAT-01, E-PLAT-05, `docs/plan.md` → "Backend", "Security and privacy", "Open questions" (accounts from 16)

## Context

Accounts arrive in M6 and are optional: guests play with local saves and no
personal data. Signed-in players sync saves and progress. Requirements:

- Email magic link and GitHub OAuth; no passwords to store.
- Cookie sessions stored in Postgres, CSRF protection on writes.
- Self-hosted, TypeScript, works with NestJS + Drizzle + PostgreSQL 17.
- Data export and account deletion (LGPD/GDPR); minimum age 16.
- Small surface for one maintainer to audit.

## Decision (proposed)

Use **Better Auth** with its Drizzle adapter, the magic-link plugin and the
GitHub social provider, mounted in the NestJS app. Sessions are HTTP-only,
`Secure`, `SameSite=Lax` cookies backed by the `session` table. The auth tables
are created and migrated by the library's schema generator and live beside our
Drizzle migrations. Email goes through a transactional provider chosen in API-08.

Before accepting, the owner should confirm: the license, maintenance activity,
how its CSRF protection fits our API, and that account deletion removes every
auth row.

## Alternatives considered

| Option                               | Pros                                                                | Cons                                                                                |
| ------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Better Auth                          | TS-native, self-hosted, Drizzle adapter, magic link + OAuth plugins | Younger project; plugin APIs still moving                                           |
| Auth.js (NextAuth)                   | Mature, many providers                                              | Built around Next.js; Nest integration is manual                                    |
| Lucia                                | Minimal                                                             | Deprecated as a library in 2025; now a guide to roll your own                       |
| Passport.js + own sessions           | Nest has first-class support                                        | We write and audit magic links, sessions and CSRF ourselves                         |
| Hosted (Clerk, Auth0, Supabase Auth) | Least code                                                          | Vendor lock-in, cost, personal data with a third party, conflicts with self-hosting |

## Consequences

- Auth tables follow the library's schema; schema changes need owner review.
- API-03 must test: sign-in end to end, 403 on writes without a CSRF token,
  session revocation on sign-out, and deletion of all auth rows (E-PLAT-05).
- If rejected, fall back to Passport.js with our own session table.
