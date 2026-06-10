<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: One-Shot Recommend

- **Plan**: context/changes/one-shot-recommend/plan.md
- **Scope**: Phase 1–2 of 2 (full plan)
- **Date**: 2026-06-10
- **Verdict**: APPROVED
- **Findings**: 0 critical  0 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria re-verified at review time: `grep -rn "/api/sessions" src` empty; `grep -rni "saved session\|Get recommendations" src/pages/sessions.astro` empty; `npm run lint` clean; `npx astro check` 0 errors; `npm run build` complete. Manual checks 2.6–2.9 confirmed by the user; 2.10 overlay correctly wired on `useFormStatus().pending` (too brief to observe on near-instant responses).

## Findings

### F1 — Input preservation doesn't cover the validation-error path

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — narrow edge case
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recommendations.ts:42-77 + src/pages/sessions.astro:20-33
- **Detail**: The error-refill rule seeds the form from the latest session row when `?error=` is present. That row only exists for *pipeline* failures, which insert the session before failing. Validation failures (unknown mood/genre, overlap, bad runtime) return before any insert, so on that path the "latest session" is a prior/older row (or none) and the just-typed invalid input is not preserved. Benign because every validated field comes from fixed `<select>` options + the disjoint-set toggle logic, so a server validation failure implies tampering/bug, not normal use. The guarantee that matters (TMDB-down / no-match) is on the insert-first path and works.
- **Fix**: None required. Optional future hardening: repost raw values on validation error.
- **Decision**: SKIPPED (no fix required)

### F2 — SecondViewer.tsx edited though not named in the plan's changes

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — obvious and narrow
- **Dimension**: Scope Discipline
- **Location**: src/components/sessions/SecondViewer.tsx:8
- **Detail**: A one-line doc-comment was updated ("Renders inside the 'Get recommendations' form" → "Renders inside the one-shot SessionForm"). Not enumerated in the plan but directly corrects a statement the plan's own work falsified. No behavior change.
- **Fix**: None — accurate comment, keep it.
- **Decision**: SKIPPED (no fix required)

### F3 — Second-viewer genre ids aren't validated against the known set

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — pre-existing, preserved by design
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/recommendations.ts:115-126
- **Detail**: Primary genres go through `parseGenreIds → isKnownGenreId`; the second-viewer fields only filter on `Number.isInteger` (no known-id check). This is the old behavior the plan said to preserve ("existing :94-109"); the scoring engine tolerates unknown ids. Not a regression — recorded so the asymmetry is on file.
- **Fix**: None now. If tightened later, mirror `parseGenreIds` for the `second_*` fields.
- **Decision**: SKIPPED (no fix required)
