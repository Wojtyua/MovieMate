---
date: 2026-06-11T00:00:00Z
researcher: Claude (Opus 4.8)
git_commit: 937e5fada21880d7b2739386080e48b1efadd18b
branch: main
repository: 10xMovie (MovieMate)
topic: "Optimal way to introduce AI into free-text note parsing (S-04)"
tags: [research, codebase, ai, openrouter, tmdb, recommend-run, structured-outputs]
status: complete
last_updated: 2026-06-11
last_updated_by: Claude (Opus 4.8)
---

# Research: Optimal AI introduction for note understanding (S-04)

**Date**: 2026-06-11
**Researcher**: Claude (Opus 4.8)
**Git Commit**: 937e5fada21880d7b2739386080e48b1efadd18b
**Branch**: main
**Repository**: 10xMovie (MovieMate)

## Research Question

For roadmap slice **S-04 ai-note-understanding** (PRD FR-006/FR-007): what is the
optimal way to introduce AI into the use case where a free-text note
("something dumb, maybe with Adam Sandler") is parsed into structured search
parameters that sharpen TMDB retrieval? Focus: model choice, structured-output
mechanism, prompt design, placement relative to retrieval, the `<10s` + workerd
subrequest budget, and graceful degradation.

## Summary

The infrastructure for this slice is already in place and deliberately left for
S-04 to consume — the recommended shape is **small and additive, not a new
subsystem**:

1. **Placement.** Insert one AI "note → params" step inside
   `recommend-run.ts`, between taste construction (`:55`) and the
   `fetchCandidates` call (`:58`). This is the seam S-07 created when it
   extracted the pipeline. Nothing upstream (endpoint, form, DB) needs to move;
   the note is already captured and persisted — it just isn't threaded into the
   pipeline yet.

2. **Mechanism.** Use OpenRouter **strict structured outputs**
   (`response_format: { type: "json_schema", json_schema: { …, strict: true } }`)
   for a **single** extraction call returning a fixed-key object
   (`{ genres[], people[], keywords[] }`). For fixed, predictable keys this is
   more reliable than tool/function-calling and far more reliable than
   free-form "return JSON" prompting. `src/lib/ai.ts` does **not** support this
   yet — its `complete()` body sends only `model/messages/max_tokens`.

3. **Model.** Keep `openai/gpt-4o-mini` as the committed default (it supports
   strict structured outputs), but treat this slice as the "S-04 retune" its own
   code comment anticipates: the model is an **env override (`AI_MODEL`)**, so
   the pick is a config decision, not a code decision. Cheaper/faster retune
   candidates to evaluate in `/10x-plan`: a Gemini Flash tier (currently the most
   popular structured-output model on OpenRouter) and a Claude Haiku tier.

4. **Two-stage resolution.** The LLM extracts *names/strings*; TMDB turns them
   into *ids*. Names → ids needs new `/search/person` and `/search/keyword`
   calls (neither helper exists today). `/discover/movie` filters by
   `with_cast`/`with_keywords` only by **id**.

5. **Budget & degradation.** Worst case adds ~1 (AI) + N person + M keyword
   subrequests on top of the existing 3 discover pages — comfortably under the
   50-subrequest free cap, but it puts **AI latency on the `<10s` critical path
   for the first time**. Every new dependency must fail soft to genre-only
   retrieval and still return three picks. The `complete()` client currently has
   **no timeout** — that is the single most important gap to close.

