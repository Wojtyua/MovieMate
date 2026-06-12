# "Always Three Picks" Core — Test Phase 1 Implementation Plan

## Overview

Stand up Vitest for the project and write the test-plan **§3 Phase 1** suite that
defends **Risk #1** (the pipeline drains below three picks with healthy
dependencies) and **Risk #5** (a malformed pick set on the solo↔duo branch) — at
the cheapest layer that gives a real signal. Two layers, per the cost×signal
strategy: **pure-layer unit tests** on `recommend()` for pick *shape* (≤3,
distinct, role-by-cardinality, wild-card genre ≠ safe), and a **supply-layer
integration test** on `recommendRun` for pool *supply* (dedup + watched-exclusion
+ the genre-only retrieval guarantee), with the network edge stubbed at `fetch`.

## Current State Analysis

- **No test tooling exists.** No `vitest.config.*`, no `test` npm script, no
  `*.test.ts`/`*.spec.ts` anywhere in `src/`. Vite 7 is pinned via `overrides`
  (package.json), so Vitest 3.x fits. tsconfig defines the `@/*` → `./src/*`
  alias that test files and source both rely on.
- **The "always three" guarantee lives in two layers** (research.md §Summary):
  - *Pure / shape* — `src/lib/recommend/roles.ts` `recommend()` (roles.ts:100-177)
    turns a pool of `N` distinct films into `min(N, 3)` distinct, role-labeled
    picks. It guarantees ≤3, distinctness, correct role-by-cardinality, and
    wild-card-genre-disjoint — but **never fabricates** a third pick from two.
  - *Retrieval / supply* — `src/lib/recommend-run.ts` (recommend-run.ts:118-167):
    the relaxation ladder widens the pool to ≥3 by dropping AI filters, stopping
    at the first rung with ≥3 candidates; the final rung is the genre-only
    baseline. Below three even at baseline, it proceeds with `<3` picks; it
    errors only at **zero** candidates / **zero** picks.
- **The oracle is fully grounded** (research.md §"The oracle"): solo middle role
  is `crowd_pleaser` and **never** `compromise`; duo middle is `compromise`;
  wild card differs from safe in genre; watched exclusion is a constant dedup
  filter that never relaxes. No STOP-AND-ASK gaps.
- **Seam asymmetry, verified in code:**
  - `fetchCandidates(client, opts)` (tmdb-discover.ts:148) takes an **injectable**
    `TmdbClient` and is pure-ish (returns `[]`, never throws).
  - But the *ladder* lives in `recommendRun`, which builds its **own** client via
    `createTmdbClient()` (recommend-run.ts:58) and makes its **own** Supabase
    calls (watched read recommend-run.ts:93; run + picks inserts
    recommend-run.ts:170-193). So the supply-layer test cannot pass a stub arg —
    it must stub the **network edge** (`fetch`) + env token + supply a **fake
    `SupabaseClient`**.
  - `createTmdbClient()` reads `TMDB_READ_ACCESS_TOKEN` from **`astro:env/server`**
    (tmdb.ts:1), a virtual Astro module Vitest cannot resolve by default.
- **The pure layer has zero `astro:*` runtime deps.** `roles.ts` imports only
  `type TmdbMovie` (type-only, erased) and the pure `scoring.ts`/`affinity.ts`
  chain. So unit tests run clean in a node environment with no Astro shimming.
- **With `note: null`, the ladder collapses to a single genre-only rung.** The AI
  client is only created when `session.note` is set (recommend-run.ts:78), and
  `dedupeAttempts` collapses the four rungs to one when `castIds`/`keywordIds`/
  `aiGenreIds` are empty (recommend-run.ts:126-131). Multi-rung *progression*
  ("stops at first ≥3, no over-relax") therefore requires the note/AI path —
  that is Phase 2 (degradation) territory, out of scope here.

## Desired End State

`npm run test` runs a green Vitest suite that, against **healthy stubbed
dependencies**:

