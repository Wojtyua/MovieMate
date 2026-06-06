# Scored, Role-Labeled Recommendations (S-03) — Plan Brief

> Full plan: `context/changes/scored-recommendations/plan.md`
> Research: `context/changes/scored-recommendations/research.md`

## What & Why

Turn a saved movie-night session into **three meaningfully distinct, role-labeled recommendations** — safe pick, compromise pick, wild card — scored deterministically against both viewer profiles and the session constraints, within `<10s`. This is roadmap slice **S-03**, the north-star validation milestone: it's the smallest end-to-end flow that proves the core hypothesis that filtering + dual-profile scoring + role diversity yields a genuinely useful three-pick decision set (US-01, FR-005..FR-009).

## Starting Point

Inputs are settled and TMDB-native: two `viewer_profiles` (genre prefs + note) and the latest `movie_night_sessions` (mood, genres, runtime, intensity, note). TMDB is only a reachability stub (`createTmdbClient().request()` — no discover, no types, no pagination, no timeout). No `recommendations` table exists, AI is out of scope (S-04), and watched-dedup (S-05) is unshipped. The app's only rendering idiom is form-POST → redirect → server-render.

## Desired End State

A logged-in user with two profiles opens `/sessions`, clicks **"Get recommendations"**, and lands within seconds on `/sessions/<session_id>/recommendations` showing three glass cards — Safe / Compromise / Wild card — each with poster, title, year, rating, genres, where the wild card's genre is provably distinct from the safe pick's. The picks persist (a `recommendations` row + three `recommendation_picks`), so the page reloads without re-hitting TMDB and S-04/S-05 have a stable identity to build on. RLS keeps each account's recommendations private.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Slice scope | Whole vertical engine in one multi-phase change | Delivers the validation milestone end-to-end as one reviewable arc | Plan |
| Persistence | Persist `recommendations` + `recommendation_picks` (snapshot display fields) | Gives S-04 a pick to justify and S-05 a pick to select; results page reloadable without TMDB | Plan |
| Rendering flow | POST `/api/recommendations` → persist → redirect → GET `/sessions/[id]/recommendations` | Stays within the established PRG idiom; results addressable & reloadable | Plan |
| Scoring model | Transparent weighted sum: dual-viewer genre affinity + session alignment + mood→genre map + intensity tone + quality/popularity | Satisfies every FR-007 signal, fully testable, cheap CPU, weights in one tunable block | Plan |
| Roles & diversity | Safe = max combined; Compromise = max-of-min viewer affinity; Wild card = top pick with genre disjoint from safe | Each label earns meaning; FR-009 diversity is a hard, verifiable guarantee | Plan |
| Excluded genres | Strong scoring penalty, **not** `without_genres` (only runtime is hard-filtered) | Matches FR-006's Socratic revision — hard metadata filtering drops good films | Plan / PRD |
| Retrieval budget | 2–3 discover pages (~40–60 candidates), OR-union genres, `with_runtime.lte`, `vote_count` floor | Enough breadth for a disjoint wild card, ≤3 subrequests, under the <10s NFR | Plan |
| Preconditions | Require exactly 2 profiles; degrade gracefully on thin pool / TMDB down | Keeps the dual-profile + compromise math meaningful; matches US-01 | Plan |
| Verification | Pure scoring module + manual workerd runs + pgTAP for tables; defer unit tests to Module-3 | Respects the project's testing sequencing; pure seam makes later tests trivial | Plan |

## Scope

**In scope:** two new RLS tables + pgTAP; a real TMDB discover client (param builder, pagination, abort timeout, exclusion seam); a pure scoring/diversity engine; `POST /api/recommendations`; the `/sessions/[id]/recommendations` results page + "Get recommendations" trigger.

**Out of scope:** AI justifications (S-04); watched-exclusion (S-05, seam only); per-candidate `/movie/{id}` runtime calls; `without_genres`; an app-level unit-test runner; remote DB push; new shadcn components.

## Architecture / Approach

Data → retrieval → logic → API → UI, with retrieval (`src/lib/tmdb` discover) and the engine (`src/lib/recommend/`, pure) kept as separate modules. The API endpoint is the only I/O composition point: load 2 profiles + session under RLS → `fetchCandidates` (TMDB) → `recommend()` (pure) → persist `recommendations` + 3 `recommendation_picks` → redirect. The results page is pure server-render of persisted rows. `/sessions/[id]/recommendations` is auto-guarded by the existing `/sessions` prefix (no middleware change); the API guards in-route.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `recommendations` + `recommendation_picks` tables, RLS, pgTAP | Getting the denormalized-`user_id` RLS + FK cascades right |
| 2. TMDB discover client | Typed `discoverMovies` + `fetchCandidates` (pagination, abort, exclusion seam) | Staying under the subrequest/<10s budget; no `runtime` on list items |
| 3. Scoring engine (pure) | `src/lib/recommend/` — weighted scoring + role/diversity selection | Tuning weights + the FR-009 disjoint-genre guarantee |
| 4. API endpoint | `POST /api/recommendations` — compose, persist, redirect, degrade | Precondition + degradation branches; end-to-end <10s |
| 5. Results UI + entry | Dynamic results page, three role cards, "Get recommendations" | Hand-rolled cards (no shadcn Card); empty/error states |

**Prerequisites:** F-01 (TMDB token — present), S-01 (profiles — done), S-02 (sessions — done); local Supabase for migrations.
**Estimated effort:** ~3–5 focused sessions across 5 phases.

## Open Risks & Assumptions

- The deterministic mood→genre / intensity→tone maps are heuristic stand-ins for semantic matching; default weights will likely need one tuning pass against real TMDB output.
- TMDB discover returns no `runtime` on list items — runtime correctness relies entirely on the `with_runtime.lte` hard filter.
- Very niche genre+runtime combos can return a thin pool (<3 distinct, or no disjoint-genre wild card); handled by returning fewer picks / Jaccard fallback rather than erroring.
- Scoring math isn't pinned by automated tests until the Module-3 test-plan (regression risk mitigated by the pure-module seam).

## Success Criteria (Summary)

- A two-profile user submits a session and receives three distinct, role-labeled picks within <10s, with the wild card differing from the safe pick in genre.
- Picks persist and the results page reloads without any TMDB call; RLS keeps them private to the account.
- Missing-profile, thin-pool, and TMDB-down paths degrade gracefully (clear message, nothing persisted); `db:verify` proves table isolation.
