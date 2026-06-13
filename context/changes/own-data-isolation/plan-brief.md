# Own-Data Isolation (IDOR) — Plan Brief

> Full plan: `context/changes/own-data-isolation/plan.md`

## What & Why

Implement **Phase 3 of the test-plan ("Own-data isolation")** — defend **Risk #4 (IDOR)**:
a logged-in user A reaching user B's sessions / recommendations / taste core by swapping
an identifier. The test-plan names the cheapest honest layer as **integration (two
users)** and warns against the anti-pattern of "testing only the happy path of one's own
data." This change delivers that test.

## Starting Point

RLS is on and **proven at the DB layer** by per-table pgTAP fixtures
(`supabase/tests/*_isolation.sql`). What no test covers is the **app's data seam** — the
per-request anon-key-plus-JWT client (`src/lib/supabase.ts`) — and the one genuine
URL-id-swap vector, `/sessions/[id]/recommendations.astro`, which reads by `session_id`
from the URL with no explicit owner filter (RLS-only). Write endpoints are already
IDOR-safe by construction (`user_id` always from the JWT, never from input). A prior
bug-driven change (`concurrent-user-isolation`, S-08) was closed _no-defect_ with its
plan unimplemented, so no repro/hardening exists today.

## Desired End State

`npm run test:isolation`, with the local Supabase stack up, signs up two fresh users and
proves B cannot read A's data across all owner-scoped entities + the URL-swap, while A
reads its own rows (teeth control). The keyless `npm run test:run` still passes with the
spec **skipped**. Test-plan §6.3 documents the pattern and Phase 3 reads `complete`.

## Key Decisions Made

| Decision          | Choice                                                      | Why (1 sentence)                                                                                     | Source |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| Test seam         | Vitest + two real authed supabase-js clients vs local stack | Tests the app's actual data seam (anon key + JWT → PostgREST as user), the layer the test-plan names | Plan   |
| Scope             | Test-only (no product-code changes)                         | It's a _test_ rollout phase; RLS is already proven correct, so owner filters are redundant           | Plan   |
| Docker dependency | Separate gated `test:isolation` + skip-if-flag-unset        | Keeps the keyless default suite and pre-push infra-free                                              | Plan   |
| IDOR breadth      | Read-leak across all entities + the URL-swap                | Covers "B can't see A's data" for every entity + the one real swap vector                            | Plan   |
| Gate placement    | Local/on-demand + cookbook doc, not blocking                | CI authoring is a deferred lesson; don't force Docker onto pre-push/CI                               | Plan   |
| User provisioning | Sign up two fresh unique users per run                      | Mirrors Phase 4 e2e; parallel-safe, no teardown, exercises the real signup→JWT path                  | Plan   |

## Scope

**In scope:** a gated two-user integration spec + authed-client helper; a `test:isolation`
npm script; env-flag gating + stack-reachability guard; test-plan §6.3/§3/§5/§6.6
write-back.

**Out of scope:** product-code changes / owner-filter hardening; new pgTAP; HTTP/SSR page
harness; CI and pre-push wiring; cross-user write/tamper assertions; teardown/fixed-UUID
seeding.

## Architecture / Approach

A new `tests/integration/` Vitest spec uses raw `@supabase/supabase-js` clients: a helper
signs up users A and B (local confirmations off → live sessions, real JWTs). A writes one
row per owner-scoped entity; B reads A's identifiers and must get empty; A reads its own
as a positive control. `describe.skipIf(!RUN_ISOLATION)` keeps the spec out of the keyless
`test:run`; the `test:isolation` script sets the flag and a `beforeAll` probe fails fast
if the local stack is down.

## Phases at a Glance

| Phase                       | What it delivers                                              | Key risk                                                                     |
| --------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Two-user IDOR test       | Gated spec + helper + `test:isolation` script proving no leak | Gating must keep `test:run` green without Docker; teeth via positive control |
| 2. Documentation write-back | §6.3 cookbook + Phase 3 status + §5 gate + §6.6 note          | Keeping the doc accurate to actual `test:isolation` behavior                 |

**Prerequisites:** local Supabase stack (`npm run db:start`, Docker); `@supabase/supabase-js`
already a dependency; Vitest already bootstrapped.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Local anon key/URL are read from env with local defaults; assumes a standard
  `supabase start` (API on `127.0.0.1:54321`, confirmations off — confirmed in `config.toml`).
- The test self-skips in keyless runs by design; whoever (or whatever CI later) wants
  enforcement must bring the stack up — acceptable per the deferred-CI decision.

## Success Criteria (Summary)

- B's reads of A's taste core / sessions / recommendations / picks / watched (and the
  URL-swap by A's `session_id`) all return empty; A reads its own rows.
- `npm run test:run` stays green without Docker (spec skipped); `npm run test:isolation`
  passes with the stack up; a deliberate isolation break turns it red.