- **Pure layer (unit):** proves `recommend()` produces a well-shaped pick set for
  solo and duo across typical and boundary pools — ≤3, all distinct ids, correct
  role-by-cardinality (solo never emits `compromise`), and wild card whose genre
  set is disjoint from safe's (with the Jaccard fallback when no disjoint
  candidate exists). Thin pools assert `min(N,3)` — 2 candidates → 2 picks, 1 → 1,
  0 → `[]` — documenting the no-fabrication contract.
- **Supply layer (integration):** proves `recommendRun` on the genre-only path
  returns exactly three persisted, role-labeled picks from a healthy ≥3 pool;
  dedups movies repeated across discover pages; and **excludes watched films**
  from the pool — without mocking any internal module, stubbing only `fetch` and
  the env token, with a hand-rolled fake Supabase client.

Verify: `npm run test` is green; `npm run lint` and `astro check` pass; the
test-plan §6.1/§6.2 cookbook entries are filled and §6.6 carries the Stryker
pointer.

### Key Discoveries:

- `recommend()` returns `min(N,3)`, no hard floor of three (roles.ts:97-98,
  106-108). The "two faces of R1" — *defect* (a healthy ≥3 pool drained) vs
  *physics* (the universe genuinely has <3 matches) — must be separated by tests.
- Pure layer needs **no** Astro/env shim (type-only imports). Integration layer
  **does** — `astro:env/server` must be resolved/mocked (tmdb.ts:1).
- The supply-layer ladder builds its own TMDB client + Supabase calls; the honest
  seam is `fetch` + env + a fake `SupabaseClient`, not an injected stub arg.
- Multi-rung relaxation progression requires the note/AI path → **Phase 2**, not
  here.

## What We're NOT Doing

