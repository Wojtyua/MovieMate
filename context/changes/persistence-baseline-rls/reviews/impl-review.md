<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Persistence Baseline with Row-Level Access

- **Plan**: context/changes/persistence-baseline-rls/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-05-30
- **Verdict**: NEEDS ATTENTION (all findings fixed in triage)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated criteria re-run during review: `db:reset` clean, `db:verify` 7/7, `npm run lint` pass, internal links resolve, committed Markdown Prettier-clean.

## Findings

### F1 — Inaccurate RLS/owner claim in the source-of-truth doc

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260530165958_rls_convention_example.sql:24-26; docs/reference/persistence-conventions.md:42-43
- **Detail**: Both claimed RLS-with-no-policies blocks "the table owner via PostgREST". The table owner and superusers bypass RLS unless `force row level security` is set, and PostgREST connects as `anon`/`authenticated` (which are subject to RLS). The test comment stated the correct version, so doc/migration contradicted the test. No exploitable gap, but the canonical doc propagates the wrong model.
- **Fix**: Reworded both to state that roles subject to RLS (anon/authenticated, used by PostgREST) are blocked, while owner/superusers bypass unless `force row level security` is set.
- **Decision**: FIXED — commit 0f35325

### F2 — Stale "no test suite yet" line in AGENTS.md

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: AGENTS.md:20
- **Detail**: "There is no test suite yet" was false after this change added a pgTAP DB suite (supabase/tests/) run via `npm run db:verify`.
- **Fix**: Amended to note the pgTAP DB tests + `db:verify`, while clarifying there is no app-level suite yet.
- **Decision**: FIXED — commit 0f35325

### F3 — auth.users insert is GoTrue-schema-fragile

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: supabase/tests/rls_example_isolation.sql:21-23
- **Detail**: `insert into auth.users (id)` relies on `id` being the only NOT-NULL-without-default column on the pinned image; a future image bump could add a required column. Local-only, already commented.
- **Fix**: Added an image-bump caveat to the convention doc's isolation section.
- **Decision**: FIXED — commit 0f35325

### F4 — README structure tree omits supabase/ and docs/

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: README.md (Project Structure block)
- **Detail**: New `supabase/` and `docs/` trees were not reflected in the Project Structure diagram. Cosmetic.
- **Fix**: Added `supabase/` and `docs/` to the structure block.
- **Decision**: FIXED — commit 0f35325
