---
date: 2026-06-13T15:16:32+0200
researcher: Wojciech Derlikiewicz
git_commit: baca733935ab0449053ec7747587504bb7e178ac
branch: main
repository: 10xMovie
topic: "Graceful degradation at the external edge (TMDB/OpenRouter failure → genre-only fallback, still three picks, no 500)"
tags: [research, codebase, recommend-run, tmdb, openrouter, msw, degradation, phase-2]
status: complete
last_updated: 2026-06-13
last_updated_by: Wojciech Derlikiewicz
---

# Research: Graceful degradation at the external edge

**Date**: 2026-06-13T15:16:32+0200
**Researcher**: Wojciech Derlikiewicz
**Git Commit**: baca733935ab0449053ec7747587504bb7e178ac
**Branch**: main
**Repository**: 10xMovie

## Research Question

Test-plan Phase 2 / Risk #2: when **TMDB or OpenRouter fails or times out**, the
recommendations request must **degrade to genre-only retrieval and still return
three picks within < 10 s — not error out (no 500)**. The test plan mandates an
**integration + network-edge mock (MSW)** layer. Ground the network edge
(TMDB / OpenRouter) and the timeout + error path so Phase 2 can be planned.

## Summary

**The graceful-degradation behavior already exists in the code and is robust —
this phase tests an _existing_ behavior, it does not build it.** Every external
edge in this codebase follows one house rule: **provider failure is a return
value (`null` / `[]` / `{ ok:false }`), never a thrown exception.** Concretely:

- **OpenRouter (AI) failure → genuine genre-only degradation, still 3 picks.**
  A slow/erroring/unconfigured AI leaves the note-derived signal empty, the
  relaxation ladder collapses to its genre-only baseline rung, and retrieval is
  "byte-for-byte today's genre-only retrieval." This is the headline scenario
  and it works.
- **TMDB failure → clean `{ ok:false, "Could not reach TMDB, try again" }`, no 500.** But it _cannot_ return 3 picks — TMDB **is** the candidate source.
  "Still three picks" only applies when TMDB is healthy; a TMDB outage correctly
  degrades to a graceful error, not to picks. **Phase 2 must split Risk #2 into
  these two asymmetric sub-cases** rather than asserting "3 picks even when TMDB
  is down" (which is physically impossible — no source).
- **The < 10 s budget is engineered, not absent.** A single 8 s `AbortController`
  spans _all_ TMDB work (entity resolution + every ladder rung); the AI call
  keeps its own separate 2.5 s budget so a slow model can't starve retrieval.
- **The HTTP surface is a 302-redirect form endpoint, not a JSON API.** So "not a
  500" literally means "302 to `/sessions?error=…`". The `ok:true`/`ok:false`
  contract lives at the `recommendRun` _library_ boundary — that is where Phase 2
  should assert, exactly as the Phase 1 integration test already does.

**Stack gap:** MSW is **not installed** (absent from `package.json`; `vitest.config.ts`
has **no `setupFiles`**). Phase 2 bootstraps it. Open design question below on
whether MSW earns its keep over the existing `fetch` stub — leaning yes, because
failure injection (500 / timeout / malformed-JSON) and two distinct providers
(TMDB discover+search, OpenRouter) are far cleaner as per-endpoint handlers.

## Detailed Findings

### A. The relaxation ladder & the genre-only baseline (`src/lib/recommend-run.ts`)

The ladder is the resilience backbone. Four rungs, richest first, stop at the
first rung yielding ≥ 3 candidates (`recommend-run.ts:118–147`):

```
Rung 1: { genreIds: augmentedGenreIds, castIds, keywordIds }      // AI + cast + keywords
Rung 2: { genreIds: augmentedGenreIds, castIds, keywordIds: [] }  // drop keywords
Rung 3: { genreIds: augmentedGenreIds, castIds: [], keywordIds:[] }// drop cast
Rung 4: { genreIds: discoverGenreIds, castIds: [], keywordIds:[] } // GENRE-ONLY BASELINE
```

- `augmentedGenreIds = [...new Set([...discoverGenreIds, ...aiGenreIds])]`. When
  the AI path yields nothing, `aiGenreIds = []`, so all four rungs are identical
  and `dedupeAttempts()` (`recommend-run.ts:214–227`) collapses them to **one
  genre-only query**. This is exactly the degradation target.
- `discoverGenreIds` = the user's explicit preferred genres (+ optional second
  viewer). The genre-only rung is **always** the final fallback and always runs
  if earlier rungs underfill.