The single biggest risk is **not** the budget; it is **over-filtering the
candidate pool below three picks** (test-plan Risk #1) once cast+keyword+genre
stack on top of the runtime hard filter. The relaxation order (FR-007 / OQ-2)
is the load-bearing design decision and is explicitly deferred to `/10x-plan`.

## Detailed Findings

### Area 1 — Where AI inserts (placement)

The pipeline was extracted into `src/lib/recommend-run.ts` by S-07 and is the
sole retrieval path; the endpoint just builds a session and calls it.

- The note is **captured** in `src/components/sessions/SessionForm.tsx:159-179`
  (textarea `name="note"`, placeholder "Anything else about tonight…", no length
  limit), **parsed** in `src/pages/api/recommendations.ts:76-77` (trim → `null`
  if empty), and **persisted** at `recommendations.ts:103` (column
  `movie_night_sessions.note text`, `supabase/migrations/20260606085900_movie_night_sessions.sql:36`).
- **But the note is dropped before retrieval.** The `RecommendRunSession` object
  built at `recommendations.ts:112-119` omits `note`, the interface
  (`recommend-run.ts:11-15`) has no `note` field, and `recommendRun` never reads
  it. S-07's plan states this explicitly: "the note is still persisted but
  unused by retrieval" (`context/archive/2026-06-10-one-shot-recommend/plan.md:40`).
- **The seam:** `recommend-run.ts:55` assembles `discoverGenreIds` (union of
  preferred genres); `:58-63` calls `fetchCandidates`. AI note-parsing runs
  *between* these two lines, producing extra genre ids + cast ids + keyword ids
  that merge into the discover params.
- **Minimal wiring:** add `note: string | null` to `RecommendRunSession`
  (`recommend-run.ts:11-15`), pass it from `recommendations.ts:112-119`, call the
  extractor at the seam, and preserve the existing fail-soft branches
  (`recommend-run.ts:46-49` TMDB-null, `:64-69` empty pool).

### Area 2 — Structured-output mechanism (the core "how")

`src/lib/ai.ts` is an OpenRouter client over raw `fetch` (workerd-safe), returning
a **raw `Response`** the caller must parse:

- `complete(messages, maxTokens)` posts only `{ model, messages, max_tokens }`
  (`ai.ts:38`). **Missing for extraction:** no `response_format` (JSON / schema),
  no `tools`/`tool_choice`, no `temperature`, and **no timeout / AbortController**
  (contrast `tmdb-discover.ts:117,128-131`, which aborts at ~8s).
- Mechanism choice (web-grounded, June 2026): OpenRouter supports
  `response_format: { type: "json_object" }` (basic JSON) and
  `{ type: "json_schema", json_schema: { …, strict: true } }` (strict schema).
  For **fixed, predictable keys like entity extraction**, strict `json_schema`
  is the most reliable option; tool-calling is a close second; free-form
  "return JSON" prompting is the least reliable. A Response-Healing plugin exists
  for malformed-JSON repair but does **not** fix schema-adherence.
  Sources below.
- **Recommendation:** widen `complete()` (or add a sibling
  `extract<T>()`) to thread `response_format`, a low `temperature` (0), and a
  `signal` for timeout; add a typed parser that validates the raw `Response`
  into `{ genres?: string[]; people?: string[]; keywords?: string[] }` and
  **fail-soft to a neutral empty result** on any HTTP/parse/validation failure —
  mirroring the `return null, never throw` contract at `ai.ts:23-25`,
  `tmdb.ts:15-17`, `supabase.ts:6-8`.

### Area 3 — Model choice

- Default is `openai/gpt-4o-mini`, overridable via `AI_MODEL`
  (`ai.ts:6,26`; env declared `astro.config.mjs:22-23`, server/secret/optional).
  The in-code comment literally says "S-04 retune," and F-01 made `AI_MODEL` an
  override specifically "so S-04 can retune without a code change"
  (`context/archive/2026-06-02-provision-external-apis/plan.md:205`).
- For a single short extraction with a small fixed schema, the task is
  **cheap-model territory** — extraction/classification is the canonical "use a
  small fast model" workload. Candidates to compare in `/10x-plan` on
  cost × latency × structured-output reliability (verify current ids/prices then):
  - `openai/gpt-4o-mini` — committed default; supports strict json_schema.
  - A **Gemini Flash** tier — currently the most-used structured-output model on
    OpenRouter; optimize for latency/cost on the `<10s` path.
  - A **Claude Haiku** tier — if extraction quality on messy notes wins.
- **Provider stays OpenRouter** (raw fetch, OpenAI-compatible) — it is the
  provider of record (PRD §, F-01) and dodges the runtime's #1 risk (Node-only
  SDKs failing only after deploy). Switching providers is out of scope; switching
  *model* is a one-line env change.

### Area 4 — Two-stage name→id resolution and the TMDB surface

- `src/lib/tmdb-discover.ts` calls only `/discover/movie`, 3 pages =
  **3 subrequests** today (`DEFAULT_PAGES = 3`). The query builder
  (`tmdb-discover.ts:77-93`) sets only `with_genres`, `with_runtime.lte`,
  `vote_count.gte`. There is **no `with_cast` / `with_keywords` / `with_people`**
  anywhere, and **no `/search/person` or `/search/keyword`** helper (grep-confirmed).
- `/discover/movie` filters by cast/keyword **only by numeric id**, so S-04 needs
  a resolve step: `GET /search/person?query=…` → person id, `GET /search/keyword?query=…`
  → keyword id, then `with_cast=id1|id2&with_keywords=id3`. New work:
  - add `castIds?: number[]` / `keywordIds?: number[]` to `DiscoverParams`
    (`tmdb-discover.ts:31-42`) + the builder + `FetchCandidatesOptions`;
  - add `searchPerson()` / `searchKeyword()` (new `src/lib/tmdb-search.ts` or
    extend `tmdb.ts`) — the `tmdb.ts:request()` seam is ready.
