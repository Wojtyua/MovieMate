# Graceful Degradation at the External Edge — Implementation Plan

## Overview

Test-plan Phase 2 / Risk #2. Prove — with integration tests at the `recommendRun`
library boundary — that an external-edge failure (TMDB or OpenRouter) **degrades
gracefully** instead of erroring out: an AI failure falls back to genre-only
retrieval and still returns three picks; a TMDB failure returns a clean
`{ ok:false }` (no throw, no 500). The behavior already exists in the code
(research verdict); this phase _characterizes_ it and locks it against
regression. We mock the network edge by **extending Phase 1's `fetch` stub**
(not MSW — see "What We're NOT Doing") and reconcile the frozen test plan to
match that decision.

## Current State Analysis

- **The degradation behavior is already implemented and robust.** Every external
  edge returns a value on failure, never throws:
  - TMDB discover: non-ok → `[]` (`tmdb-discover.ts:107-108`); `fetchCandidates`
    wraps the page loop in try/catch and returns what it gathered (`:190-191`).
  - TMDB search: all failures → `null`, filtered out (`tmdb-search.ts:29-39,75-76`).
  - OpenRouter `extract`: non-ok / abort / malformed → `null` (`ai.ts:92-105`);
    `createAiClient()` → `null` when the key is absent (`ai.ts:44-46`).
  - `parseNote` fails soft to `EMPTY` (`note-parse.ts:50-53,70-72`).
- **`recommendRun` orchestration** (`recommend-run.ts`):
  - AI invoked only when `session.note` is truthy _and_ `createAiClient()` is
    non-null (`:78-86`); failure leaves `aiGenreIds/people/keywords = []`.
  - Relaxation ladder (`:126-147`) drops filters keywords→cast→AI-genres→
    genre-only; `dedupeAttempts` (`:214-227`) collapses the rungs to a **single
    genre-only query** when AI added nothing. Entity resolution only runs when
    `people.length>0 || keywords.length>0` (`:112`).
  - Degradation returns: catch around resolution+ladder → `{ ok:false, "Could
not reach TMDB, try again" }` (`:148-149`); empty pool → same (`:153-154`);
    success → `{ ok:true, recommendationId, redirectTo }` (`:198`).
  - Two AbortController budgets exist: 8s shared TMDB (`:102-105`) + 2.5s
    separate AI (`ai.ts:72-75`).
- **The HTTP route is a 302-redirect form endpoint** (`recommendations.ts:142-146`),
  not JSON — "no 500" maps to "302 with error message". The `ok` contract is only
  observable at the `recommendRun` boundary, which is where Phase 1 already tests.
- **The Phase 1 seam to extend** (`recommend-run.test.ts` + `recommend-run-doubles.ts`):
  global `fetch` stubbed via `makeFetchStub` (keyed on `page`), `astro:env/server`
  mocked file-scoped, hand-rolled fake Supabase capturing `insertedPickRows`.
  Its env shim pins `OPENROUTER_API_KEY: ""`, so the AI path never fires there.
- **MSW is genuinely absent**: not in `package.json`, no `setupFiles` in
  `vitest.config.ts` (`environment: "node"` only).

## Desired End State

Two new integration test files at the `recommendRun` boundary prove Risk #2's two
asymmetric outcomes across the canonical failure matrix, all green and fast (no
real timers, no network). The shared test double gains a URL-routing failure-
injecting `fetch` stub. The test plan no longer claims MSW arrives in Phase 2;
§6.2/§6.6 carry the fetch-stub degradation recipe. Verify:

- `npm run test:run` passes, including the new degradation suites.
- A deliberate break (turn a degrade branch into a throw / `ok:true`) turns a
  degradation test red — proving the tests catch the regression, not just 200s.
- `npm run typecheck` and `npm run lint` pass.

### Key Discoveries:

- All three edges route through global `fetch`: `api.themoviedb.org/3/discover/movie`,
  `/search/person|keyword`, `openrouter.ai/api/v1/chat/completions` — so one stub
  can route by URL substring (`tmdb.ts:25`, `tmdb-search.ts:30`, `ai.ts:77`).