- **No multi-rung relaxation-progression assertion** ("stops at the first ≥3
  rung, does not over-relax"). It requires a note → the AI/`AiClient` seam → that
  is Phase 2 (graceful degradation, R2). Phase 1 exercises only the single
  genre-only rung the no-note path produces.
- **No `AiClient`/`parseNote` testing, no MSW.** Note parsing and real-network
  mocking are Phase 2.
- **No partial-failure / non-atomic persistence tests** (picks insert fails after
  run insert, recommend-run.ts:170-193). That is hermetic-stub territory for a
  later phase (research.md OQ#2).
- **No exact float-score assertions** (test-plan §7). Assert ordering, role
  correctness, and the ≤3 / wild-card-genre / distinctness invariants only.
- **No CI workflow, no coverage gate, no husky test hook.** Quality-gate wiring is
  test-plan §3 Phase 5 (Lesson 3). Phase 1 lands a locally-runnable suite.
- **No Stryker run in-phase.** Documented as an ad-hoc selective gate only (§6.6).
- **No pgTAP / DB-layer assertions.** The `role` CHECK is a flat 4-value domain
  with no solo/duo awareness (research.md), so "solo never stores `compromise`"
  is an application-logic invariant covered at the unit layer.

## Implementation Approach

Bootstrap Vitest minimally (config + scripts, node environment, `@/*` alias),
then build the two test layers in cost order: the pure unit suite first (zero
infra, highest signal density for R5), then the supply-layer integration suite
(fetch + env + fake Supabase). Finish by recording the patterns in the test-plan
cookbook so the next phase inherits a worked example. Each test's expected value
comes from the PRD/domain oracle in `research.md`, never from reading the
implementation.

## Critical Implementation Details

- **`astro:env/server` is load-bearing for the integration layer only.**
  `recommendRun` → `createTmdbClient()` imports `TMDB_READ_ACCESS_TOKEN` from
  `astro:env/server` (tmdb.ts:1), which Vitest cannot resolve out of the box. The
  integration test must make this module resolve to a truthy token (e.g. a
  `resolve.alias` in `vitest.config.ts` pointing `astro:env/server` at a tiny
  test stub, or `vi.mock("astro:env/server", …)`). Pick one mechanism in Phase 1
  and reuse it; without it `createTmdbClient()` returns `null` and `recommendRun`
  short-circuits with "TMDB is not configured" before the ladder ever runs. The
  pure unit suite does **not** touch this module — keep the shim scoped to the
  integration test so unit tests stay infra-free.
- **`fetch` stub must key on query params.** `discoverMovies` issues
  `GET /discover/movie?…&page=N` (tmdb-discover.ts:106). `fetchCandidates` calls
  3 pages (`pages: 3`, recommend-run.ts:140). The stub must return a `Response`
  whose `.json()` yields `{ results: [...] }`, varying by `page` so the
  dedup-across-pages assertion is meaningful, and must echo enough fields for
  `normalizeMovie` (id, title, genre_ids, vote_average, vote_count, popularity).
- **Watched read shape.** The fake Supabase must answer
  `from("watched").select("tmdb_movie_id").eq("user_id", …)` with
  `{ data: [{ tmdb_movie_id }] }` (recommend-run.ts:93) and accept the two insert
  chains (`recommendations` → `.select("id").single()` returning `{ data: { id } }`;
  `recommendation_picks` → `.insert(rows)` returning `{ error: null }`).

---

## Phase 1: Bootstrap Vitest

### Overview

Add Vitest 3.x and a minimal config so `npm run test` runs, with the `@/*` alias
resolving and a node test environment. Prove the harness end-to-end with one
trivial test that imports a pure source module via the alias.

### Changes Required:

#### 1. Vitest dependency + scripts

**File**: `package.json`

**Intent**: Add Vitest 3.x as a dev dependency and discoverable scripts so any
contributor/agent runs the suite the same way. No coverage gate, no CI, no hook.

**Contract**: `devDependencies.vitest` (3.x, compatible with the pinned Vite 7).
Scripts: `"test": "vitest"` (watch) and `"test:run": "vitest run"` (one-shot, for
CI later). If a tsconfig-paths resolver is needed for the alias, add
`vite-tsconfig-paths` as a dev dep (see config below).

#### 2. Vitest config

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Configure a node test environment and make the `@/*` alias resolve in
tests so source imports work unchanged.

**Contract**: `test.environment = "node"`; `@/*` → `./src/*` resolution (via
`vite-tsconfig-paths` plugin, or a manual `resolve.alias` mapping `@` to
`./src`). Default `include` globs (`**/*.{test,spec}.ts`) are fine. Do **not**
add a global Astro/env shim here — the `astro:env/server` resolution is scoped to
the integration test (Phase 3) so unit tests stay infra-free.

#### 3. Harness smoke test

**File**: `src/lib/recommend/affinity.test.ts` (new) — or a colocated trivial test

**Intent**: One assertion that imports a pure module through the `@/*` alias and
checks a deterministic table lookup, proving the runner + alias + TS resolution
work before the real suites land.

**Contract**: Import a pure helper (e.g. `moodGenres` from `@/lib/recommend/...`
or assert `WEIGHTS.W_EXCL === 4`) and assert one known value. This file is
replaced/expanded by Phase 2; it exists here only to green the harness.

### Success Criteria:

#### Automated Verification:

- Vitest is installed: `npm ls vitest` resolves a 3.x version
- The suite runs and passes: `npm run test:run`
- The `@/*` alias resolves inside a test (the smoke test imports via `@/`)
- Lint passes: `npm run lint`

#### Manual Verification:

- `npm run test` (watch mode) starts and re-runs on file change
- No Astro/Cloudflare runtime warnings in the unit run (confirms node env is
  clean for pure modules)

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation before Phase 2.

---

## Phase 2: Pure-layer unit suite — `recommend()` (R5 + shape-half of R1)

### Overview

Prove the pick *shape* contract for `recommend()` against the PRD/domain oracle:
≤3, distinct ids, correct role-by-cardinality, wild-card genre ≠ safe, and the
`min(N,3)` no-fabrication boundary. Parameterized per-property to avoid redundant
copies, plus focused tests for the named edges.

### Changes Required:

#### 1. Fixtures

**File**: `src/lib/recommend/__fixtures__/movies.ts` (new) — or inline factories
in the test file

**Intent**: Small hand-built `TmdbMovie[]` factories with controllable
`genre_ids`, `vote_average`, `vote_count`, `popularity` so each test can force a
known argmax/disjointness outcome **without** depending on exact float scores.

**Contract**: A `makeMovie(partial)` factory returning a fully-populated
`TmdbMovie` (all fields from tmdb-discover.ts:18-28), plus named pools: a healthy
≥3 pool with a genre-disjoint candidate, a narrow-genre pool with **no** disjoint
candidate (forces the Jaccard fallback), a 2-film pool, a 1-film pool, an empty
pool, and a pool with two films sharing an id (dedup).

#### 2. Unit suite

**File**: `src/lib/recommend/roles.test.ts` (new)

**Intent**: Assert the shape invariants and edges. Oracle from PRD/research, not
from roles.ts. Structure: one parameterized block (`it.each`) per invariant over
solo + duo fixtures, then discrete edge tests.

**Contract**: Cover, at minimum —
- **Parameterized invariants** (`it.each` over {solo, duo} × healthy pool):
  picks length ≤ 3; all pick `movie.id` distinct; roles match cardinality
  (solo ⊂ {`safe`,`crowd_pleaser`,`wild_card`}; duo ⊂ {`safe`,`compromise`,
  `wild_card`}); wild-card `genre_ids` disjoint from the safe pick's.
- **Solo never emits `compromise`** — explicit assertion on a solo run.
- **Wild-card fallback** — narrow-genre pool with no disjoint candidate still
  yields a third pick (minimum-Jaccard), distinct from safe; and the disjoint
  case is preferred when available.
- **`min(N,3)` boundary** — 2-film pool → exactly 2 picks (safe + middle), 1-film
  → 1 pick, empty → `{ picks: [] }`. A code comment ties this to the supply/shape
  split (it documents *no fabrication*, not a tolerated defect).
- **Dedup** — a pool with a duplicate id collapses to one before role assignment
  (no duplicate picks).
- **Role-by-cardinality switch** — same pool, solo vs duo, produces the correct
  middle role label (`crowd_pleaser` vs `compromise`).

No assertion compares a `pick.score` to a hardcoded float (test-plan §7); order
the pool so the intended candidate wins by construction instead.

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `npm run test:run`
- Type checking passes: `astro check`
- Lint passes: `npm run lint`
- No test asserts an exact float score value (grep the test file for literal
  decimal score comparisons)

#### Manual Verification:

- Each test maps to a distinct R5 failure from the risk map (review: wrong role,
  duplicate, wild-card-not-differing, solo-compromise) — no two tests are
  redundant copies
- The `min(N,3)` tests read as documenting the no-fabrication contract, not as
  tolerating a sub-three defect (comment present)

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Supply-layer integration suite — `recommendRun` (supply-half of R1)

### Overview

Prove the retrieval pipeline's *supply* guarantees on the genre-only (no-note)
path: a healthy ≥3 pool yields exactly three persisted role-labeled picks;
movies repeated across discover pages are deduped; watched films are excluded
from the pool. Stub only the network edge (`fetch`) + the env token; supply a
hand-rolled fake `SupabaseClient`. No internal module is mocked.

### Changes Required:

#### 1. `astro:env/server` resolution for tests

**File**: `vitest.config.ts` (extend) and/or the integration test file

**Intent**: Make `astro:env/server` resolve to a truthy `TMDB_READ_ACCESS_TOKEN`
so `createTmdbClient()` returns a real client and the ladder runs. Keep this
scoped so the Phase 2 unit suite stays infra-free.

**Contract**: Either a `resolve.alias` entry mapping `astro:env/server` to a tiny
stub module exporting `TMDB_READ_ACCESS_TOKEN = "test-token"`, or a
`vi.mock("astro:env/server", () => ({ TMDB_READ_ACCESS_TOKEN: "test-token" }))`
at the top of the integration test. One mechanism, reused.

#### 2. Fake Supabase + fetch stub helpers

**File**: `src/lib/__fixtures__/recommend-run-doubles.ts` (new) — or inline

**Intent**: A minimal fake `SupabaseClient` and a `fetch` stub that returns canned
`/discover/movie` pages, enough to drive `recommendRun` through retrieval +
persistence without real infra.

**Contract**:
- **Fake Supabase**: chainable `from(table)` supporting
  `select(...).eq(...)` → `{ data: watchedRows }` for `"watched"`;
  `insert(...).select("id").single()` → `{ data: { id: "rec-1" }, error: null }`
  for `"recommendations"`; `insert(rows)` → `{ error: null }` for
  `"recommendation_picks"` (capturing `rows` for assertions). Watched rows are a
  test parameter.
- **fetch stub**: `vi.stubGlobal("fetch", fn)` returning a `Response` (`ok: true`,
  `.json()` → `{ results }`) whose `results` vary by the `page` query param so
  the dedup-across-pages case is exercised. Movies carry the fields
  `normalizeMovie` reads.

#### 3. Integration suite

**File**: `src/lib/recommend-run.test.ts` (new)

**Intent**: Drive `recommendRun(fakeSupabase, user, session, second)` on the
no-note path and assert the supply guarantees against the persisted picks.

**Contract**: Cover —
- **Healthy ≥3 pool → exactly three picks persisted**: assert the
  `recommendation_picks` insert received exactly 3 rows with distinct
  `tmdb_movie_id`, valid `role` values for the session cardinality, and the
  result is `{ ok: true, recommendationId, redirectTo: "/sessions/<id>/recommendations" }`.
- **Dedup across pages**: discover pages 1–3 share an overlapping movie; assert
  the deduped pool still produces 3 distinct picks (the duplicate is not double
  counted).
- **Watched exclusion**: a watched `tmdb_movie_id` present in the discover
  results never appears in the persisted picks (exclusion applied during
  retrieval, recommend-run.ts:142 / tmdb-discover.ts:184).
- **Supply boundary (R1 two-faces)**: a genre-only pool of exactly 2 distinct
  films → `ok: true` with 2 persisted picks (no error, no fabricated third) —
  documenting "three only when supply allows"; a pool of 0 films → `ok: false`
  with the "Could not reach TMDB, try again" message (recommend-run.ts:153-154).

Assert role/shape/exclusion/count, never exact float scores.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:run`
- Type checking passes: `astro check`
- Lint passes: `npm run lint`
- No real network call is made (test passes offline; `fetch` is stubbed)

#### Manual Verification:

- The watched-exclusion test fails if the exclusion seam is removed (spot-check by
  temporarily clearing `excludeMovieIds` — confirms the test has teeth)
- The 2-film boundary test reads as the *physics* face of R1 (genuine thin
  universe), clearly distinct from the *defect* face the dedup/count tests guard
- No internal `@/lib/recommend*` module is mocked — only `fetch` + env + Supabase
  double

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Cookbook + test-plan sync

### Overview

Record the worked patterns so the next rollout phase inherits them, and reflect
Phase 1 completion in the test-plan.

### Changes Required:

#### 1. Cookbook entries

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.1 and §6.2 "TBD" stubs with the concrete patterns this
phase established, add a §6.6 per-phase note, and record the ad-hoc Stryker
pointer.

**Contract**:
- **§6.1 (unit)**: how to build `TmdbMovie` fixtures, order a pool so the intended
  candidate wins (oracle-by-construction, not float assertions), and the
  parameterized-per-invariant structure; cite `src/lib/recommend/roles.test.ts`.
- **§6.2 (integration)**: the `recommendRun` recipe — `vi.stubGlobal("fetch")`
  keyed on `page`, the `astro:env/server` token shim, the fake `SupabaseClient`
  shape, "stub the network edge, never internal modules"; cite
  `src/lib/recommend-run.test.ts`.
- **§6.6**: 2–3 line note capturing the surprises (two-layer split; `recommendRun`
  builds its own client so the seam is `fetch`+env+fake-Supabase; multi-rung
  progression deferred to Phase 2) and the selective Stryker pointer:
  `npx stryker run --mutate "src/lib/recommend/roles.ts"` run ad hoc after this
  phase, not wired into CI (per CLAUDE.md mutation-testing guidance).

#### 2. Change identity + progress

**File**: `context/changes/testing-always-three-picks-core/change.md`

**Intent**: Reflect that the change is implemented as phases land.

**Contract**: `status` and `updated` kept current by `/10x-implement` as the
Progress section fills.

### Success Criteria:

#### Automated Verification:

- §6.1 and §6.2 no longer contain "TBD — see §3 Phase 1": `grep -c "TBD — see §3 Phase 1" context/foundation/test-plan.md` reflects the two removed stubs
- Full suite still green: `npm run test:run`

#### Manual Verification:

- A contributor unfamiliar with the suite could add a new unit and integration
  test from §6.1/§6.2 alone
- §6.6 accurately records the two-layer split and the Stryker pointer

**Implementation Note**: Final phase — confirm the full suite is green and the
cookbook reads cleanly.

---

## Testing Strategy

### Unit Tests:

- `recommend()` shape invariants (≤3, distinct, role-by-cardinality, wild-card
  genre ≠ safe) parameterized over solo/duo.
- Edges: solo-never-`compromise`, wild-card Jaccard fallback, `min(N,3)` for
  pools of 2/1/0, dedup by id.

### Integration Tests:

- `recommendRun` no-note path: healthy ≥3 pool → exactly 3 persisted picks;
  dedup across discover pages; watched exclusion; supply boundary (2 → 2 picks
  `ok:true`, 0 → `ok:false`).

### Manual Testing Steps:

1. `npm run test:run` — full suite green.
2. Temporarily remove `excludeMovieIds` in the ladder call and confirm the
   watched-exclusion integration test goes red (teeth check), then restore.
3. Review each unit test maps to a distinct R5 failure (no redundant copies).

## Performance Considerations

None — all tests run in-process against stubs (no network, no DB). The node test
environment keeps the pure suite free of Astro/Cloudflare runtime overhead.

## Migration Notes

None — additive tooling. No source behavior changes; only new test files, a
config, and package.json scripts.

## References

- Research (oracle + seams): `context/changes/testing-always-three-picks-core/research.md`
- Test plan strategy: `context/foundation/test-plan.md` §2 (R1/R5), §3 Phase 1, §7
- Pure layer under test: `src/lib/recommend/roles.ts:100-177`,
  `src/lib/recommend/scoring.ts:13-120`
- Supply layer under test: `src/lib/recommend-run.ts:88-198`,
  `src/lib/tmdb-discover.ts:148-200`
- Env seam: `src/lib/tmdb.ts:1,15-28`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap Vitest

#### Automated

- [x] 1.1 Vitest is installed: `npm ls vitest` resolves a 3.x version
- [x] 1.2 The suite runs and passes: `npm run test:run`
- [x] 1.3 The `@/*` alias resolves inside a test
- [x] 1.4 Lint passes: `npm run lint`

#### Manual

- [x] 1.5 `npm run test` watch mode starts and re-runs on change
- [x] 1.6 No Astro/Cloudflare runtime warnings in the unit run

### Phase 2: Pure-layer unit suite — `recommend()`

#### Automated

- [ ] 2.1 Unit suite passes: `npm run test:run`
- [ ] 2.2 Type checking passes: `astro check`
- [ ] 2.3 Lint passes: `npm run lint`
- [ ] 2.4 No test asserts an exact float score value

#### Manual

- [ ] 2.5 Each test maps to a distinct R5 failure — no redundant copies
- [ ] 2.6 `min(N,3)` tests document no-fabrication (comment present)

### Phase 3: Supply-layer integration suite — `recommendRun`

#### Automated

- [ ] 3.1 Integration suite passes: `npm run test:run`
- [ ] 3.2 Type checking passes: `astro check`
- [ ] 3.3 Lint passes: `npm run lint`
- [ ] 3.4 No real network call is made (passes offline; `fetch` stubbed)

#### Manual

- [ ] 3.5 Watched-exclusion test fails if the exclusion seam is removed (teeth)
- [ ] 3.6 2-film boundary test reads as the physics face of R1
- [ ] 3.7 No internal `@/lib/recommend*` module is mocked

### Phase 4: Cookbook + test-plan sync

#### Automated

- [ ] 4.1 §6.1/§6.2 no longer contain the "TBD — see §3 Phase 1" stubs
- [ ] 4.2 Full suite still green: `npm run test:run`

#### Manual

- [ ] 4.3 A new contributor could add a unit + integration test from §6.1/§6.2
- [ ] 4.4 §6.6 records the two-layer split and the Stryker pointer
