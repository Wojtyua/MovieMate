<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Note Understanding (S-04)

- **Plan**: context/changes/ai-note-understanding/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-11
- **Verdict**: NEEDS ATTENTION (resolved — both warnings fixed during triage)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Drift detection: all 11 planned items MATCH — no drift, missing, or scope creep.
Automated criteria: `npm run lint` clean, `npx astro check` 0 errors. All 8 manual
checks evidenced during implementation.

## Findings

### F1 — No shared time budget across the note-augmented retrieval path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability / NFR)
- **Location**: src/lib/recommend-run.ts:74-77, 99-115; src/lib/tmdb-discover.ts:133
- **Detail**: Each fetchCandidates spun up its own 8s AbortController; the ladder ran up to 4 attempts sequentially with no shared deadline, and resolveEntities was called with no signal (up to 5 untimed /search calls). Worst case (slow TMDB, attempts under-filling) ≫ the <10s NFR.
- **Fix A ⭐ (applied)**: Thread one shared ~8s AbortController/deadline through resolveEntities + every ladder attempt; fetchCandidates now accepts an external `signal` and folds its abort into the per-call controller. RETRIEVAL_BUDGET_MS caps cumulative TMDB time; the AI parse keeps its own separate 2.5s budget.
- **Decision**: FIXED via Fix A

### F2 — parseNote can throw on a malformed model response

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/note-parse.ts:74-86 (root: src/lib/ai.ts:102 `as T`)
- **Detail**: extract<T>() casts parsed JSON with `as T` without shape validation. A non-array/missing field (e.g. via a non-strict AI_MODEL override) would make result.genres.map / .slice throw a TypeError that parseNote did not catch; recommend-run called parseNote outside its try/catch and recommendations.ts did not wrap recommendRun, so it would surface as a 500 — defeating the never-throws + always-clean-error contract.
- **Fix (applied)**: Coerce each field via asStringArray() (Array.isArray + typeof string filter) before use; a malformed response now yields EMPTY, never a throw.
- **Decision**: FIXED

### F3 — Ladder gates on candidate-pool count, not post-scoring pick count

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/recommend-run.ts:109-111
- **Detail**: The plan's §3 contract phrased the relax trigger as "post-scoring pick count below three," but the worked example said "stop at the first attempt with ≥3 candidates." Implementation uses candidates.length >= 3 — the operative, simpler, intended reading. Benign.
- **Decision**: SKIPPED
