<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Remembered Taste Core (S-01)

- **Plan**: context/changes/remembered-taste-core/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

All 7 planned changes are full MATCH (no drift, missing, or guardrail violations). Automated gates green: `db:verify` 34 tests PASS, `npm run lint` clean, `npm run build` clean.

## Findings

### F1 — Manual success criteria marked complete without live runtime evidence

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: plan.md Progress §2.4–2.6, §3.4–3.6
- **Detail**: All six manual checks are marked `- [x]` but were verified by code-path inspection, not a live signed-in browser run with TMDB. The plan's cross-phase note says the end-to-end recs flow should be demoed after Phase 3; that live demo has not been observed. Logic is sound but runtime behavior is unobserved.
- **Fix**: Run the live path once (sign in → save core → reload → start session → request recs → confirm 3 picks render+persist → confirm no-core redirect).
- **Decision**: FIXED — live verification 2026-06-06 against `astro dev` (workerd) + local Supabase. All 6 manual checks passed: save+reload persisted ({35}/{27,28}, 1 row); UI mutual-exclusion + API overlap/unknown-genre rejection; dashboard "Edit taste core"→/profiles + logged-out→/auth/signin; recs flow produced 3 distinct role-labeled picks (safe/compromise/wild_card, 1 run + 3 picks persisted); no-core→/profiles redirect. Manual Progress rows now carry observed evidence.

### F2 — Unplanned dashboard.astro copy edit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/dashboard.astro:22
- **Detail**: Link label changed to "Edit taste core". Not in the plan's Changes Required; the plan only said keep the back-link. Consistent with Phase 2's single-core copy intent, URL unchanged, no guardrail violated. Benign but out-of-plan.
- **Fix**: Keep it — aligns entry-point label with the new model. Noted for plan-as-truth record.
- **Decision**: ACCEPTED — kept as benign; already shipped in p2 (605da86) and verified working.

### F3 — `[core, core]` comment overstates ranking invariance

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recommendations.ts:125–129
- **Detail**: Verified against scoring.ts: identical viewers give combined=2A+shared, balance=A+shared. The comment's "unchanged versus a single-viewer pass" is mathematically loose (2A+shared isn't order-preserving vs A+shared), but there is no single-viewer code path and the engine still yields three valid distinct picks. Zero functional impact; wording inherited from the plan.
- **Fix**: Optional — soften the comment to avoid asserting single-viewer ranking equivalence. Cosmetic.
- **Decision**: FIXED — comment reworded to claim only "three valid, deterministic, distinct picks" instead of single-viewer ranking equivalence (recommendations.ts:125–129).

### F4 — Migration is unconditionally destructive (accepted, as planned)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data safety)
- **Location**: supabase/migrations/20260606120000_remembered_taste_core.sql:16
- **Detail**: Unconditional `delete from public.viewer_profiles`, forward-only, no down-migration. Ordering/timestamp/RLS all correct. This is the documented plan-approved dev-only decision; the dev-only invariant is load-bearing and unenforced.
- **Fix**: None required under the dev-only invariant (documented in-file). Call out in deploy runbook if real-data risk ever arises.
- **Decision**: ACCEPTED AS RISK — plan-approved dev-only wipe, documented in-file; remote has no `viewer_profiles` until a human-gated `db push`.