### B. TMDB network edge & error handling

- **Raw fetch seam:** `tmdb.ts:25` — `fetch(\`${TMDB_BASE_URL}${path}\`, …)`.
`createTmdbClient()`returns`null`if`TMDB_READ_ACCESS_TOKEN` is unset
(`tmdb.ts:15–17`); `recommendRun`short-circuits to`{ ok:false, "Recommendations unavailable: TMDB is not configured" }`
(`recommend-run.ts:60`).
- **Non-ok HTTP → `[]` (no throw):** `discoverMovies` returns `[]` on
  `!response.ok` (`tmdb-discover.ts:107–108`); `response.json()` can still throw
  on malformed body (`tmdb-discover.ts:110`).
- **`fetchCandidates` never throws** (`tmdb-discover.ts:148–198`): its own
  `try/catch` swallows network/abort errors and **returns what it gathered so
  far** (`tmdb-discover.ts:190–191`), always a `TmdbMovie[]` (possibly empty).
- **Search (entity resolution) fails soft to `null`:** `searchTopId`
  (`tmdb-search.ts:29–39`) catches everything, returns `null`; `resolveEntities`
  filters nulls (`tmdb-search.ts:75–76`) — partial cast/keyword resolution
  degrades cleanly.

### C. OpenRouter / AI edge (`src/lib/ai.ts`, `src/lib/note-parse.ts`)

- **Fetch seam + own timeout:** `ai.ts:77–91` posts to
  `https://openrouter.ai/api/v1/chat/completions` with an AbortController firing
  at **2500 ms** (`ai.ts:72–75`, default `ai.ts:13`).
- **Never throws — returns `null`** on missing key, non-ok status, abort/timeout,
  or malformed JSON (`ai.ts:92–105`). `createAiClient()` returns `null` when
  `OPENROUTER_API_KEY` is absent (`ai.ts:44–46`).
- **Empty note skips AI entirely** (deterministic, zero network):
  `note-parse.ts:51–54` early-returns `EMPTY = { genreIds:[], people:[], keywords:[] }`.
  A **present** note triggers `ai.extract(...)` (`note-parse.ts:69`); on `null`
  it returns `EMPTY` (`note-parse.ts:70–72`).
- **Wiring into the pipeline:** AI is only invoked when `session.note` is truthy
  _and_ `createAiClient()` is non-null (`recommend-run.ts:78–86`). There is **no
  try/catch around the AI call** because it cannot throw — failure simply leaves
  `aiGenreIds/people/keywords` empty, collapsing the ladder to genre-only. The
  intent comment is explicit (`recommend-run.ts:73–77`): "unconfigured/slow/
  erroring AI — leaves the discover call byte-for-byte today's genre-only
  retrieval."

### D. Degradation / error boundary & result contract (`recommend-run.ts`)

Result type (`recommend-run.ts:33–35`):
`{ ok:true; recommendationId; redirectTo } | { ok:false; message }`.

The full ok:false surface (all return as a **value**, never a throw):

| Line            | Condition                                       | Message                                               |
| --------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `:60`           | TMDB unconfigured (no token)                    | `Recommendations unavailable: TMDB is not configured` |
| `:148–149`      | **catch** around entity-resolution + ladder     | `Could not reach TMDB, try again`                     |
| `:154`          | ladder finished but **zero** candidates         | `Could not reach TMDB, try again`                     |
| `:166`          | candidates exist but scoring yields no matches  | `No matching films — broaden your preferences`        |
| `:176` / `:195` | Supabase insert error (recommendations / picks) | DB error message                                      |
| `:198`          | success                                         | → `redirectTo: /sessions/{id}/recommendations`        |

- **< 10 s budget:** `RETRIEVAL_BUDGET_MS = 8000` (`:17`); one shared
  `AbortController` + `setTimeout(abort, 8000)` (`:102–105`) spans entity
  resolution **and** every ladder rung, cleared in `finally` (`:151`).
  `fetchCandidates` keeps its own 8 s ceiling and folds in the shared signal
  (`tmdb-discover.ts:140,151–164`). AI's 2.5 s budget is deliberately separate.
  _Caveat:_ no single wall-clock guard wraps the Supabase inserts (`:170–196`),
  so the < 10 s claim rests on the TMDB/AI budgets + fast DB writes.

### E. HTTP handler (`src/pages/api/recommendations.ts`)