- `vi.mock("astro:env/server")` is a hoisted static object — **the key cannot be
  varied within one file**. AI-fetch-failure cases need a file with the key
  truthy; the unconfigured case needs a separate file with the key `""`.
- The genre-only fallback is _provable_, not just inferable: on AI failure no
  `/search` call fires and the discover query carries `with_genres` but no
  `with_cast`/`with_keywords` (`recommend-run.ts:112`, `tmdb-discover.ts:90-96`).
- "Simulate the consequence" timeout strategy: a stub that **throws** reproduces
  the exact downstream branch a real abort/timeout hits (`fetchCandidates` catch →
  `[]`; `extract` catch → `null`) — deterministic and instant.

## What We're NOT Doing

- **Not adopting MSW.** The existing `fetch` stub gives the same signal at lower
  cost (cost×signal, test-plan §1). This deviates from the frozen plan, so Phase 3
  updates §3/§4/§6.2 to record the decision rather than leaving a dangling "MSW
  arrives in Phase 2" claim.
- **No production code changes.** The degradation behavior is already correct; we
  characterize it. No test seams (e.g. injectable budgets) added to shipping code.
- **No HTTP/endpoint-level test.** We assert at the `recommendRun` boundary; the
  route only maps result→redirect, and a 500 would require `recommendRun` to throw
  — which these tests prove it does not. (Documented, not tested.)
- **No real-clock timeout assertion.** We prove the degrade _behavior_, not that
  the abort fires at exactly 8s/2.5s (that budget value is an observability
  concern, test-plan §2).
