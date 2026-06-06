<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Remembered Taste Core (S-01)

- **Plan**: context/changes/remembered-taste-core/plan.md
- **Mode**: Deep
- **Date**: 2026-06-06
- **Verdict**: REVISE → SOUND (all findings triaged & applied)
- **Findings**: 1 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding
9/9 paths ✓, 4/4 symbols ✓, brief↔plan ✓. No `docs/reference/contract-surfaces.md` (skipped).

## Findings

### F1 — Migration breaks the pgTAP suite; no phase updates it

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real edit with assertion-design choices; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Migration / Testing Strategy
- **Detail**: `supabase/tests/viewer_profiles_isolation.sql` (run via `npm run db:verify` → `supabase test db`) seeds fixtures with `slot`/`display_name` (lines 27–29, 96, 101, 108) and asserts the `slot in (1,2)` CHECK + `(user_id, slot)` UNIQUE (lines 95–112) and reads `display_name` (lines 62, 85) — all removed by the migration, so the suite errors on the first insert. The plan never identified this DB-level suite; its Testing Strategy only mentioned hypothetical "API-level tests". This is the exact test that proves Phase 1's own manual criterion 1.5.
- **Fix**: Added Phase 1 change #2 to rewrite `viewer_profiles_isolation.sql` for the single-core model (own-data assertions kept; three slot-cap assertions → one `unique(user_id)` violation check; fixtures insert `(user_id, preferred_genre_ids)`; `display_name` reads swapped; `plan(N)` updated; header comment refreshed), and added `npm run db:verify passes` to Phase 1 Automated Verification + Progress 1.3.
- **Decision**: FIXED (Fix in plan)

### F2 — Unnamed unique constraint: drop step is imprecise

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — migration Contract, step (2)
- **Detail**: The source declares `unique (user_id, slot)` inline and unnamed (auto-named `viewer_profiles_user_id_slot_key`), so the plan's discrete "drop the unique constraint" step had no name to drop by and was redundant — `drop column slot` auto-removes any constraint involving that column.
- **Fix**: Rewrote the migration contract to drop the columns and let `drop column slot` auto-remove the CHECK + unique (no separate DROP CONSTRAINT, no CASCADE), then add `unique(user_id)`.
- **Decision**: FIXED (Confirm fix in plan)

### F3 — "Each phase independently verifiable" is overstated

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Implementation Approach / Phase 1
- **Detail**: After Phase 1, `recommendations.ts` still selects the dropped `slot` column and finds 0 rows, so the recs flow is red until Phase 3. The "independently verifiable" claim hid this.
- **Fix**: Replaced the claim with a cross-phase note: recs path is red from Phase 1 until Phase 3; verify end-to-end only after Phase 3.
- **Decision**: FIXED (Fix in plan)

### F4 — Stale slot-cap comments in sibling test/header

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Testing Strategy
- **Detail**: `movie_night_sessions_isolation.sql` (lines 7, 86, 96) and the viewer_profiles test header reference the now-removed two-profile slot cap. Comment-only.
- **Fix**: Testing Strategy now points at refreshing the sibling contrast comments during the F1 rewrite; the viewer_profiles header is covered by the F1 rewrite itself.
- **Decision**: FIXED (Confirm — already noted in plan)
