<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Create and Edit Two Viewer Profiles (S-01)

- **Plan**: context/changes/viewer-profiles/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-06-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Both review sub-agents found the implementation a faithful match to the plan across all three phases — no drift, no missing items, no scope creep beyond what the plan explicitly permitted (`?saved=` confirmation banner, small `GenrePicker` sub-component). The authz question was investigated and cleared: `/api/profiles` is not in `PROTECTED_ROUTES`, but `src/middleware.ts` sets `locals.user` for all routes before the page-only gate, the handler checks `if (!user)`, and RLS independently blocks unauth/cross-user writes (`user_id` is taken from the verified JWT, not client input). All 19 genre IDs verified against TMDB's official list. Slot cap is structurally unbypassable (CHECK + UNIQUE). Automated criteria re-run green at review time (`db:verify` PASS, lint PASS, build Complete). All manual items evidenced (teeth check, curl, user-confirmed browser testing).

## Findings

### F1 — Auth check runs after form parsing

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/profiles.ts:28 vs 59
- **Detail**: An unauthenticated POST parses and validates all fields before the `if (!user)` redirect. Harmless at this scale and the write is RLS-protected regardless; conventionally the auth guard belongs first.
- **Fix**: Optionally hoist the user/supabase guards above formData parsing.
- **Decision**: SKIPPED

### F2 — Raw DB error.message surfaced in redirect

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/profiles.ts:77
- **Detail**: On a Supabase error the raw PostgREST/Postgres message is placed in `?error=` and rendered (escaped — no XSS). Can leak constraint names. Consistent with the auth siblings (signin/signup surface `error.message` too).
- **Fix**: Optionally use a generic "Couldn't save profile" message for the Supabase-error branch.
- **Decision**: SKIPPED

### F3 — Read path ignores select error

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/profiles.astro:19-23
- **Detail**: The page uses `data ?? []` and does not inspect the select's `{ error }`; on a query failure it silently renders empty editors. Read path, RLS-scoped.
- **Fix**: Optionally surface a load-error banner when the select errors.
- **Decision**: SKIPPED

### F4 — React.SubmitEvent vs FormEvent type

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/profiles/ProfileForm.tsx:67
- **Detail**: Uses `React.SubmitEvent<HTMLFormElement>` (the correct React type is `React.FormEvent`). Copied verbatim from the existing `SignInForm.tsx:36` — inherited project pattern, type-checks fine in this repo's setup.
- **Fix**: If correcting, change both ProfileForm.tsx and SignInForm.tsx together.
- **Decision**: SKIPPED
