<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Session-First Solo Flow (S-02)

- **Plan**: context/changes/session-first-solo-flow/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-06-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (2 pre-existing observations) |
| Architecture | PASS |
| Pattern Consistency | PASS (1 pre-existing observation) |
| Success Criteria | PASS |

Automated success criteria re-verified at review time: `npm run lint` (clean),
`npx astro check` (0 errors), `npm run build` (complete), `npm run db:verify`
(PASS, plan(11)). Manual verification confirmed by the user.

Drift sweep: all planned changes MATCH across all three phases — no DRIFT, no
MISSING, no EXTRA. The `Profile`→`Taste` rename and `W_SPREF`/`W_SEXCL`/
`perViewer`/`unionGenres` deletions are clean (repo-wide grep finds no
stragglers). The duo branch ships intact in roles.ts but is unreachable in
production — recommendations.ts only ever calls `recommend([taste], …)` with a
single-element tuple. "What We're NOT Doing" boundaries all respected.

## Findings

### F1 — Orphaned recommendations run row if picks insert fails

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/recommendations.ts:135-162
- **Detail**: The run row is inserted (step 6), then the three picks (step 7). If the picks insert fails, an orphaned run row remains with zero picks, and the results page renders "No recommendations yet" for a run that exists. Not data-corrupting; self-heals on the next successful run. PRE-EXISTING — the plan explicitly kept persistence steps 6-7 unchanged; this slice did not introduce it.
- **Fix**: In the `picksError` branch, delete the just-inserted run row before redirecting (compensating delete — no transaction seam over PostgREST).
- **Decision**: SKIPPED (pre-existing, out of slice scope; candidate follow-up)

### F2 — Pick rows cast straight to PickRow[] bypass the coercion idiom

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/sessions/[id]/recommendations.astro:44
- **Detail**: `pickData` (untyped supabase `any`) is cast directly to `PickRow[]` and indexed by `.role`/`.genre_ids` without the `Array.isArray(...).map(Number)` / `Record<string,unknown>` coercion used elsewhere (recommendations.ts, sessions.astro). Risk is low — values come from our own validated insert. PRE-EXISTING — this slice only touched the ROLE_RANK/ROLE_LABEL maps on this page, not the read.
- **Fix**: Coerce genre_ids via the project idiom, or add a comment that the data is self-produced and intentionally trusted.
- **Decision**: SKIPPED (pre-existing, out of slice scope; candidate follow-up)

### F3 — Empty-core edge: neither hint nor nudge shows

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/sessions.astro:60-79
- **Detail**: If a core row exists but carries no genres, `prefilledFromCore` is false AND `noCore` is false — so neither the tonight-only hint nor the "no taste core yet" nudge renders. Consistent with the plan's contract ("contributed at least the seed"), so correct as specified, not drift. Noted only because it's a silent-empty state a future reader might not expect.
- **Fix**: None needed — matches contract. Optionally treat empty-core as `noCore` for the nudge if you want the prompt to appear.
- **Decision**: ACCEPTED (matches contract)