- **List items carry no runtime/cast/keyword detail** — the existing comment
  forbids per-candidate detail calls for budget reasons
  (`tmdb-discover.ts:11-15`). Keep AI-derived signals at the **discover query
  (retrieval) layer**, not as a scoring signal (see Area 5).

### Area 5 — Scoring stays untouched (retrieval-only integration)

- `recommend()` (`src/lib/recommend/roles.ts:100-104`) consumes only `Taste`
  (`{preferred_genre_ids, excluded_genre_ids}`, `scoring.ts:34-37`), `SessionPrefs`
  (`{mood, intensity}`), and `TmdbMovie[]`. Every scoring signal is genre-id set
  math plus `vote_average`/`popularity` (`scoring.ts:65-132`); `TmdbMovie`
  carries no cast/keyword fields (`tmdb-discover.ts:18-28`).
- Therefore AI-derived cast/keywords should **shape the candidate pool, not the
  ranking**. Making them a scoring signal would force per-candidate detail calls
  (budget-forbidden) and new `WEIGHTS`. PRD agrees: "deterministic scoring logic
  is extended, not replaced" (`prd.md:69`); AI output "only adds query signal"
  (`prd.md:110`). Return shape is unchanged: `{ picks: Pick[] }`, each
  `{ role, movie, score }`, ≤3, roles branch on taste cardinality.

### Area 6 — Budget, latency, and graceful degradation (hard constraints)

From `prd.md`, `test-plan.md`, `infrastructure.md`, and the archives:

- **`<10s` end-to-end**, and S-04 is the slice that first puts AI latency *on the
  critical path before retrieval* (`prd.md:65,132`; `test-plan.md:62-65`). Cap
  candidate set, set a client-visible timeout, short-circuit on slow upstream
  (`infrastructure.md:97`). The `complete()` client's missing timeout is the gap
  to close first.
- **50-subrequest free cap is the first limit hit** (`infrastructure.md:64`), not
  request count; CPU is 10ms/invocation free. Worst case S-04:
  `1 (AI) + N person + M keyword + 3 discover` ≈ ~10 — safe, but **batch/limit**
  per `infrastructure.md:96`. (`astro dev` is real workerd locally — auto-memory
  `astro-dev-runs-in-workerd` — so this is locally verifiable.)
