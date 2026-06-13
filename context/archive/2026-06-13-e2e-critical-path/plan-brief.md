# E2E Critical Path — Three Picks Render End-to-End — Plan Brief

> Full plan: `context/changes/e2e-critical-path/plan.md`
> Research: `context/changes/e2e-critical-path/research.md`

## What & Why

Cover **test-plan Phase 4 / Risk #3**: a regression in the multi-step journey
(auth → `/sessions` preferences → submit → picks) breaks the end-to-end flow. The
oracle is explicit — prove **three picks render on screen**, not just an HTTP 200 or
a URL change — and only an E2E test crossing the real boundaries can give that proof.

## Starting Point

The journey is fully built (`SessionForm` → `POST /api/recommendations` →
`recommend-run` pipeline → SSR `PicksGrid` of `<article>` cards). There is **no
Playwright** yet (not installed, no config, no specs), and `/10x-e2e` won't install
it — so this change bootstraps the E2E layer first, then drives the one risk.

## Desired End State

`npm run test:e2e` auto-starts `astro dev` (:4321), a `setup` project signs up a
fresh user and saves `storageState`, and one hardened spec asserts three `<article>`
picks render after a note-less, single-genre submit. The test fails when the
protected behavior is deliberately broken, and the suite passes twice in a row.

## Key Decisions Made

| Decision      | Choice                   | Why                                                                            | Source      |
| ------------- | ------------------------ | ------------------------------------------------------------------------------ | ----------- |
| Drive route   | Formal rollout chain     | Tracks Phase 4 to `complete` in test-plan §3                                   | Plan (meta) |
| External TMDB | Real TMDB                | Risk #3 = real boundaries integrating; note-less single-genre is deterministic | Plan (meta) |
| Backend       | Local Supabase           | Isolated/repeatable; signup mints a logged-in user (confirmations off)         | Research    |
| E2E scope     | Critical path only       | Protect the named risk, not surface area; auth covered by setup                | Plan        |
| CI wiring     | Deferred                 | CI authoring is a separate lesson (test-plan §5/Phase 5 note)                  | Plan        |
| Isolation     | Fresh user + unique data | Collision-free re-runs without a teardown project                              | Plan        |

## Scope

**In scope:** Playwright config + webServer; auth `storageState` setup project; seed
test + E2E rules levers; one critical-path spec for Risk #3; deliberate-break verify.

**Out of scope:** CI wiring; external-edge mocking (Risk #2/Phase 2); a second E2E
scenario; teardown project; any `data-testid` changes to app code.

## Architecture / Approach

Two phases sharing one `## Progress`, mirroring the lesson's interleave: Phase 1 is
plain infra (`/10x-implement`); Phase 2 is the browser-level test (`/10x-e2e`). The
seed test + E2E rules shape what the generator produces. Boundaries (auth, routing,
Supabase, SSR-on-workerd, TMDB) are real; the note-less path keeps picks deterministic.

## Phases at a Glance

| Phase                        | What it delivers                                | Key risk                                            |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| 1. Bootstrap + auth + levers | Runnable Playwright, storageState, seed + rules | Auth-setup cookie capture; local Supabase/Docker up |
| 2. Critical-path E2E         | One hardened three-picks test, break-verified   | Real-TMDB flake; locator ambiguity on genre buttons |

**Prerequisites:** Docker + local Supabase (`npm run db:start`); `.dev.vars` with
Supabase + TMDB values.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Real TMDB is reachable and returns ≥3 for a common genre (assumed; the note-less
  genre-only rung is the most stable path).
- Local `enable_confirmations = false` holds (verified in `supabase/config.toml`).
- `astro dev` is real workerd locally, so a local green is genuine runtime proof.

## Success Criteria (Summary)

- Three picks visibly render end-to-end via the real journey.
- The test goes red on a deliberate break of the protected behavior, then reverts.
- The suite passes twice consecutively (isolation holds).
