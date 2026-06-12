# Concurrent User Isolation — Plan Brief

> Full plan: `context/changes/concurrent-user-isolation/plan.md`
> Research: `context/changes/concurrent-user-isolation/research.md`

## What & Why

A production report (roadmap S-08) says a second user logging in while a first is
mid-session makes "the app stop working." Research **refuted the stated cause** (a
shared, non-per-request auth client): the code is per-request-correct, holds no shared
mutable per-user state, RLS is on and correct on every table (confirmed live), and
DB-layer isolation is already proven by pgTAP. The breakage mechanism is **unconfirmed**
and could not be captured from read-only diagnostics. So this change does the no-regret
work: build an instrumented repro that **pins the actual failing layer**, and **harden**
the one real gap (app-layer reads that trust RLS alone). It does not fix the unknown
breakage — that's a follow-up once the repro names it.

## Starting Point

Per-request `@supabase/ssr` client + secure `getUser()`; RLS enabled/correct on all six
tables; deployed key is `anon`; five pgTAP `*_isolation.sql` files prove DB-layer
isolation. Gap: four app-layer reads (`sessions.astro` ×2, `profiles.astro`,
`recommendations.astro`) carry no explicit `.eq("user_id", …)` and lean entirely on RLS.
No app test runner (Vitest not bootstrapped); Node 22 + `"type":"module"`; local
Supabase has email confirmation off.

## Desired End State

A committed, re-runnable repro (`npm run repro:isolation`) drives two concurrent
authenticated flows against local `astro dev` (real workerd), exercises the heavy
pipeline concurrently, prints a per-layer timing/outcome report, and asserts cross-user
isolation — yielding a documented root-cause verdict. All four reads are explicitly
owner-scoped (fail-safe, behavior no-op under the anon key). Findings + the user's
key-verification result are written back; test-plan §6.3 documents the probe.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Plan scope | Harden + repro | Root cause unconfirmed; do the work that's correct regardless | Plan |
| Deployed key check | User verifies | Worker secret unreadable from here | Plan |
| Repro form | Runnable Node script | Deterministic, CI-capable, no new dep; local dev = real workerd | Plan |
| Repro signal | Per-layer instrumentation | Kills the TMDB-vs-auth-vs-Worker ambiguity | Plan |
| Pipeline load | Exercise heavy path concurrently | Pressures shared quota / subrequest budget — the realistic case | Plan |
| Test home | Repro script asserts isolation | App-layer coverage now without premature Vitest bootstrap | Plan |
| Owner-filter scope | All four unscoped reads, inline | Uniform fail-safe; no helper abstraction the bug doesn't need | Plan |

## Scope

**In scope:** instrumented two-user repro script + npm entry; gated per-layer server
instrumentation (default-off env flag); explicit owner filters on all four unscoped
reads; write-back of findings + cookbook §6.3.

**Out of scope:** the targeted fix for whatever Phase 1 finds (follow-up change);
Vitest/Playwright bootstrap; new pgTAP; CI YAML; reading/altering the Worker secret;
any UX change.

## Architecture / Approach

Diagnose → harden → lock. Phase 1's script logs two users in through the app's own
`/api/auth/*` endpoints (real cookie/workerd path), fires both heavy
`/api/recommendations` POSTs concurrently, and correlates gated server-side timing logs
(emitted only under `DEBUG_CONCURRENCY`) to attribute any failure to a specific layer —
while asserting B can't read A's data. Phase 2 adds inline `.eq("user_id", user.id)` to
the four reads and re-runs the probe to prove legitimate access is unchanged. Phase 3
makes the isolation assertions a keyless, re-runnable regression and writes findings +
the test-plan cookbook entry.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Repro + instrumentation | Deterministic two-user repro that names the failing layer + confirms no leak | Heavy mode needs TMDB/OpenRouter keys; instrumentation must stay gated |
| 2. Owner-scope hardening | Explicit owner filters on all four unscoped reads | Accidental over-filtering / behavior change (mitigated by re-running probe) |
| 3. Lock regression + docs | Keyless isolation check + findings write-back + §6.3 cookbook | Keeping the check runnable without external keys |

**Prerequisites:** local Supabase up (`npm run db:start`); `astro dev` with TMDB/OpenRouter
keys for heavy mode; user verifies the deployed `SUPABASE_KEY` is `anon`.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- **Root cause genuinely unknown** until Phase 1 runs; the actual fix is deferred to a
  follow-up. This plan hardens + diagnoses, it does not promise the breakage is gone.
- Assumes the deployed key is `anon` (user verifying). If a `service_role` key was ever
  deployed, the unscoped reads were a live leak until Phase 2 lands — Phase 2 closes it
  regardless.
- Heavy-mode fidelity depends on real external keys; light/isolation modes cover the
  rest keylessly.

## Success Criteria (Summary)

- Running the repro produces an unambiguous verdict: the failing layer is named, or two
  concurrent users are shown working — documented in `research.md`.
- User B can never read user A's session / recommendations / taste core (asserted by the
  probe; enforced by explicit owner filters + RLS).
- `npm run lint`, `astro check`, and `npm run db:verify` all pass; no UX regression.