- **Always three picks (Risk #1, `test-plan.md:43,71`).** AI-derived filters must
  **relax when the pool drops below three**. This is the dominant risk and the
  reason the relaxation order matters more than any model choice.
- **Clean fallback (Risk #2, `test-plan.md:44,72`).** Empty/unparseable note, or
  AI unavailable/slow/timed-out → **genre-only retrieval, still three picks, no
  500**. "200 means success" is the trap: the fallback must not silently return
  <3. S-04 introduces OpenRouter as the second critical-path dependency this risk
  now covers.

## Recommended approach (for /10x-plan to refine)

1. **Thread the note** through `RecommendRunSession` → `recommendRun`, parse it at
   the `recommend-run.ts:55` seam, behind an `if (note)` guard.
2. **Single strict-JSON extraction call** via a widened `ai.ts` (add
   `response_format` json_schema strict, `temperature: 0`, and an
   AbortController/timeout). Schema = `{ genres[], people[], keywords[] }` of
   plain strings. Fail-soft to empty on any error.
3. **Resolve names → ids** with new `searchPerson`/`searchKeyword` helpers; map
   genre strings via the existing genre map (`src/lib/genres.ts`). Cap the number
   of resolved entities to protect the subrequest budget.
4. **Merge ids into discover params** (`with_cast`, `with_keywords`, extra
   `with_genres`); runtime stays the only hard filter; excluded genres stay a
   scoring penalty (S-03 precedent).
5. **Relaxation ladder (OQ-2 — the key open decision).** A reasonable default to
   validate: drop keywords → drop cast → drop AI-genres → genre-only baseline,
   re-querying until ≥3 candidates. Tune in `/10x-plan`.
6. **Keep `AI_MODEL=openai/gpt-4o-mini` as default**; benchmark Gemini Flash /
   Claude Haiku tiers as a pure config retune.
7. **Broaden the stale degradation copy** at `config-status.ts:29` (currently
   "uzasadnienia AI" / justifications) to cover note parsing.

## Code References

- `src/lib/recommend-run.ts:11-15` — `RecommendRunSession` (add `note`)
- `src/lib/recommend-run.ts:55-63` — **AI insertion seam** (between taste + fetchCandidates)
- `src/lib/recommend-run.ts:46-49,64-69` — existing fail-soft branches to preserve
- `src/lib/ai.ts:6,22-42` — OpenRouter client; default model; null-on-missing contract
- `src/lib/ai.ts:38` — `complete()` body (no response_format / temperature / timeout)
- `src/lib/tmdb-discover.ts:31-42,77-93` — `DiscoverParams` + query builder (add cast/keyword)
- `src/lib/tmdb-discover.ts:11-15` — "no per-candidate detail calls" budget comment
- `src/lib/tmdb.ts:15-28` — `request()` seam ready for `/search/person|keyword`
- `src/lib/recommend/{scoring,roles,affinity}.ts` — genre-only scoring (leave untouched)
- `src/pages/api/recommendations.ts:76-77,103,112-119,141` — note parse/persist/drop/call
- `src/components/sessions/SessionForm.tsx:159-179` — note textarea
- `astro.config.mjs:19-23` — env schema (`OPENROUTER_API_KEY`, optional `AI_MODEL`, `TMDB_READ_ACCESS_TOKEN`)
- `src/lib/config-status.ts:26-32` — AI config-status (stale "justifications" copy)
- `src/pages/api/health/integrations.ts:22` — `pingAi()` liveness surface

## Architecture Insights

- **Graceful degradation is a repo-wide convention**: every external client
  (`supabase.ts:6-8`, `tmdb.ts:15-17`, `ai.ts:23-25`) returns `null` when
  unconfigured and never throws; retrieval degrades on bad status too
  (`tmdb-discover.ts:95-97,154-161`). S-04's AI path must mirror this exactly.
- **The pipeline was pre-shaped for this slice.** F-01 left the `complete()` seam
  unused-on-purpose; S-03 kept the deterministic engine AI-free; S-07 extracted
  `recommend-run.ts` and preserved Risk #1/#2 behavior. S-04 is the intended
  consumer of all three.
- **Retrieval vs. ranking split** is the clean architectural line: AI changes the
  *candidate pool*; deterministic scoring still owns *ordering and roles*.

## Historical Context (from prior changes)

- `context/archive/2026-06-02-provision-external-apis/plan.md:5,54,205` — OpenRouter
  over raw fetch (no Node SDK); secrets runtime-only on workerd; `AI_MODEL` left as
  an override for the S-04 retune; justification/prompt work deferred to S-04.
- `context/archive/2026-06-06-scored-recommendations/research.md:31,33,89` — `ai.ts`
  "fully wired but belongs to S-04"; the `<10s` budget today is TMDB+CPU, not AI
  latency; S-04 is what adds AI latency to the path. `plan-brief.md:27,59` —
  runtime-only hard filter; excluded genres as penalty; thin-pool fallback precedent.
- `context/archive/2026-06-10-one-shot-recommend/plan.md:40` — note persisted but
  unused by retrieval; pipeline extracted into `recommend-run.ts`; Risk #1/#2
  preserved byte-for-byte (S-04 must not regress).
- FR-010 (AI per-pick justifications) removed (`prd.md:120-121`); `src/lib/ai.ts`
  repurposed, not re-scaffolded (`roadmap.md:65,181`). No justification-specific code
  survives — only the generic `complete()` seam.

## Open Questions

- **OQ-2 / FR-007 — AI-derived filter relaxation order** when the pool falls below
  three (`prd.md:158`, `roadmap.md:116`, `change.md`). **The key decision for
  `/10x-plan`.** A starting hypothesis: keywords → cast → AI-genres → genre-only.
- **Final `AI_MODEL` pick** — gpt-4o-mini vs a Gemini Flash vs a Claude Haiku tier;
  decide on cost × latency × structured-output reliability (verify current model
  ids and prices at plan time).
- **Entity caps** — max people/keywords resolved per note to bound subrequests and
  CPU (and to limit over-narrowing).
- **Note length cap** — none today (UI or server); worth bounding before sending to
  the model (prompt-cost + abuse).
- **Genre-name → id mapping source** — reuse `src/lib/genres.ts`; confirm coverage
  for AI-emitted genre strings.

## External Sources (verified 2026-06-11)

- OpenRouter — Structured Outputs (json_object vs strict json_schema): https://openrouter.ai/docs/guides/features/structured-outputs
- OpenRouter — Tool & Function Calling: https://openrouter.ai/docs/guides/features/tool-calling
- OpenRouter — Response Healing (malformed-JSON repair, not schema adherence): https://openrouter.ai/announcements/response-healing-reduce-json-defects-by-80percent
- OpenRouter — models filtered by structured_outputs support: https://openrouter.ai/models?order=newest&supported_parameters=structured_outputs

## Related Research

- `context/archive/2026-06-06-scored-recommendations/research.md` — retrieval + scoring pipeline
- `context/archive/2026-06-02-provision-external-apis/plan.md` — external API provisioning
