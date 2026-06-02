<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Provision External APIs (TMDB + OpenRouter)

- **Plan**: context/changes/provision-external-apis/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-06-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Build + lint pass. Binding runtime gate (workerd, `astro dev`) and remote ops smoke both returned `{ tmdb: "ok", ai: "ok" }`; unauthenticated request returns 401. Clients follow the `supabase.ts` null-when-unconfigured contract; route guards in-route with a clean 401 JSON. No scope creep — the `request()`/`complete()` seams are the S-03/S-04 reuse the plan anticipated.

## Findings

### F1 — Route "detail" is static hint text, not the real error

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/health/integrations.ts:30-35
- **Detail**: Plan's route contract said "include a short error detail per provider on failure." Because `pingTmdb()`/`pingAi()` swallow errors and return a bare boolean, the route emits a static hint, not the actual cause (auth vs. network vs. 5xx). Fine for a health probe; no diagnostic signal beyond "fail".
- **Fix**: Acceptable as-is for F-01. If richer diagnostics wanted later, have the ping functions return `{ ok, status?, error? }` instead of a boolean — defer to S-03/S-04.
- **Decision**: SKIPPED

### F2 — AI_MODEL empty-string would not fall back to the default

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/ai.ts:26
- **Detail**: `const model = AI_MODEL ?? DEFAULT_AI_MODEL` falls back only on null/undefined. An empty-string AI_MODEL would POST an empty model and fail. `??` is lint-mandated here, so this is a knowingly-accepted edge.
- **Fix**: Guard the empty case if desired: `const model = AI_MODEL?.trim() ? AI_MODEL : DEFAULT_AI_MODEL;`
- **Decision**: SKIPPED

### F3 — AI_MODEL declared as access: "secret" though not sensitive

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: astro.config.mjs:23
- **Detail**: A model identifier is not a secret but is declared `access: "secret"` alongside the two real keys. Implementation faithfully followed the plan's explicit instruction — a plan-level semantic nit, not a deviation. Harmless (server context either way).
- **Fix**: Optionally relax to `access: "public"` so intent reads true. Not worth a config churn on its own.
- **Decision**: SKIPPED
