---
date: 2026-06-12T18:48:42+0200
researcher: Wojciech Derlikiewicz
git_commit: 7df157cfc9f6568c17260cb0d11a18f0e32238ea
branch: main
repository: 10xMovie
topic: "Oracle and seams for the 'always three picks' core (test rollout Phase 1, Risks #1 + #5)"
tags: [research, codebase, recommend, scoring, roles, relaxation, testing, oracle]
status: complete
last_updated: 2026-06-12
last_updated_by: Wojciech Derlikiewicz
---

# Research: "always three picks" core — oracle + seams (Test Phase 1, R1 + R5)

**Date**: 2026-06-12T18:48:42+0200
**Researcher**: Wojciech Derlikiewicz
**Git Commit**: 7df157cfc9f6568c17260cb0d11a18f0e32238ea
**Branch**: main
**Repository**: 10xMovie

## Research Question

For test-plan §3 **Phase 1 — "Bootstrap + 'always three picks' core"** (defends **Risk #1**: pipeline drains below three picks with healthy dependencies; **Risk #5**: malformed pick set on the solo↔duo branch), establish from authoritative **sources** — not from the implementation — the oracle for: always-three, solo vs duo role labels, wild-card-genre rule, watched exclusion, and relaxation order. Then locate the pipeline seams and classify what is unit- vs integration-testable.

## Summary

The oracle is **fully grounded — no STOP-AND-ASK gaps.** Both PRD open questions (prd.md:157–158) were resolved downstream and are citable: solo's middle label is **`crowd_pleaser`** (shipped migration `20260607073440_solo_role_crowd_pleaser.sql`), and the relaxation order is **keywords → cast → AI-genres → genre-only baseline** (`context/archive/2026-06-11-ai-note-understanding/plan.md:340–342`).

The central synthesis finding — and the thing the tests must get right — is that **"always three" is not one invariant; it lives in two layers, and the code has no hard floor of three:**

- **Pure layer** (`src/lib/recommend/roles.ts` `recommend()`): turns a candidate pool of `N` distinct films into **`min(N, 3)` distinct, role-labeled picks**. It guarantees `≤ 3`, distinctness, correct role-by-cardinality, and wild-card-genre-disjoint — but it does **not** manufacture a third pick when only 1–2 distinct candidates exist. (roles.ts:100–177)
- **Retrieval layer** (`src/lib/recommend-run.ts`): the **relaxation ladder** is what is supposed to make the pool reach `≥ 3` by progressively dropping AI filters; it stops at the first attempt with `≥ 3` candidates, and the final rung is the genre-only baseline. If even the baseline yields `< 3`, the pipeline proceeds with `< 3` picks (it errors only at **zero** picks / **zero** candidates). (recommend-run.ts:118–167)

So the two faces of Risk #1 a test must separate:
- **Defect:** a pool that *had* `≥ 3` distinct healthy candidates gets drained below three by dedup / role / relaxation logic. → Must never happen. Testable.
- **Not a defect:** the film universe genuinely contains `< 3` matching films even after genre-only relaxation. → Physically can't return three. The guarantee is "always three *when a healthy dependency can supply three*", not "fabricate three from two."

This split maps cleanly onto the two-layer test strategy: **unit** tests on the pure `recommend()` for R5 + the role/dedup/wild-card half of R1; **integration** (stubbed `TmdbClient`) on the ladder for the retrieval half of R1.

## Detailed Findings

### The oracle (from sources only)

| Property | Oracle (expected behavior) | Source |
|---|---|---|
| At most / always three | "At most **three** recommendations (never a catalog)"; degradation "still returns three picks within budget"; AI filters "relaxed when the pool is too thin to guarantee three picks" | `context/foundation/prd.md:64`, `:66`, `:111`, FR-009 `:118` |
| Duo role set | `safe` / `compromise` / `wild_card` | prd.md FR-009 `:118`; migration `20260607073440…sql:3-4` |
| Solo role set | `safe` / `crowd_pleaser` / `wild_card` — `crowd_pleaser` **replaces** `compromise`; solo must **never** emit `compromise` | migration `20260607073440_solo_role_crowd_pleaser.sql:2-3,18`; `context/archive/2026-06-06-session-first-solo-flow/plan.md:51` |
| `role` CHECK domain | Flat 4-value set: `check (role in ('safe','compromise','wild_card','crowd_pleaser'))` — **no cardinality awareness** | `supabase/migrations/20260607073440…sql:18` (was `'safe','compromise','wild_card'` at `20260606115345_recommendations.sql:41`) |
| Wild-card genre | Wild card **differs from the safe pick in genre** | prd.md `:82`, FR-009 `:118` |
| Relaxation order | Drop filters: **(1) keywords → (2) cast → (3) AI-genres → (4) genre-only baseline**; stop at first attempt with ≥ 3 candidates; final rung == pre-S-04 genre-only call (never worse) | `context/archive/2026-06-11-ai-note-understanding/plan.md:340-342` (corroborated `research.md:217-219,275`) |
| Watched exclusion | Dedup filter only — **not** a scoring signal, not browsable; excluded set is **constant across all ladder rungs and never relaxes** | prd.md FR-012 `:124-125`, Non-Goals `:152`, `:140`; `context/archive/2026-06-11-select-and-mark-watched/plan.md:5,48` |
| Excluded genres | A **scoring penalty** (`W_EXCL`), never a discover filter, never part of the ladder | `ai-note-understanding/plan.md:345-346`; scoring.ts `W_EXCL` |

**DB-layer caveat (grounded):** because the CHECK is a flat 4-value domain with no solo/duo awareness, a pgTAP/DB test **cannot** assert "solo never stores `compromise`." That invariant lives only in application logic and must be tested at the **unit / pipeline** layer.

### Pure scoring + role assignment (the unit-testable core)

`src/lib/recommend/` is entirely pure — 6 exported functions + 4 constants, no IO, no env, directly unit-testable with hand-built `TmdbMovie[]`.

- `affinity.ts` — `moodGenres(mood)` (affinity.ts:62), `intensityBias(genreIds, intensity)` (affinity.ts:73): pure table lookups / set math.
- `scoring.ts` — `tasteAffinity` (scoring.ts:65), `sessionAlignment` (scoring.ts:77), `scoreCandidate` (scoring.ts:108) return four ranking signals `{combined, balance, crowd, perTaste}`. `WEIGHTS` (scoring.ts:13) — note `W_EXCL=4` is ~2× `W_PREF=2` (excluded genres strongly penalized), `W_CROWD=3` powers the solo middle role.
- `roles.ts` — `recommend(tastes, session, candidates)` (roles.ts:100): the orchestrator. Behavior verified by direct read:
  - Empty pool → `{picks: []}` (roles.ts:106-108).
  - **safe** = argmax `combined`; if none, `{picks: []}` (roles.ts:120-124).
  - **middle**: duo → argmax `balance` role `compromise` (roles.ts:130-135); solo → argmax `crowd` tie-break `combined` role `crowd_pleaser` (roles.ts:136-146). Branch key is `tastes.length === 2`.
  - **wild_card** (roles.ts:148-174): from candidates not yet used, prefer those **fully genre-disjoint** from safe (`genre_ids.every(g => !safeGenres.has(g))`, roles.ts:152); if none disjoint, fall back to **minimum Jaccard overlap** with safe (roles.ts:162-168). Never picks a duplicate (`usedIds`).
  - **No floor:** returns `min(N,3)` picks for `N` distinct candidates. Pool ≥3 distinct → exactly 3; pool of 2 → 2; pool of 1 → 1.

### Retrieval, relaxation, dedup (the integration-testable core)

`src/lib/recommend-run.ts` `recommendRun(supabase, user, session, second)`:
- Watched set read once: `supabase.from("watched").select("tmdb_movie_id").eq("user_id", …)` (recommend-run.ts:93), passed as `excludeMovieIds` to every rung (recommend-run.ts:142). Exclusion applied **during retrieval**, in the same pass as id-dedup, before a movie enters the pool (`tmdb-discover.ts:185`).
- **Relaxation ladder** (recommend-run.ts:118-147, verified): 4 rungs built by `dedupeAttempts([...])` collapsing identical filter sets (so a note-less run issues one query); `for (attempt of ladder) { candidates = fetchCandidates(...); if (candidates.length >= 3) break; }`.
- Runtime is the **only hard discover filter** (`with_runtime.lte`, tmdb-discover.ts:98-101); excluded genres are not sent to discover.
- Failure modes: any throw in retrieval → `{ok:false,"Could not reach TMDB, try again"}` (recommend-run.ts:148-149); `candidates.length === 0` → same message (recommend-run.ts:153-155); `result.picks.length === 0` → `{ok:false,"No matching films — broaden your preferences"}` (recommend-run.ts:165-166). **A pool of 1–2 healthy candidates returns 1–2 picks with `ok:true`** — no error, no third pick.

### Endpoint + persistence (context, not Phase-1 focus)

- `src/pages/api/recommendations.ts:37` POST-only; auth via `context.locals.user`; parses FormData (mood, intensity, `preferred_genre_ids`, `excluded_genre_ids`, `runtime_limit_minutes`, `note`, and duo `second_*`); inserts a `movie_night_sessions` row; calls `recommendRun`; responds **302 redirect** to `/sessions/{id}/recommendations` (no JSON body).
- Persistence is **non-atomic**: `recommendations` insert (recommend-run.ts:170) then `recommendation_picks` insert (recommend-run.ts:193) — two independent ops, no transaction. Partial-failure branches are a **hermetic** concern, out of scope for Phase 1 (R1/R5); flagged in Open Questions.

### Network / DB seams (for the test layers)

| Seam | Location | Injection | Use |
|---|---|---|---|
| TMDB | `fetchCandidates(client, opts)` (tmdb-discover.ts:148) over `TmdbClient.request` → `fetch` (tmdb.ts:25) | `TmdbClient` is an **injectable arg** | Stub the client for ladder integration tests; MSW only if exercising the real client |
| OpenRouter | `AiClient.extract` (ai.ts:77) via `parseNote(ai, …)` (recommend-run.ts) | `AiClient` injectable | Phase 2 (degradation) territory; stub for note tests |
| Supabase | `recommendRun(supabase, …)` (recommend-run.ts:45) | `SupabaseClient` injectable; local stack `supabase start` (Postgres 17 @ 127.0.0.1:54322) | Real local DB feasible for integration |

## Code References

- `src/lib/recommend/roles.ts:100-177` — `recommend()`: role assignment, wild-card genre disjointness, `min(N,3)` behavior.
- `src/lib/recommend/scoring.ts:13,65,77,108` — `WEIGHTS` and the three pure scoring functions.
- `src/lib/recommend/affinity.ts:14,28,62,73` — mood/intensity affinity tables + helpers.
- `src/lib/recommend-run.ts:118-167` — relaxation ladder, watched exclusion, failure modes.
- `src/lib/recommend-run.ts:170-198` — non-atomic persistence of run + picks.
- `src/lib/tmdb-discover.ts:98-101,148,184-186` — runtime hard filter, `fetchCandidates` seam, dedup+exclude pass.
- `src/lib/tmdb.ts:15-28` / `src/lib/ai.ts:44-111` — network client factories.
- `src/pages/api/recommendations.ts:37-146` — endpoint form parsing, session insert, redirect.
- `supabase/migrations/20260607073440_solo_role_crowd_pleaser.sql:18` — current `role` CHECK domain.
- `supabase/tests/recommendations_isolation.sql` — existing pgTAP: RLS + role CHECK + (recommendation_id, role) UNIQUE + solo role set.

## Architecture Insights

- **Clean two-layer testability.** The "always three" guarantee decomposes exactly along the cost×signal seam: pure `recommend()` (unit) owns *shape* (≤3, distinct, roles, wild-card genre); the ladder (integration with a stubbed TMDB client) owns *supply* (widen pool to ≥3). Neither layer needs the network mocked at the pure level; the ladder needs only an injected `TmdbClient` stub — no MSW, no real TMDB. MSW belongs to Phase 2 (degradation), not here.
- **The dependency seams are already injected** (`TmdbClient`, `AiClient`, `SupabaseClient` are all parameters), so tests need almost no refactoring — the code was written test-friendly.
- **Oracle ≠ implementation.** The expected "exactly three" must be asserted from the PRD guarantee against a *healthy ≥3 pool*, never by reading the slice/truncation logic. Per test-plan §7, do **not** assert exact float scores — assert ordering, role correctness, and the ≤3 / wild-card-genre / distinctness invariants.

## Historical Context (from prior changes)

- `context/archive/2026-06-06-session-first-solo-flow/plan.md:51` — decided solo middle role = `crowd_pleaser` (quality+popularity), resolving PRD OQ-1.
- `context/archive/2026-06-11-ai-note-understanding/plan.md:340-346` — decided the relaxation ladder order (OQ-2) and the two invariants (final rung == pre-S-04 baseline; excluded genres stay a scoring penalty). Verified shipped at `plan.md:470`.
- `context/archive/2026-06-11-select-and-mark-watched/plan.md:5,48` — watched = dedup filter only; constant across ladder rungs, never relaxes.

## Related Research

- `context/foundation/test-plan.md` §2 Risk #1/#5 + Risk Response Guidance (rows 71, 75); §3 Phase 1; §7 negative space (no exact float assertions).
- `context/archive/2026-06-11-ai-note-understanding/research.md:217-219,275` — relaxation order hypothesis.

## Open Questions

1. **Where does the plan draw the "thin universe" line?** For boundary inputs the plan must decide the expected output when even genre-only relaxation can supply only 1–2 distinct films: assert `min(N,3)` (current behavior, documents the no-fabrication rule) vs treat `< 3` as a failure to surface. Sources say "always three *when supply allows*"; the test boundary fixture (e.g. genre-only returns exactly 3, or returns 2) is a `/10x-plan` decision, not a research gap.
2. **Non-atomic persistence** (recommend-run.ts:170-193): partial-failure branches (picks insert fails after run insert) are hermetic-test territory and **out of Phase-1 scope** (R1/R5). Note for a later phase, do not fold into this rollout.
3. **`pages: 3` × `VOTE_COUNT_FLOOR: 100`** — the realistic supply assumption behind "genre-only always yields ≥3." Worth one integration fixture asserting the ladder stops at the first ≥3 rung and does not over-relax.