- **No exact-score assertions** (test-plan §7) — count/role/distinct/shape only.
- **No duo×solo cross-product.** The edge behavior is orthogonal to cardinality;
  solo sessions suffice (duo shape is Phase 1 / Risk #5 territory).
- **No TMDB-unconfigured (missing-token) test.** That is a config-state guard
  (`recommend-run.ts:59-60`), not the "fails or times out" of Risk #2; out of scope.

## Implementation Approach

Extend the Phase 1 test double with a richer `fetch` stub that (a) routes by URL
to the three edges, (b) injects a per-edge failure mode, and (c) records every
requested URL so tests can assert _which rung_ ran. Write the degradation suite as
two files split purely by the static env shim they need (AI key truthy vs empty).
Drive each assertion from the PRD/research oracle (genre-only fallback, three
picks, clean `ok:false`), never from re-reading the implementation. Finish by
reconciling the test plan so the strategy document stays truthful.

## Critical Implementation Details

- **Env shim is static per file.** `vi.mock("astro:env/server", () => ({...}))` is
  hoisted and returns a fixed object; named imports (`OPENROUTER_API_KEY` in
  `ai.ts`, `TMDB_READ_ACCESS_TOKEN` in `tmdb.ts`) bind at load. Do **not** try to
  mutate it mid-file — split by file instead. `ai.ts` reads `OPENROUTER_API_KEY`
  and `AI_MODEL` at module load, so the shim must export both even when unused.
- **Throw-to-simulate-timeout is sound** because `fetchCandidates` (`:190`) and
  `extract` (`:103`) both catch _any_ error identically to an abort. A thrown
  `TypeError`/`DOMException` exercises the same degrade branch without fake timers.
- **AI path requires three conditions to fire**: `session.note` truthy +
  `OPENROUTER_API_KEY` truthy + the openrouter `fetch` resolving. Asserting the
  openrouter URL was requested confirms the AI path was _attempted then degraded_,
  distinguishing it from "AI skipped because note was null".

## Phase 1: Extend the network test double

### Overview

Add a URL-routing, failure-injecting `fetch` stub builder (with request capture)
to the shared doubles module. Phase 1's `makeFetchStub` stays as-is for backward
compatibility; the new builder is additive.

### Changes Required:

#### 1. Network stub builder + request log

**File**: `src/lib/__fixtures__/recommend-run-doubles.ts`

**Intent**: Provide a single `fetch` stub that the degradation tests configure
per-edge (TMDB discover, TMDB search, OpenRouter) with either healthy data or a
failure mode, and that records every requested URL so a test can prove the
genre-only rung ran (no `/search`, no `with_cast`). Reuse `makeDiscoverMovie` and
the existing `createFakeSupabase`/`makeDiscoverMovie` exports unchanged.

**Contract**: New exported factory plus a small failure-mode union. Routes on
`url.includes("openrouter.ai")` → AI, `url.includes("/search/")` → search,
`url.includes("/discover/movie")` → discover (page-keyed). Each route's failure
modes map to: `non-ok` → `{ ok:false, status }`; `throw` → the stub throws (models
network error / abort / timeout consequence); `malformed` → `{ ok:true }` whose
`.json()` rejects (or yields a shape the parser rejects). The returned object also
exposes the recorded requests. Signature contract the test files depend on:

```ts
export type EdgeFailure = { kind: "non-ok"; status?: number } | { kind: "throw" } | { kind: "malformed" };

export function makeNetworkStub(config: {
  // healthy discover data keyed by page, OR a failure applied to every discover page
  discover: Record<number, Partial<TmdbMovie>[]> | EdgeFailure;
  // resolved id for any /search/* call, OR a failure (default: resolves to a stable id)
  search?: number | EdgeFailure;
  // extraction object the openrouter call returns (wrapped as choices[0].message.content),
  // OR a failure (default: not configured — only set when the AI path is exercised)
  openrouter?: { genres: string[]; people: string[]; keywords: string[] } | EdgeFailure;
}): { fetch: ReturnType<typeof vi.fn>; requests: string[] };
```

The OpenRouter healthy branch must wrap the extraction as
`{ choices: [{ message: { content: JSON.stringify(extraction) } }] }` so `extract`
(`ai.ts:95-102`) parses it. `requests` is the ordered list of requested URLs.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Existing Phase 1 suite still green (no regression to `makeFetchStub`): `npm run test:run`

#### Manual Verification:

- The builder's three failure modes and request log read clearly enough to serve
  as the §6.2 cookbook reference.

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Degradation test suite

### Overview

Two integration files at the `recommendRun` boundary, split by the static env
shim. Assert Risk #2's two asymmetric outcomes across the canonical failure
matrix, then verify by deliberate break.

### Changes Required:

#### 1. Network-edge failure suite (AI key truthy)

**File**: `src/lib/recommend-run.degradation.test.ts` (new)

**Intent**: Prove that (a) a failing TMDB edge yields a clean `ok:false` with
nothing persisted, and (b) a failing OpenRouter edge degrades to genre-only and
still persists three picks — with positive proof the genre-only rung ran.

**Contract**: File-scoped `vi.mock("astro:env/server", () => ({
TMDB_READ_ACCESS_TOKEN: "test-token", OPENROUTER_API_KEY: "test-token", AI_MODEL:
"" }))`. `afterEach(() => vi.unstubAllGlobals())`. Solo session helper (mirrors
Phase 1) with `preferred_genre_ids: [28]`. Three test groups:

- **TMDB discover edge → `ok:false`** (`note: null`, so no AI). Parameterize via
  `it.each` over `[{non-ok 503}, {throw}, {malformed}]`; each sets
  `makeNetworkStub({ discover: <failure> })`. Assert `result` equals
  `{ ok:false, message: "Could not reach TMDB, try again" }` and
  `insertedPickRows` has length 0.
- **TMDB search edge → genre-only + 3 picks** (`note` present, AI returns
  `people:["Some Actor"]`, `genres:[]`, `keywords:[]`; `search: {kind:"throw"}`;
  `discover` healthy ≥3). Assert `ok:true`, 3 distinct role-labeled picks, and
  that the discover requests carry no `with_cast` (search failed → cast empty →
  genre-only).
- **OpenRouter edge → genre-only + 3 picks** (`note` present, `discover` healthy
  ≥3). Parameterize over `[{non-ok}, {throw}, {malformed}]` for `openrouter`.
  Assert `ok:true`, exactly 3 distinct role-labeled picks; assert `requests`
  includes an `openrouter.ai` URL (AI was attempted), includes **no** `/search/`
  URL, and the `/discover/movie` requests carry `with_genres` but neither
  `with_cast` nor `with_keywords` (proves the genre-only rung, not an AI success).

Oracle is the PRD/research (genre-only fallback, three picks, clean `ok:false`),
not `recommend-run.ts`. Assert counts/roles/distinct ids/query shape — never
`pick.score` (§7).

#### 2. Unconfigured-OpenRouter suite (AI key empty)

**File**: `src/lib/recommend-run.unconfigured.test.ts` (new)

**Intent**: Prove that with a note present but OpenRouter unconfigured,
`createAiClient()` returns null and retrieval still degrades to genre-only with
three picks — the config-state half of "OpenRouter fails".

**Contract**: Separate file because the env shim must set `OPENROUTER_API_KEY: ""`
(cannot coexist with the truthy shim in file #1). `discover` healthy ≥3, `note`
present. Assert `ok:true`, 3 picks, and `requests` includes **no** `openrouter.ai`
URL (the client was never built) and no `/search/` URL.

### Success Criteria:

#### Automated Verification:

- New suites pass: `npm run test:run`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Post-edit hook scoped suite passes on each new `.ts` (it is under
  `src/lib/recommend`-adjacent risk area — runs `vitest related`).

#### Manual Verification:

- **Deliberate break**: temporarily change `recommend-run.ts:148-149` (or `:154`)
  to `throw` instead of returning `ok:false`, run the suite, confirm a TMDB-edge
  test goes red; revert. Then change the catch so an AI failure surfaces (e.g.
  remove the `if (ai)` guard so a null client throws) and confirm an OpenRouter
  test goes red; revert. This proves the tests catch the regression, not just 200s.
- The genre-only-signature assertions fail if the discover query is allowed to
  carry `with_cast`/`with_keywords` — confirm by spot-injecting a non-empty
  `castIds` and seeing red, then revert.

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation (the deliberate-break step is
manual) before proceeding.

---

## Phase 3: Reconcile the test plan

### Overview

Update the frozen test plan to reflect the no-MSW decision and fill the cookbook,
keeping the strategy document truthful (per the lessons.md "reconcile test-plan
after a rollout phase" rule).

### Changes Required:

#### 1. Phased rollout + stack rows

**File**: `context/foundation/test-plan.md`

**Intent**: Remove the dangling MSW mandate now that Phase 2 ships without it.

**Contract**: §3 row 2 Test types → `integration + fetch-stub (network edge)`;
Status → `complete` once implemented; Change folder → the change path (or its
archived path after `/10x-archive`). §4 "API mocking / MSW" row → mark
`not adopted — fetch-stub covers the edge (cost×signal); checked: 2026-06-13`
(keep the row as a record of the decision rather than deleting it). §2 Risk #2
"Likely cheapest layer" / §1 references to MSW left intact only where they read
as examples, not mandates — adjust the Risk-#2 row's layer note to
`integration + fetch-stub`.

#### 2. Cookbook recipe (§6.2 / §6.6)

**File**: `context/foundation/test-plan.md`

**Intent**: Give the next contributor the degradation recipe and capture the
phase's lesson.

**Contract**: Fill §6.2's pending "Graceful-degradation + MSW recipes still
pending" note with the actual recipe: the `makeNetworkStub` routing + failure
modes, the two-files-by-env-shim split, the throw-to-simulate-timeout technique,
and the genre-only-signature assertion (no `/search`, no `with_cast`). Add a §6.6
"Phase 2" note: behavior already existed (characterization, not construction); the
TMDB-vs-AI asymmetry (source vs augmentation); MSW deliberately not adopted.

#### 3. Change identity

**File**: `context/changes/graceful-degradation-at-the-external-edge/change.md`

**Intent**: Stamp the change as planned/in-progress per the skill lifecycle.

**Contract**: `status: planned` (set by this plan write), `updated: 2026-06-13`.

### Success Criteria:

#### Automated Verification:

- Markdown lints/formats clean via pre-commit lint-staged: `npx lint-staged` (or
  prettier on the edited `.md`).
- No broken intra-doc references (the §3 change-folder path resolves).

#### Manual Verification:

- §3/§4 no longer imply MSW arrives in Phase 2; §6.2/§6.6 read as a usable recipe.
- A reader unfamiliar with the change can understand why MSW was skipped.

**Implementation Note**: Final phase — after this, the change is ready for
`/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- N/A — this phase is integration-only at the `recommendRun` boundary. The pure
  `recommend()` shape layer is Phase 1.

### Integration Tests:

- TMDB discover edge: non-ok / throw / malformed → `{ ok:false, "Could not reach
TMDB, try again" }`, nothing persisted.
- TMDB search edge: search failure with AI-supplied people → genre-only, 3 picks,
  no `with_cast`.
- OpenRouter edge: non-ok / throw / malformed → genre-only, 3 picks, AI attempted
  (openrouter URL requested) but no `/search` and no `with_cast`/`with_keywords`.
- OpenRouter unconfigured (key `""`): note present → genre-only, 3 picks, no
  openrouter URL requested.

### Manual Testing Steps:

1. Run `npm run test:run` — all suites green.
2. Deliberate break each degrade branch (see Phase 2 Manual Verification), confirm
   red, revert.
3. `npm run typecheck` and `npm run lint` clean.

## Performance Considerations

The suite must stay fast: no real timers, no real network. The throw-to-simulate
strategy keeps every timeout case instant. No `page.waitForTimeout`-style waits.

## Migration Notes

None — additive test files + a fixture extension + doc edits. No production code,
schema, or config changes.

## References

- Research: `context/changes/graceful-degradation-at-the-external-edge/research.md`
- Phase 1 seam: `src/lib/recommend-run.test.ts`, `src/lib/__fixtures__/recommend-run-doubles.ts`
- Degradation source: `src/lib/recommend-run.ts:78-155`, `src/lib/tmdb-discover.ts:106-198`,
  `src/lib/tmdb-search.ts:29-78`, `src/lib/ai.ts:44-111`, `src/lib/note-parse.ts:50-91`
- Test plan: `context/foundation/test-plan.md` §2 (Risk #2), §3 (Phase 2), §4, §6.2, §6.6
- Lessons: `context/foundation/lessons.md` (reconcile test-plan §3 after a rollout phase)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extend the network test double

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — fca29cf
- [x] 1.2 Lint passes: `npm run lint` — fca29cf
- [x] 1.3 Existing Phase 1 suite still green: `npm run test:run` — fca29cf

#### Manual

- [x] 1.4 Builder failure modes + request log read clearly enough for the §6.2 cookbook

### Phase 2: Degradation test suite

#### Automated

- [x] 2.1 New suites pass: `npm run test:run`
- [x] 2.2 Typecheck passes: `npm run typecheck`
- [x] 2.3 Lint passes: `npm run lint`
- [x] 2.4 Post-edit hook scoped suite passes on each new `.ts`

#### Manual

- [x] 2.5 Deliberate break of the TMDB `ok:false` branch turns a TMDB test red; reverted
- [x] 2.6 Deliberate break of the AI degrade guard turns an OpenRouter test red; reverted
- [x] 2.7 Injecting non-empty `castIds` turns the genre-only-signature assertion red; reverted

### Phase 3: Reconcile the test plan

#### Automated

- [ ] 3.1 Markdown lints/formats clean (`npx lint-staged` / prettier on edited `.md`)
- [ ] 3.2 The §3 change-folder path reference resolves

#### Manual

- [ ] 3.3 §3/§4 no longer imply MSW arrives in Phase 2; §6.2/§6.6 read as a usable recipe
- [ ] 3.4 A reader can understand why MSW was skipped
