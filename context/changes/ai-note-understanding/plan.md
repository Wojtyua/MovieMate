# AI Note Understanding (S-04) Implementation Plan

## Overview

Thread the free-text session note ("something dumb, maybe with Adam Sandler"),
which is already captured and persisted but dropped before retrieval, into the
recommendation pipeline. A single strict-JSON AI extraction call turns the note
into `{ genres[], people[], keywords[] }`; those strings are resolved to TMDB
ids (genres locally, people/keywords via TMDB search) and merged into the
`/discover/movie` query so the candidate pool reflects the note. AI runs on the
`< 10 s` critical path for the first time, so every new dependency fails soft to
genre-only retrieval and the pipeline still returns exactly three picks
(test-plan Risk #1 / #2).

This implements roadmap slice **S-04** (PRD FR-006, FR-007) and resolves the
roadmap's **OQ-2** (AI-derived filter relaxation order).

## Current State Analysis

- The note is **captured** (`SessionForm.tsx` textarea `name="note"`),
  **parsed/persisted** (`recommendations.ts:76-77,103` → `movie_night_sessions.note`),
  and then **dropped**: `RecommendRunSession` (`recommend-run.ts:11-16`) has no
  `note` field, `recommendRun` never reads it. S-07's archived plan states this
  explicitly ("the note is still persisted but unused by retrieval").
- The **AI insertion seam** is `recommend-run.ts:55` (assembles `discoverGenreIds`)
  → `:58-63` (`fetchCandidates`). Note-parsing runs between these lines.
- `ai.ts` is a workerd-safe OpenRouter client returning a raw `Response`.
  `complete()` posts only `{ model, messages, max_tokens }` — **no
  `response_format`, no `temperature`, and no timeout / AbortController.** The
  missing timeout is the highest-priority gap because AI now sits on the critical
  path. Default model `openai/gpt-4o-mini`, override via `AI_MODEL` env (declared
  `astro.config.mjs:19-23`, server/secret/optional). The in-code comment already
  reads "S-04 retune."
- `tmdb-discover.ts` calls only `/discover/movie` (3 pages, OR-union genres,
  runtime hard filter, vote-count floor). **No `with_cast` / `with_keywords`** in
  `DiscoverParams` or the builder; **no `/search/person` / `/search/keyword`**
  helper exists (`tmdb.ts:request()` seam is ready for them).
- Scoring (`src/lib/recommend/*`) consumes only `Taste`, `SessionPrefs`, and
  `TmdbMovie[]`; `TmdbMovie` carries no cast/keyword fields. AI signal therefore
  belongs at the **retrieval (discover query) layer, not the ranking layer**.
- **No JS test framework yet** (Vitest is bootstrapped by a separate
  test-rollout change `testing-always-three-picks-core`). Automated verification
  for this change is `npm run lint` + `npx astro check`; behavior is verified
  manually on `astro dev` (real workerd — see auto-memory `astro-dev-runs-in-workerd`).
- Graceful degradation is a repo-wide convention: every external client returns
  `null` / `[]` and never throws on missing config or bad status
  (`ai.ts:23-25`, `tmdb.ts:15-17`, `tmdb-discover.ts:95-97`). The new AI path must
  mirror this exactly.

## Desired End State

A session submitted with a non-empty note returns three picks whose candidate
pool reflects the note's genres/people/keywords, within `< 10 s`. When the note
is empty/unparseable, or OpenRouter is unconfigured/slow/erroring, or any
resolved filter drains the pool below three, the pipeline relaxes filters in a
fixed order and ultimately falls back to today's genre-only retrieval — still
three picks, no 500. Verified by submitting representative notes against the
running `astro dev` workerd server and observing three picks plus a candidate
set that shifts with the note.

### Key Discoveries:

- AI insertion seam: `recommend-run.ts:55` (between taste union and `fetchCandidates`).
- `ai.ts:38` — `complete()` body omits `response_format` / `temperature` / timeout.
- `tmdb-discover.ts:31-42,77-93` — `DiscoverParams` + builder to extend with `with_cast` / `with_keywords`.
- `tmdb.ts:15-28` — `request()` seam ready for `/search/person|keyword`.
- `genres.ts:16-43` — canonical 19-genre id↔name list + `isKnownGenreId`; basis for name→id mapping.
- `config-status.ts:29` — stale "uzasadnienia AI" (justifications) copy to reword.
- `recommend-run.ts:46-49,64-69` — existing fail-soft branches to preserve byte-for-byte.

## What We're NOT Doing

- **Not** making AI output a scoring signal. AI changes the candidate pool only;
  deterministic scoring/roles (`src/lib/recommend/*`) and the `{ picks: Pick[] }`
  return shape are untouched (PRD §, `prd.md:69,110`).
- **Not** switching AI providers. Stays OpenRouter over raw fetch; only the
  *model* default changes (a config decision).
- **Not** fetching per-candidate detail (cast/keyword/runtime) — budget-forbidden
  (`tmdb-discover.ts:11-15`). AI signal lives at the discover-query layer.
- **Not** writing Vitest/MSW tests. No JS test framework exists yet; that is the
  separate test-rollout phase. This change is verified by lint + typecheck +
  manual workerd runs.
- **Not** adding a synonym/alias genre table or a UI maxlength on the note.
  Genre mapping is case-insensitive exact match (the prompt supplies the allowed
  list); the length cap is server-side only.
- **Not** changing the persisted schema. `movie_night_sessions.note` already
  exists; no migration.

## Implementation Approach

Build three independent primitives, then assemble them at the seam:

1. **AI extraction primitive** (`ai.ts`): a typed `extract<T>()` method that
   sends strict `json_schema`, `temperature: 0`, and an AbortController-backed
   ~2.5 s timeout, returning the parsed object or `null` on any failure.
2. **Note → params** (`note-parse.ts`): truncate the note, prompt the model with
   the allowed genre names, call `extract()`, map genre strings → ids locally,
   apply entity caps, fail soft to an empty result.
3. **TMDB resolution** (`tmdb-search.ts` + `tmdb-discover.ts`): resolve people →
   person ids and keyword strings → keyword ids; extend the discover query with
   `with_cast` / `with_keywords`.
4. **Wiring + relaxation** (`recommend-run.ts` + endpoint): thread `note`, call
   the extractor at `:55`, resolve ids, and re-query discover under a fixed
   relaxation ladder until ≥ 3 candidates, then genre-only baseline.

## Critical Implementation Details

- **Timeout split.** The AI call gets its own ~2.5 s AbortController; TMDB
  retrieval keeps its existing ~8 s budget (`tmdb-discover.ts:117`). These are
  separate budgets, not one shared ceiling — a slow AI call must never starve
  TMDB (the dependency most able to drain picks). On AI timeout, skip note
  parsing and proceed to genre-only discover.
- **Model verification.** The default model changes to `openai/gpt-5.4-mini`.
  Before relying on strict structured outputs, confirm at implementation time
  that this model id exists on OpenRouter and is listed under
  `supported_parameters=structured_outputs`. If it does not support strict
  `json_schema`, fall back to `openai/gpt-4o-mini` for the default and note it in
  Progress. (`AI_MODEL` env still overrides either way.)
- **Relaxation re-queries discover.** Each relaxation step issues a fresh
  `fetchCandidates` call; combined with resolution this can add subrequests.
  Worst case `1 (AI) + 2 person + 3 keyword + 3 discover` per attempt, a few
  attempts — still well under the 50-subrequest free cap, but cap entities
  (≤ 2 people, ≤ 3 keywords) and stop relaxing the moment the pool reaches three.

## Phase 1: AI Extraction Primitive

### Overview

Give `ai.ts` a strict-structured-output method with a timeout, and change the
default model — without touching the existing `complete()` / `pingAi()` paths.

### Changes Required:

#### 1. AI client `extract<T>()` method

**File**: `src/lib/ai.ts`

**Intent**: Add a typed extraction method to `AiClient` that requests strict
JSON-schema output deterministically and enforces a caller-supplied timeout, so
note-parsing gets reliable structured output on the critical path. Leave
`complete()` and `pingAi()` untouched (sibling method, not a widened signature).

**Contract**: Extend the `AiClient` interface with
`extract<T>(messages, schema, opts?): Promise<T | null>` where `schema` is a
JSON Schema object (the `json_schema.schema` payload) and `opts` carries
`{ timeoutMs?: number; maxTokens?: number; schemaName?: string }`. The POST body
sets `response_format: { type: "json_schema", json_schema: { name, strict: true,
schema } }`, `temperature: 0`, and `max_tokens`. An internal `AbortController`
with `setTimeout(timeoutMs)` (default ~2500) aborts the fetch; the method parses
`choices[0].message.content` as JSON and returns the typed object, or returns
`null` on missing key, non-ok status, abort/timeout, or any parse error (mirrors
the `return null, never throw` contract at `ai.ts:23-25`). Reuses the existing
auth/attribution headers.

#### 2. Default model retune

**File**: `src/lib/ai.ts`

**Intent**: Change the committed default from `openai/gpt-4o-mini` to
`openai/gpt-5.4-mini` (cheaper), per the S-04 retune the code comment
anticipates. `AI_MODEL` env override behavior is unchanged.

**Contract**: Update `DEFAULT_AI_MODEL`. Verify the model supports strict
`json_schema` on OpenRouter before committing (see Critical Implementation
Details); if not, retain `openai/gpt-4o-mini` and record the reason in Progress.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Type checking passes: `npx astro check`

#### Manual Verification:

- [ ] `pingAi()` still returns `true` against a configured OpenRouter key (the existing liveness path is unbroken).
- [ ] An ad-hoc `extract()` call on `astro dev` returns a typed object for a sample note and `null` (not a throw) when the timeout is forced low.

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Note → Params Extractor

### Overview

A pure-ish module that turns a raw note string into resolved-locally genre ids
plus people/keyword strings, with truncation, caps, and fail-soft behavior.

### Changes Required:

#### 1. Genre name → id mapping

**File**: `src/lib/genres.ts`

**Intent**: Add a case-insensitive name→id lookup so AI-emitted genre strings map
to the canonical 19 TMDB ids. Drop unmatched strings.

**Contract**: Export `genreIdByName(name: string): number | undefined` (lowercase
exact match against `MOVIE_GENRES`). No new TMDB call.

#### 2. Note extractor module

**File**: `src/lib/note-parse.ts` (new)

**Intent**: Compose the extraction: truncate the note, prompt the model to return
genres (from the allowed list), people, and keywords, call `ai.extract()` with
the ~2.5 s timeout, then map and cap the result into ids/strings the resolver and
discover query consume. Fail soft to an empty result so the caller's `if` stays
trivial.

**Contract**: Export
`parseNote(ai: AiClient, note: string): Promise<{ genreIds: number[]; people: string[]; keywords: string[] }>`.
Steps: trim + truncate to ~500 chars; build a system+user message instructing
strict extraction and passing the 19 allowed genre names; define the JSON schema
`{ genres: string[], people: string[], keywords: string[] }` (all required,
arrays of strings); call `ai.extract(messages, schema, { timeoutMs: 2500 })`; on
`null` return `{ genreIds: [], people: [], keywords: [] }`. Otherwise map genres
via `genreIdByName` (drop misses), then apply caps: ≤ 3 genre ids, ≤ 2 people,
≤ 3 keywords (slice the head of each). Never throws.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Type checking passes: `npx astro check`

#### Manual Verification:

- [ ] On `astro dev`, `parseNote` for "something dumb, maybe with Adam Sandler" returns Comedy-ish genre ids + `["Adam Sandler"]` (people) within the budget.
- [ ] An empty/garbage note and an AI timeout both return the empty result (no throw), and a long note is truncated before the call.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: TMDB Name → Id Resolution

### Overview

Turn people/keyword strings into TMDB ids and let the discover query filter by
them.

### Changes Required:

#### 1. Person / keyword search helpers

**File**: `src/lib/tmdb-search.ts` (new)

**Intent**: Resolve a name to its top TMDB id via `/search/person` and a keyword
string to its top id via `/search/keyword`, reusing the `request()` seam and the
graceful-degradation (`[]`/`null` on bad status, never throw) convention.

**Contract**: Export
`searchPerson(client: TmdbClient, name: string): Promise<number | null>` and
`searchKeyword(client: TmdbClient, keyword: string): Promise<number | null>`
(each takes the first `results[].id`, returns `null` on no-match/non-ok). Add a
batch helper `resolveEntities(client, { people, keywords })` returning
`{ castIds: number[]; keywordIds: number[] }` that resolves in parallel
(`Promise.all`), drops `null`s, and respects the caps already applied upstream.
Accept an optional `AbortSignal` so resolution shares the retrieval budget.

#### 2. Discover query: cast + keyword filters

**File**: `src/lib/tmdb-discover.ts`

**Intent**: Let `/discover/movie` filter by cast and keyword ids (the only way
TMDB accepts these), threaded through the candidate fetch.

**Contract**: Add `castIds?: number[]` and `keywordIds?: number[]` to
`DiscoverParams` (`:31-42`) and `FetchCandidatesOptions` (`:104-112`). In the
query builder (`:77-93`) set `with_cast = castIds.join("|")` and
`with_keywords = keywordIds.join("|")` only when non-empty (OR-union, consistent
with `with_genres`). Pass both through `fetchCandidates` → `discoverMovies`
(`:139-148`). Runtime stays the only hard filter.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Type checking passes: `npx astro check`

#### Manual Verification:

- [ ] On `astro dev`, `searchPerson("Adam Sandler")` returns his TMDB person id and `searchKeyword` returns an id for a common keyword; both return `null` for gibberish.
- [ ] A `fetchCandidates` call with `castIds` set returns a visibly different pool than without it.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Pipeline Wiring + Relaxation Ladder + Copy Fix

### Overview

Assemble the primitives at the seam, thread the note end-to-end, and guarantee
three picks via the relaxation ladder; fix the stale config-status copy.

### Changes Required:

#### 1. Thread the note into the pipeline

**File**: `src/lib/recommend-run.ts`, `src/pages/api/recommendations.ts`

**Intent**: Carry the persisted note from the endpoint into `recommendRun` so the
seam can use it.

**Contract**: Add `note: string | null` to `RecommendRunSession`
(`recommend-run.ts:11-16`); set it from `recommendations.ts:112-119`
(`note` is already computed at `:76-77`). No schema/migration change.

#### 2. AI step + id merge at the seam

**File**: `src/lib/recommend-run.ts`

**Intent**: Between the genre union (`:55`) and `fetchCandidates` (`:58`), when a
note is present and AI is configured, parse it and resolve ids, then feed them
into discover. Everything fails soft to today's genre-only behavior.

**Contract**: Behind `if (session.note)` and `createAiClient()` non-null, call
`parseNote` then `resolveEntities` (sharing/under the retrieval budget). Build the
augmented discover inputs: `with_genres` = existing `discoverGenreIds` ∪ AI genre
ids; `castIds`; `keywordIds`. If AI is unconfigured, note empty, or parse returns
empty, the AI-derived inputs are empty and discover is exactly today's call.
Preserve the existing fail-soft branches (`:46-49`, `:64-69`) unchanged.

#### 3. Relaxation ladder (OQ-2)

**File**: `src/lib/recommend-run.ts`

**Intent**: When stacked AI filters drain the candidate pool below three, relax
them in a fixed order until the pool recovers, ending at today's genre-only
baseline — the guarantee that keeps "always three picks" intact.

**Contract**: After the first augmented `fetchCandidates`, if the **post-scoring**
pick count would fall below three (or the candidate pool is too thin to yield
three), re-query discover dropping filters in order: **(1) keywords → (2) cast →
(3) AI-genres → (4) genre-only baseline** (= today's `discoverGenreIds` only).
Stop at the first attempt that yields ≥ 3 candidates; the final baseline attempt
is exactly the current call so behavior is never worse than today. Implement as a
small ordered list of param-sets iterated until the pool is sufficient; cap total
attempts at the ladder length. Excluded genres remain a scoring penalty (not a
discover filter), unchanged.

#### 4. Config-status copy fix

**File**: `src/lib/config-status.ts`

**Intent**: The AI degradation message names a removed feature ("uzasadnienia
AI" / justifications). Reword to describe note parsing.

**Contract**: Update the `message` at `:29` to reference note analysis (e.g.
"OpenRouter nie jest skonfigurowany — analiza notatki AI jest wyłączona;
rekomendacje korzystają tylko z gatunków."). Copy only; no logic change.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Type checking passes: `npx astro check`

#### Manual Verification:

- [ ] On `astro dev`, a session with note "something dumb, maybe with Adam Sandler" returns three picks whose pool reflects the note (Sandler/comedy lean).
- [ ] An empty note returns three picks identical in shape to pre-S-04 genre-only behavior.
- [ ] Forcing AI to fail (bad key / forced timeout) still returns three picks via genre-only fallback — no 500.
- [ ] A deliberately over-narrow note (rare actor + niche keyword + runtime cap) still returns three picks via the relaxation ladder.
- [ ] End-to-end run completes within the `< 10 s` budget.
- [ ] The AI config-status message on the relevant page reads as note-analysis copy, not "justifications."

**Implementation Note**: This is the final phase; confirm all manual checks
before closing the change.

---

## Testing Strategy

No JS test framework exists yet (Vitest arrives in the separate
`testing-always-three-picks-core` rollout). This change is verified by:

### Automated (per phase):

- `npm run lint`
- `npx astro check` (typecheck)

### Manual Testing Steps (on `astro dev` — real workerd):

1. Submit a session with note "something dumb, maybe with Adam Sandler" → three picks, Sandler/comedy-leaning pool.
2. Submit with an empty note → three picks, same as pre-S-04 genre-only.
3. Submit with OpenRouter key removed / forced AI timeout → three picks via genre-only fallback, no 500.
4. Submit an over-narrow note (rare actor + niche keyword + tight runtime) → three picks via relaxation ladder.
5. Confirm each run completes within `< 10 s`.

## Performance Considerations

- AI is on the `< 10 s` critical path for the first time. Dedicated ~2.5 s AI
  AbortController, separate from TMDB's ~8 s budget.
- Subrequest budget: worst case `1 AI + 2 person + 3 keyword + 3 discover` per
  attempt, plus up to a few relaxation re-queries — comfortably under the
  50-subrequest free cap. Entity caps and "stop at first ≥ 3" bound it.

## Migration Notes

None. `movie_night_sessions.note` already exists; no schema change.

## References

- Research: `context/changes/ai-note-understanding/research.md`
- Change identity: `context/changes/ai-note-understanding/change.md`
- AI seam: `src/lib/recommend-run.ts:55`
- OpenRouter structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- Prior: `context/archive/2026-06-02-provision-external-apis/plan.md` (OpenRouter, `AI_MODEL` override), `context/archive/2026-06-10-one-shot-recommend/plan.md` (pipeline extraction, Risk #1/#2)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: AI Extraction Primitive

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 05cf505
- [x] 1.2 Type checking passes: `npx astro check` — 05cf505

#### Manual

- [x] 1.3 `pingAi()` still returns `true` against a configured key — 05cf505
- [x] 1.4 `extract()` returns a typed object for a sample note and `null` (not a throw) on forced timeout — 05cf505

### Phase 2: Note → Params Extractor

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 3d87bad
- [x] 2.2 Type checking passes: `npx astro check` — 3d87bad

#### Manual

- [x] 2.3 `parseNote` for the Sandler note returns comedy genre ids + `["Adam Sandler"]` within budget — 3d87bad
- [x] 2.4 Empty/garbage note and AI timeout return the empty result; long note is truncated before the call — 3d87bad

### Phase 3: TMDB Name → Id Resolution

#### Automated

- [x] 3.1 Linting passes: `npm run lint` — 5173397
- [x] 3.2 Type checking passes: `npx astro check` — 5173397

#### Manual

- [x] 3.3 `searchPerson` / `searchKeyword` resolve real names and return `null` for gibberish — 5173397
- [x] 3.4 `fetchCandidates` with `castIds` returns a visibly different pool — 5173397

### Phase 4: Pipeline Wiring + Relaxation Ladder + Copy Fix

#### Automated

- [x] 4.1 Linting passes: `npm run lint`
- [x] 4.2 Type checking passes: `npx astro check`

#### Manual

- [x] 4.3 Sandler note returns three picks with a note-reflecting pool
- [x] 4.4 Empty note returns three picks identical to pre-S-04 genre-only
- [x] 4.5 Forced AI failure returns three picks via genre-only fallback, no 500
- [x] 4.6 Over-narrow note returns three picks via the relaxation ladder
- [x] 4.7 End-to-end run completes within `< 10 s`
- [x] 4.8 AI config-status message reads as note-analysis copy
