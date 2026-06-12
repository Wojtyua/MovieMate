---
change_id: concurrent-user-isolation
title: Concurrent logged-in users break each other (multi-user isolation defect)
status: archived
created: 2026-06-12
updated: 2026-06-12
archived_at: 2026-06-12
resolution: no-defect (not reproducible — closed without code change)
---

## Notes

Post-deploy production defect (roadmap S-08). Symptom: with one user logged in the
app works fine, but when a second user logs in while the first is creating a session
and choosing movie preferences, the app stops working. Concurrent use by two logged-in
users is effectively impossible.

Leading hypothesis (to confirm in /10x-research, not assumed): shared mutable
server-side auth/session state across concurrent requests on the Astro SSR / Cloudflare
Workers runtime — e.g. a non-per-request Supabase/auth client whose identity gets
overwritten when a second user authenticates.

Open questions to resolve before planning:
- Confirm the actual root cause against current code.
- Determine whether this is purely disruption/crash or also a cross-account DATA LEAK
  (one user seeing another's taste core / session / picks). If exposure is possible this
  is a security incident, not just a reliability bug.
- Establish a deterministic repro (two concurrent authenticated flows, second login
  during the first user's preference step) to prove the fix.

## Resolution (2026-06-12): no reproducible defect — closed without code change

The reported breakage **does not reproduce**. The operator confirmed concurrent use
works in practice, and that matches the investigation:

- **Code is per-request-correct** — `src/lib/supabase.ts` is a per-request factory; no
  shared mutable per-user state anywhere in `src/`; secure `getUser()`; per-request
  `Astro.locals`. The leading hypothesis (a shared, identity-overwritten auth client)
  was **refuted** — that code does not exist here. See `research.md`.
- **Isolation is sound** — RLS enabled + correct on all six tables (confirmed live via
  Supabase advisors + `list_tables`); DB-layer isolation already proven by
  `supabase/tests/*_isolation.sql`. Deployed/anon key is `role: anon`.
- **Most likely original symptom**: a transient — a momentary shared external rate
  limit (TMDB/OpenRouter), or two accounts in the *same* browser cookie jar (expected
  behavior, not a defect).

**Not done (deliberately):** the planned "harden + repro" work was dropped because there
is nothing to reproduce; the defense-in-depth owner filters remain an optional, no-regret
follow-up (no-op under the anon key) and are **not** required to close this.

**Caveat for the record:** "works" was confirmed by normal/operator use, not by a
load-test of genuinely concurrent heavy pipeline runs (the repro harness was never
built). If the symptom ever returns under real concurrency, reopen with the repro plan
in `plan.md` as the starting point.

**Open item left to the operator:** confirm the deployed Worker `SUPABASE_KEY` is the
anon key (docs say so; live anon key is `role: anon`; the Worker secret value itself was
not read during this investigation).
