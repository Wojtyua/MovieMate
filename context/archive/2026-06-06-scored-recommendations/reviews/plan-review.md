<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Scored, Role-Labeled Recommendations (S-03)

- **Plan**: context/changes/scored-recommendations/plan.md
- **Mode**: Deep
- **Date**: 2026-06-06
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, db scripts ✓, brief↔plan ✓, Progress↔Phase ✓. Verified against code: middleware uses `startsWith` (guards `/sessions/[id]/recommendations`); `sessions.astro` loads `latest` session with id; `viewer_profiles` RLS uses `default auth.uid()` + explicit `user_id` insert.

## Findings

### F1 — Wild-card diversity keyed off "first genre_id = dominant genre"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details + Phase 3 (roles.ts)
- **Detail**: FR-009 diversity guarantee rode on "first id in genre_ids ∉ safe pick genres", but TMDB `genre_ids` order is categorical, not relevance-ranked — an unsound proxy.
- **Fix A ⭐ Recommended**: Make full set-disjointness the primary rule (share no genre with safe pick); Jaccard-overlap minimum as fallback.
- **Fix B**: Keep first-id rule + Jaccard < 0.5 second gate.
- **Decision**: FIXED via Fix A — updated the spec, the Phase 3 `roles.ts` contract, the Phase 3 manual verification, and Progress 3.3.

### F2 — "Get recommendations" silently ignores unsaved form edits

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 — "Get recommendations" trigger on /sessions
- **Detail**: Trigger is a 2nd form posting the saved session id; editing SessionForm without saving recommends on stale state with no signal.
- **Fix A ⭐ Recommended**: Gate the trigger on a saved session + distinct "Your saved session" block with explicit "save changes first" copy.
- **Fix B**: Single combined "Save & get recommendations" submit chaining the two endpoints.
- **Decision**: FIXED via Fix A — Phase 5 trigger contract now mandates a separate saved-session block, save-first copy, and not rendering the trigger without a saved session.

### F3 — Results ordering: `order by role` is alphabetical, not safe→wild

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 — results page
- **Detail**: `order by role` sorts alphabetically (compromise, safe, wild_card) — wrong display order.
- **Fix**: Explicit role-rank ordering (safe=0, compromise=1, wild_card=2) in the page frontmatter.
- **Decision**: FIXED — Phase 5 results contract updated.

### F4 — Re-running accumulates duplicate `recommendations` rows per session

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 4 — insert recommendations row
- **Detail**: Each POST inserts a new run; only the latest is shown; older runs orphan. Likely intentional but undocumented.
- **Fix**: Document as a deliberate decision (latest run wins, no cleanup).
- **Decision**: FIXED — added to "What We're NOT Doing".

### F5 — `VOTE_COUNT_FLOOR=100` compounds with hard filters on niche pools

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 / Phase 3 — vote_count.gte at query time
- **Detail**: Floor + runtime + genre filters can thin niche pools (feeds the fallback). Already safe; tuning awareness only.
- **Fix**: Tuning note (knob to relax or move to soft scoring gate).
- **Decision**: FIXED — tuning note added to Performance Considerations.
