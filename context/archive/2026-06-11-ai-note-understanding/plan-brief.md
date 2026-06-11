# AI Note Understanding (S-04) — Plan Brief

> Full plan: `context/changes/ai-note-understanding/plan.md`
> Research: `context/changes/ai-note-understanding/research.md`

## What & Why

The free-text session note ("something dumb, maybe with Adam Sandler") is
captured and persisted today but **dropped before retrieval** — it has no effect
on recommendations. This change parses the note with a single AI call into
structured search parameters (genres, people, keywords), resolves them to TMDB
ids, and merges them into the discover query so the candidate pool reflects what
the user actually asked for. Implements roadmap S-04 (PRD FR-006, FR-007).

## Starting Point

S-07 extracted the retrieval pipeline into `recommend-run.ts` and left a clean
seam at `:55`; F-01 left the OpenRouter client (`ai.ts`) deliberately unused for
S-04. The note is already persisted (`movie_night_sessions.note`) — it just
isn't threaded into `RecommendRunSession`. No `with_cast`/`with_keywords` discover
filters, no `/search/person|keyword` helpers, and no AI timeout exist yet.

## Desired End State

A note-bearing session returns three picks whose pool reflects the note, within
`< 10 s`. Empty/unparseable notes, unconfigured/slow/erroring AI, or over-narrow
filters all degrade — via a fixed relaxation ladder — to today's genre-only
retrieval, still three picks, no 500.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| AI placement | Retrieval layer only, at `recommend-run.ts:55` | AI shapes the candidate pool; deterministic scoring/roles stay untouched | Research |
| Structured output | Strict `json_schema` via new `extract<T>()` on `ai.ts` | Most reliable for fixed keys; keeps `complete()`/`pingAi()` undisturbed | Research + Plan |
| Model default | `openai/gpt-5.4-mini` (was `gpt-4o-mini`) | Cheaper; `AI_MODEL` env still overrides — verify strict-output support at impl | Plan |
| AI timeout | ~2.5 s, separate from TMDB's ~8 s | Protects `<10s` path; slow AI never starves TMDB | Plan |
| Relaxation order (OQ-2) | keywords → cast → AI-genres → genre-only | Drop noisiest signal first; preserve strongest user intent (named person) longest | Plan |
| Entity caps | ≤ 2 people, ≤ 3 keywords, ≤ 3 genres | Bounds subrequests (worst case ~9, under 50 cap) and over-narrowing | Plan |
| Note length | Server-side truncate ~500 chars | Bounds prompt cost/abuse without a UI change | Plan |
| Genre mapping | Case-insensitive exact match vs `genres.ts` | Deterministic, no extra TMDB call; prompt supplies allowed list | Plan |
| Config-status copy | Fix stale "justifications" string now | This slice is when AI becomes note-parsing | Plan |

## Scope

**In scope:** `extract<T>()` on `ai.ts` + model default; `note-parse.ts`
extractor; `genreIdByName` mapping; `tmdb-search.ts` (person/keyword resolution);
`with_cast`/`with_keywords` in discover; threading `note` through the pipeline;
the relaxation ladder; config-status copy fix.

**Out of scope:** scoring changes; provider switch; per-candidate detail calls;
Vitest/MSW tests (separate rollout); UI maxlength; genre synonym table; any
schema/migration.

## Architecture / Approach

Three independent primitives — AI `extract()`, `parseNote()`, TMDB
`resolveEntities()` — assembled at the `recommend-run.ts:55` seam. Flow:
`note → extract (genres/people/keywords) → map genres locally + resolve
people/keywords to ids → merge into /discover/movie → score (unchanged)`. Every
new dependency fails soft to genre-only; the relaxation ladder re-queries discover
until ≥ 3 candidates.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. AI extraction primitive | `extract<T>()` (strict JSON, temp 0, ~2.5s timeout) + model default | Model id must support strict `json_schema` |
| 2. Note → params extractor | `parseNote()`: truncate, prompt, map genres, cap, fail-soft | Genre-string mapping misses |
| 3. TMDB resolution | `searchPerson`/`searchKeyword` + `with_cast`/`with_keywords` | Subrequest budget if uncapped |
| 4. Wiring + relaxation ladder + copy | Thread note, merge ids, guarantee ≥3, fix copy | Over-filtering below three picks (Risk #1) |

**Prerequisites:** OpenRouter + TMDB configured locally (`astro dev` is real workerd).
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- `openai/gpt-5.4-mini` must exist on OpenRouter with strict structured-output
  support; if not, fall back to `gpt-4o-mini` (env override unaffected).
- Relaxation re-queries discover, adding subrequests — bounded by caps + "stop at
  first ≥ 3"; assumed comfortably under the 50-subrequest free cap.
- No automated regression coverage this change; relies on lint + typecheck +
  manual workerd runs until the test-rollout phase lands.

## Success Criteria (Summary)

- Note-bearing sessions return three picks whose pool reflects the note, `< 10 s`.
- Empty note / AI failure / over-narrow filters → three picks via fallback, no 500.
- Behavior never worse than today's genre-only baseline.