- A **form POST → 302 redirect** endpoint, no JSON body, **no try/catch**.
  `const result = await recommendRun(...)` (`:142`); `if (!result.ok)` →
  `redirectError(context, "/sessions", result.message)` 302 (`:143–145`);
  success → `context.redirect(result.redirectTo)` (`:146`).
- **A 500 would only arise if `recommendRun` threw** — and it is written never to
  throw on dependency failure. So "no 500" is delivered by the library, not the
  route. At the HTTP level the degradation observable is a **302 to
  `/sessions?error=Could+not+reach+TMDB%2C+try+again`**.

### F. Codebase house style confirms the contract

- `src/pages/api/health/integrations.ts`: pings TMDB + AI concurrently
  (`:22`), reports per-provider `"ok"|"fail"`, and **always returns HTTP 200**
  (`:45`) — never 500s on a down provider (`pingTmdb`/`pingAi` catch all and
  return `false`: `tmdb.ts:40–45`, `ai.ts:124–129`). A separate probe, but same
  philosophy.
- `src/lib/config-status.ts:26–33`: AI message encodes the degradation contract
  verbatim — _"OpenRouter nie jest skonfigurowany — analiza notatki AI jest
  wyłączona; rekomendacje korzystają tylko z gatunków."_ TMDB's message frames it
  as a hard data-source dependency (`:21–25`).

### G. Phase 1 seam to reuse (the integration pattern Phase 2 extends)

Worked files: `src/lib/recommend-run.test.ts` + `src/lib/__fixtures__/recommend-run-doubles.ts`.

1. **`fetch` stub keyed on `page`:** `makeFetchStub(pagesByNumber)`
   (`recommend-run-doubles.ts:40–51`) parses `page` from the discover URL and
   returns `{ ok:true, status:200, json:()=>({ results }) }` per page —
   makes dedup-across-pages meaningful. Installed via
   `vi.stubGlobal("fetch", makeFetchStub({...}))`.
2. **`astro:env/server` shim, file-scoped:** `recommend-run.test.ts:9–13` —
   `vi.mock("astro:env/server", () => ({ TMDB_READ_ACCESS_TOKEN:"test-token",
OPENROUTER_API_KEY:"", AI_MODEL:"" }))`. The empty OpenRouter key is why the
   Phase 1 suite never hits the AI path.
3. **Hand-rolled fake `SupabaseClient`:** `createFakeSupabase(config)`
   (`recommend-run-doubles.ts:78–120`) covers the three calls (`watched.select.eq`,
   `recommendations.insert.select.single`, `recommendation_picks.insert`) and
   captures `insertedPickRows` for assertions.
4. **Assertions on _supply_, not scores:** persisted pick count, distinct
   `tmdb_movie_id` (`new Set(ids).size`), valid roles, watched-id absence, and the
   two faces of R1.

### H. MSW status — definitively absent

- **Not in `package.json`** (grep: no match). Present only transitively/historically
  in the lockfile.
- **`vitest.config.ts` has no `setupFiles`** — only `environment:"node"` + the
  `@/*` alias (`vitest.config.ts:14`). There is no `setupServer`, no
  `mockServiceWorker`, no `http.get/post` handler anywhere in `src/`/`tests/`.
- Matches test-plan §4 ("MSW — none yet — see §3 Phase 2") and §6.2
  ("Graceful-degradation + MSW recipes still pending").

## Code References

- `src/lib/recommend-run.ts:33–35` — `RecommendRunResult` discriminated union.
- `src/lib/recommend-run.ts:60` — TMDB-unconfigured short-circuit.
- `src/lib/recommend-run.ts:78–86` — AI invocation guard (note + client present).
- `src/lib/recommend-run.ts:102–105,151` — shared 8 s retrieval AbortController.
- `src/lib/recommend-run.ts:118–147` — relaxation ladder + dedupe + stop-at-≥3.
- `src/lib/recommend-run.ts:148–149,154,166` — the three degradation returns.
- `src/lib/recommend-run.ts:198` — success return + redirectTo.
- `src/lib/tmdb.ts:15–17,25` — client null-on-no-token; raw fetch edge.
- `src/lib/tmdb-discover.ts:106–110` — non-ok → `[]`; json() can throw.
- `src/lib/tmdb-discover.ts:148–198` — `fetchCandidates` never-throws + per-call budget.
- `src/lib/tmdb-search.ts:29–39,75–76` — search fail-soft to null; null filtering.
- `src/lib/ai.ts:44–46,72–75,92–105` — null-on-no-key; 2.5 s timeout; never-throw.
- `src/lib/note-parse.ts:51–54,69–72` — empty-note skip; AI-null → EMPTY.
- `src/pages/api/recommendations.ts:142–146` — recommendRun call → 302 redirect mapping.
- `src/pages/api/health/integrations.ts:22,45` — always-200 provider probe.
- `src/lib/config-status.ts:21–33` — degradation contract in user-facing copy.
- `src/lib/recommend-run.test.ts:9–13` + `src/lib/__fixtures__/recommend-run-doubles.ts:40–51,78–120` — the Phase 1 seam to extend.
- `vitest.config.ts:14` — `environment:"node"`, no `setupFiles`.

