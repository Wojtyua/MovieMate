---
change_id: graceful-degradation-at-the-external-edge
title: Graceful degradation — TMDB/OpenRouter failure falls back to genre-only, still three picks
status: implemented
created: 2026-06-13
updated: 2026-06-13
archived_at: null
---

## Notes

Phase 2 of the test plan (`context/foundation/test-plan.md` §3). Covers **Risk
#2**: a failing or timing-out external dependency (TMDB / OpenRouter) must
degrade to **genre-only retrieval — still three picks within < 10 s, no 500** —
rather than erroring out.

- **Test types:** integration + network-edge mock (MSW). MSW is not yet in the
  stack (§4) — this phase bootstraps it. Mock only the network edge (TMDB /
  OpenRouter), never an internal module.
- **What would prove protection** (§2 Risk Response): a failing / timing-out
  dependency yields a clean fallback to genre-only retrieval, still three picks,
  no 500. Must challenge "200 means success" — the fallback may silently return
  < 3.
- **Context research must ground:** the network edge (TMDB / OpenRouter), the
  timeout + error path.
- **Anti-patterns to avoid:** over-mocking; never exercising the error path
  itself.
- Builds on Phase 1's integration seam (`fetch` + env token + fake Supabase —
  see §6.2); the multi-rung relaxation _progression_ (note → AI path) was
  deferred from Phase 1 to here.
