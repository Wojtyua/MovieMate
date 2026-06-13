---
change_id: e2e-critical-path
title: E2E critical path — three picks render end-to-end
status: implementing
created: 2026-06-13
updated: 2026-06-13
archived_at: null
---

## Notes

Test-plan §3 **Phase 4 — E2E critical path** (currently `not started`). Protects
**Risk #3**: a regression in the multi-step journey (home → login → session →
preferences → three picks) breaks the end-to-end flow. Risk-response oracle: prove
**three picks render on screen**, not just an HTTP 200 / URL change, against real
boundaries (auth, routing, SSR on workerd, DB).

Lesson M3L4 (`/10x-e2e`). Decisions locked with the user: real TMDB (note-less
single-genre submit → deterministic genre-only rung, ≥3 picks); local Supabase
stack with a Playwright `setup` project that signs up a fresh user (confirmations
off) and saves `storageState`. Planned phases: P1 Playwright bootstrap + auth +
seed/rules levers (`/10x-implement`), P2 critical-path E2E test (`/10x-e2e`), P3
optional CI wiring.