## Architecture Insights

- **One uniform degradation contract across all edges:** every external boundary
  returns a value on failure (`null`/`[]`/`{ok:false}`) and never throws. The
  recommend path's "no 500" is an _emergent property_ of this discipline plus the
  relaxation ladder, not a single guard. Tests should pin the contract at each
  edge and at the orchestrator boundary.
- **Two independent budgets, by design:** TMDB (8 s, shared across all rungs) and
  AI (2.5 s, isolated) — a slow model cannot starve retrieval. This is the
  testable shape of the < 10 s NFR.
- **Asymmetry is the crux of Risk #2:** AI is _augmentation_ (its loss degrades to
  genre-only with full picks); TMDB is the _source_ (its loss can only degrade to
  a graceful error). A Phase 2 plan that treats both as "still 3 picks" will
  write an unsatisfiable assertion for the TMDB case.
- **Assert at the library boundary, not HTTP.** The route is a 302-redirect form
  endpoint; the `ok:true/false` contract is observable only at `recommendRun`.

## Historical Context (from prior changes)

- `context/archive/2026-06-12-testing-always-three-picks-core/plan.md` — Phase 1
  explicitly **deferred to Phase 2**: "Multi-rung _progression_ … requires the
  note/AI path — that is Phase 2 (degradation) territory" and "**No
  `AiClient`/`parseNote` testing, no MSW.** Note parsing and real-network mocking
  are Phase 2." Phase 1 exercised only the single genre-only rung the no-note path
  produces.
- `context/archive/2026-06-12-testing-always-three-picks-core/research.md` —
  established the `fetch` + env-token + fake-Supabase seam (because `recommendRun`
  builds its own TMDB client and takes no stub arg).

## Related Research

- `context/archive/2026-06-12-testing-always-three-picks-core/research.md` (Phase 1 supply layer).
- `context/archive/2026-06-13-e2e-critical-path/` (Phase 4 — uses **real** TMDB by
  decision; mocking the external edge is _this_ phase, not the browser layer —
  test-plan §6.4 "Real vs mocked").

## Open Questions

1. **Does MSW earn its keep over the existing `fetch` stub?** The Phase 1 seam
   already stubs global `fetch`. MSW's value here is (a) ergonomic per-endpoint
   handlers for **two** providers (TMDB `/discover/movie` + `/search/*`,
   OpenRouter `/chat/completions`) and (b) clean failure injection (500/503,
   abort/timeout, malformed JSON) — exactly the degradation matrix. Leaning
   **adopt MSW** (test plan mandates it; it's the right tool for multi-endpoint
   failure injection), wiring `setupServer` via a new `vitest.config.ts`
   `setupFiles`. Plan should confirm MSW intercepts Node `fetch` in the
   `node` environment (MSW ≥ 2 does, via interceptors).
2. **How to inject a _timeout_ deterministically under MSW** so the 8 s / 2.5 s
   AbortControllers fire without making the suite slow? Likely an MSW handler that
   `await`s a delay longer than a **shortened test budget**, or asserting the
   abort path by resolving after the controller aborts. Plan must decide whether
   to make the budgets injectable (test seam) or use MSW `delay()` against the
   real constants (slower).
3. **Exact Risk #2 assertion split** — confirm with the plan:
   (a) OpenRouter down + healthy TMDB → `ok:true`, **3 picks**, genre-only rung
   used, no AI call effect; (b) TMDB down → `ok:false,"Could not reach TMDB, try
again"`, **nothing persisted**, within budget. Both "challenge 200 == success"
   (test-plan §2 Risk #2).
4. **AI-failure modes to cover:** unconfigured key (`createAiClient → null`),
   non-ok status, timeout/abort, malformed JSON — all four must collapse to the
   genre-only rung. Worth a parameterized matrix.
