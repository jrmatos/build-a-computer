<!-- Title: <TASK-ID> <short summary>. Branch: <task-id>-<short-slug>. One task per PR. -->

## Task

Task ID: <!-- e.g. SIM-03 --> · Spec section: <!-- docs/plan.md heading -->

## Acceptance criteria

<!-- Copy every criterion from the task in docs/plan.md and tick each one. -->
<!-- Each edge case ID (E-XXX-NN) needs a test whose name contains that ID. -->

- [ ]
- [ ]

## Definition of done

- [ ] Every acceptance criterion above is ticked
- [ ] `pnpm check` passes locally (lint, typecheck, unit and property tests); `pnpm build` passes
- [ ] End-to-end tests pass (once Playwright lands)
- [ ] Performance budgets still pass (once `tools/bench` lands)
- [ ] Public APIs have TSDoc comments
- [ ] `docs/plan.md` updated if behavior changed
- [ ] No test was weakened, skipped or deleted to get green

## Human review gate

Owner approval is required if this PR touches any of these (tick what applies):

- [ ] Schema or save-format change (version bump + forward migration + migration tests included)
- [ ] Auth or security code
- [ ] New dependency or license (ADR in `docs/adr/` included)
- [ ] Curriculum text or resource links (links fetched; `verifiedAt` and `verifiedTitle` recorded)
- [ ] User data

## Ambiguities and notes

<!-- Spec ambiguities: the reading you took. Also add them to "Open questions" in docs/plan.md. -->
