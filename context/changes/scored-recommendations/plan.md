# Scored, Role-Labeled Recommendations (S-03) — Implementation Plan

## Overview

Turn a saved movie-night session into **three meaningfully distinct, role-labeled recommendations** — safe pick, compromise pick, wild card — drawn from TMDB candidates and scored deterministically against both viewer profiles and the session constraints, rendered within the `<10s` NFR. This is roadmap slice **S-03**, the north-star validation milestone, satisfying US-01 and FR-005..FR-009. It builds directly on the input contract S-02 established (`movie_night_sessions`) and the taste fields S-01 captured (`viewer_profiles`), and extends the F-01 TMDB reachability stub into a real discover client.

The slice ships as one vertical change across five phases: data layer → TMDB discover client → pure scoring/diversity engine → API endpoint → results UI.

## Current State Analysis

Grounded in `context/changes/scored-recommendations/research.md` (full codebase map):

- **Inputs are settled and TMDB-native.** Two `viewer_profiles` per user (slot 1/2) hold `preferred_genre_ids int[]`, `excluded_genre_ids int[]`, freeform `note`; the latest `movie_night_sessions` row holds `mood` (10-value vocab), `preferred_genre_ids`, `excluded_genre_ids`, `runtime_limit_minutes` (nullable), `intensity` (low/medium/high), `note`. Genre ids are authoritative TMDB ids — no translation. (`supabase/migrations/20260603115857_viewer_profiles.sql`, `supabase/migrations/20260606085900_movie_night_sessions.sql`, `src/lib/genres.ts`, `src/lib/session-options.ts`.)
- **TMDB is a reachability stub.** `createTmdbClient(): TmdbClient | null` exposes `request(path, init) → Promise<Response>` with a v4 bearer token, raw `fetch`, `null`-when-unconfigured, no timeout (`src/lib/tmdb.ts:15-46`). No discover call, no param builder, no pagination, no response types exist yet.
- **AI is out of scope** — S-03 is deterministic; `src/lib/ai.ts` belongs to S-04. The `<10s` budget is spent on TMDB subrequests + CPU scoring only.
- **Established patterns to mirror:** owner-scoped RLS new-table checklist (`docs/reference/persistence-conventions.md:122-132`); form-POST → validate → RLS-client → redirect-with-`?error=` (`src/pages/api/sessions.ts:6-126`); server-load + island hydration page (`src/pages/sessions.astro:7-70`); glass `bg-cosmic` styling; in-route 401 auth guard for API routes (`src/pages/api/health/integrations.ts:14-19`).
- **Hard runtime constraints:** 50 subrequests/request (free plan, first limit hit), `<10s` NFR, 10ms CPU — mitigation of record is "batch/limit candidate count" (`context/foundation/infrastructure.md:64,96`). `astro dev` runs real workerd, so these are locally verifiable ([[astro-dev-runs-in-workerd]]).
- **Greenfield for S-03:** no `recommendations` table, no `watched` table (S-05 unshipped), only one shadcn React primitive (`src/components/ui/button.tsx`) — result cards are hand-rolled from the Tailwind glass vocabulary.

## Desired End State

A logged-in user with **two** viewer profiles opens `/sessions`, sees their latest session, clicks **"Get recommendations"**, and within a few seconds lands on `/sessions/<session_id>/recommendations` showing **three glass cards** — Safe pick / Compromise / Wild card — each with poster, title, year, rating, and genres, where the wild card's genre is provably distinct from the safe pick's. The three picks are persisted (a `recommendations` row + three `recommendation_picks` rows snapshotting display fields), so the page reloads without re-hitting TMDB and downstream slices (S-04 justification per pick, S-05 select + mark watched) have a stable identity to reference. A second account sees none of the first's recommendations.

Verified by: `npm run db:verify` (RLS isolation on both new tables), `npx astro sync && npm run build`, `npm run lint`, and a manual end-to-end run under local workerd completing within `<10s`, including the diversity guarantee and the degradation paths (missing profile, thin pool, TMDB down).

### Key Discoveries:

- TMDB seam to extend: `src/lib/tmdb.ts:15-28` (`request()`), bearer v4, no discover/types/timeout.
- Discover list items return `genre_ids`, `vote_average`, `vote_count`, `popularity`, `release_date`, `overview`, `title`, `poster_path` — **but not `runtime`**; runtime is therefore a query-time hard filter only (`with_runtime.lte`), never a per-candidate field (research §B).
- Owner-scoped RLS template + new-table checklist: `docs/reference/persistence-conventions.md:122-132`; worked examples in the two existing migrations.
- POST handler skeleton + redirect-with-error idiom: `src/pages/api/sessions.ts:6-26,72-125`.
- `/sessions` prefix in `PROTECTED_ROUTES` (`src/middleware.ts:4`) already guards `/sessions/[id]/recommendations` (startsWith match) — **no middleware change**; the `/api/recommendations` route guards in-route.
- Standard TMDB image base `https://image.tmdb.org/t/p/w500` is a stable constant; poster `<img>` loads are browser requests, not worker subrequests.

## What We're NOT Doing

- **No AI justifications** — deterministic scoring only; AI text is S-04. The pick shape leaves room for it but S-03 writes none.
- **No watched-exclusion** — S-05 is unshipped. The candidate retrieval exposes an optional `excludeMovieIds` seam defaulted empty; S-03 does not populate it.
- **No `with_genres` AND / `without_genres`** — preferred genres are an OR-union hint at query time; excluded genres are a scoring penalty (FR-006), never a hard query filter. Only runtime is a hard filter.
- **No per-candidate `/movie/{id}` detail calls** — would blow the subrequest/`<10s` budget for marginal value.
- **No app-level unit-test runner** — scoring is written as a pure module verified manually + via pgTAP for the tables; unit tests are deferred to the Module-3 `/10x-test-plan` (the pure seam makes them trivial later).
- **No session-history or recommendation-history browsing** — the results page shows the latest recommendation for a given session.
- **No dedup/replace of prior runs** — each "Get recommendations" inserts a new `recommendations` row (mirroring S-02's unbounded-rows choice); the results page and downstream slices (S-04/S-05) always reference the **latest run** for the session. Older runs and their picks simply remain; no cleanup in this slice.
- **No remote DB push** — migrations applied locally (`npm run db:reset`); hosted application is human-gated (`persistence-conventions.md:108-119`).
- **No new shadcn components** — result cards reuse the existing glass Tailwind vocabulary + `Button`.

## Implementation Approach

Follow the codebase's prescribed orderings: data layer first (new-table checklist: schema → index → RLS → policies → pgTAP → `db:reset && db:verify` → teeth check), then the feature in data → retrieval → logic → API → UI order. Retrieval (TMDB discover) and the scoring/diversity engine are kept as **separate, pure modules** so the engine is a clean, side-effect-free unit (a ready Module-3 test seam) and retrieval is independently exercisable. The API endpoint is the only place that composes them with I/O: it loads profiles + session under RLS, retrieves candidates, scores, assigns roles, persists, and redirects. The results page is pure server-render of persisted rows.

## Critical Implementation Details

- **Deterministic scoring spec (the one genuinely novel, load-bearing piece — other phases depend on these signatures).** For each candidate `c` with genre set `G(c)`:
  - **Viewer affinity** for profile `v`: `A_v(c) = W_PREF·|G(c) ∩ v.preferred| − W_EXCL·|G(c) ∩ v.excluded|`.
  - **Session alignment**: `S(c) = W_SPREF·|G(c) ∩ s.preferred| − W_SEXCL·|G(c) ∩ s.excluded| + W_MOOD·|G(c) ∩ moodGenres(s.mood)| + W_INT·intensityBias(G(c), s.intensity)`, where `moodGenres` comes from a static `MOOD_GENRE_AFFINITY` map and `intensityBias` from a static `INTENSITY_GENRE_BIAS` map (both defined in the engine module).
  - **Quality / popularity**: `Q(c) = vote_average/10`; `P(c) = popularity / maxPopularityInPool` (pool-relative, light weight). A `vote_count.gte` floor is applied at query time so low-vote outliers never enter the pool.
  - **Shared terms**: `shared(c) = S(c) + W_QUALITY·Q(c) + W_POP·P(c)`.
  - **Combined (safe ranking)**: `combined(c) = A_A(c) + A_B(c) + shared(c)`.
  - **Balance (compromise ranking)**: `balance(c) = min(A_A(c) + shared(c), A_B(c) + shared(c))` — rewards the film that best serves the *worse-off* viewer, structurally distinct from `combined`.
  - Excluded-genre weights are **strong** (`W_EXCL`, `W_SEXCL` ≈ 2× the preferred weights) per FR-006.
  - Default weights live in one exported consts block (tunable in a single edit): `W_PREF=2, W_EXCL=4, W_SPREF=2, W_SEXCL=4, W_MOOD=2, W_INT=1, W_QUALITY=3, W_POP=1, VOTE_COUNT_FLOOR=100`.
- **Role selection + FR-009 diversity guarantee.** Pick **safe** = argmax `combined`. Pick **compromise** = argmax `balance` among the rest. Pick **wild card** = argmax `combined` among remaining candidates whose **`genre_ids` set shares no genre with the safe pick** (full set-disjointness — the robust enforcement of "differs in genre", since TMDB `genre_ids` order is categorical, not relevance-ranked, so a "first id" comparison would be an unsound proxy); tie-break toward novelty (lower `P(c)`). If no candidate is fully disjoint (thin/narrow-genre pool), fall back to the candidate with the **lowest Jaccard overlap** of `genre_ids` with the safe pick. All three must be distinct movie ids. With fewer than 3 distinct candidates, return as many roles as can be filled (safe, then compromise) — never fabricate.
- **`<10s` budget.** Candidate retrieval is capped at 2–3 discover pages merged+deduped (~40–60 movies), 2–3 TMDB subrequests, wrapped in an `AbortController` (~8s ceiling). Scoring is O(candidates) integer set math — negligible CPU. Poster images load client-side (no subrequest).

## Phase 1: Data layer — `recommendations` + `recommendation_picks` tables

### Overview

Add the two owner-scoped tables that persist a recommendation run and its three picks, following the new-table checklist, and prove isolation with pgTAP mirroring the S-01/S-02 fixtures.

### Changes Required:

#### 1. Migration: `recommendations` + `recommendation_picks`

**File**: `supabase/migrations/<timestamp>_recommendations.sql` (scaffold via `npm run db:new recommendations`)

**Intent**: Persist one `recommendations` row per generation (tied to a session) and three child `recommendation_picks` snapshotting the display fields, so the results page renders without TMDB calls and S-04/S-05 can reference a stable pick identity. Owner-scoped RLS holds FR-001 at the data layer.

**Contract**: Two tables in `public`, both following `persistence-conventions.md:122-132` (own-data RLS).
- `recommendations`: `id uuid pk default gen_random_uuid()`; `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()`; `session_id uuid not null references public.movie_night_sessions(id) on delete cascade`; `created_at timestamptz not null default now()`. Indexes on `(user_id)` and `(session_id)`. RLS enabled + four `recommendations_{select,insert,update,delete}_own` policies scoped `auth.uid() = user_id`.
- `recommendation_picks`: `id uuid pk default gen_random_uuid()`; `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()` (denormalized so RLS is uniform per the convention); `recommendation_id uuid not null references public.recommendations(id) on delete cascade`; `role text not null check (role in ('safe','compromise','wild_card'))`; `tmdb_movie_id int not null`; `score real not null`; `title text not null`; `poster_path text`; `overview text`; `genre_ids int[] not null default '{}'`; `release_date text`; `vote_average real`; `created_at timestamptz not null default now()`. `unique (recommendation_id, role)`; indexes on `(recommendation_id)` and `(user_id)`. RLS enabled + four `recommendation_picks_{select,insert,update,delete}_own` policies scoped `auth.uid() = user_id`. (Direct application of the documented template; see existing migrations for the worked policy shape.)

#### 2. pgTAP test: isolation

**File**: `supabase/tests/recommendations_isolation.sql`

**Intent**: Prove two impersonated users each see only their own recommendations and picks and cannot read/update/delete the other's.

**Contract**: Mirror `supabase/tests/` viewer-profiles/sessions fixtures (single rolled-back transaction, `set local role authenticated` + `request.jwt.claims` per user, seed `auth.users`, seed a `movie_night_sessions` row per user to satisfy the FK). Assert: (a) each user sees only their own `recommendations` and `recommendation_picks` rows on `select`; (b) a user cannot update/delete the other's rows; (c) the `unique (recommendation_id, role)` constraint and the `role` check reject a bad insert.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- pgTAP isolation + constraint tests pass: `npm run db:verify`
- Lint passes: `npm run lint`

#### Manual Verification:

- Teeth check: drop one `recommendation_picks` policy → `npm run db:verify` fails → `npm run db:reset` restores green (test isn't vacuous).

**Implementation Note**: After automated verification passes, pause for human confirmation of the teeth check before Phase 2.

---

## Phase 2: TMDB discover client

### Overview

Extend `src/lib/tmdb.ts` (or a sibling `src/lib/tmdb-discover.ts`) into a real candidate-retrieval client: a typed discover call, a query-param builder, multi-page merge/dedup, an abort timeout, and an exclusion seam — all on the existing `request()` seam, workerd-safe.

### Changes Required:

#### 1. Discover types + call

**File**: `src/lib/tmdb.ts` (extend) or new `src/lib/tmdb-discover.ts`

**Intent**: Provide a typed `/discover/movie` call and the candidate-fetch helper the API will use, honoring the subrequest/`<10s` budget and exposing a future watched-exclusion hook.

**Contract**:
- Export `interface TmdbMovie { id: number; title: string; genre_ids: number[]; vote_average: number; vote_count: number; popularity: number; release_date: string; overview: string; poster_path: string | null }`.
- Export `interface DiscoverParams { genreIds?: number[]; runtimeLteMinutes?: number | null; voteCountGte?: number; sortBy?: string; page?: number }`.
- Export `async function discoverMovies(client: TmdbClient, params: DiscoverParams): Promise<TmdbMovie[]>` — builds the query string (`with_genres` = `genreIds.join("|")` OR-union when present; `with_runtime.lte` only when `runtimeLteMinutes` non-null; `vote_count.gte`; `sort_by` default `popularity.desc`; `page`), calls `request("/discover/movie?...")`, parses `results` into `TmdbMovie[]`, returns `[]` on non-ok.
- Export `async function fetchCandidates(client: TmdbClient, opts: { genreIds?: number[]; runtimeLteMinutes?: number | null; pages?: number; voteCountGte?: number; excludeMovieIds?: Set<number> }): Promise<TmdbMovie[]>` — loops `pages` (default 3), merges + dedups by `id`, filters out `excludeMovieIds` (default empty), all wrapped in a single shared `AbortController` with a ~8s budget. Returns whatever was gathered before the budget/last page.

**Critical detail**: discover list items have **no `runtime`** — `fetchCandidates` must not attempt per-movie detail calls; runtime is enforced solely by `with_runtime.lte`.

### Success Criteria:

#### Automated Verification:

- Type check / build passes: `npx astro sync && npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Under `astro dev` (real workerd), a temporary debug invocation of `fetchCandidates` with a sample genre+runtime returns a deduped, non-empty `TmdbMovie[]` with the expected fields populated, in well under 10s, using ≤3 subrequests.
- With `TMDB_READ_ACCESS_TOKEN` unset, `createTmdbClient()` is `null` and the caller degrades (no throw).

**Implementation Note**: Pause for human confirmation after the manual discover check before Phase 3.

---

## Phase 3: Scoring + role/diversity engine (pure module)

### Overview

Add a pure, side-effect-free `src/lib/recommend/` module implementing the deterministic scoring spec and role selection with the FR-009 diversity guarantee. No I/O, no env, no TMDB/Supabase — inputs in, three picks out.

### Changes Required:

#### 1. Affinity maps

**File**: `src/lib/recommend/affinity.ts`

**Intent**: Static maps translating session mood/intensity into TMDB-genre affinities, the deterministic stand-in for semantic matching.

**Contract**: Export `MOOD_GENRE_AFFINITY: Record<string, number[]>` keyed by the `MOODS` ids (`session-options.ts`) → arrays of TMDB genre ids (e.g. `funny→[35]`, `tense→[53,9648,80]`, `romantic→[10749]`, `dark→[27,80,53,18]`, `epic→[12,10752,36,14]`, `light→[35,10751,16,12]`, `emotional→[18,10749]`, `thought-provoking→[18,99,878,9648]`, `cozy→[10751,35,10749]`, `thrilling→[28,53,12]`). Export `INTENSITY_GENRE_BIAS: Record<Intensity, { favor: number[]; disfavor: number[] }>` (`high` favors action/thriller/horror/war/crime; `low` favors family/comedy/romance/documentary; `medium` neutral/empty). Export helpers `moodGenres(mood: string | null): number[]` and `intensityBias(genreIds: number[], intensity: Intensity): number`.

#### 2. Scoring

**File**: `src/lib/recommend/scoring.ts`

**Intent**: Implement the weighted per-candidate score functions exactly per the Critical Implementation Details spec.

**Contract**: Export the `WEIGHTS` consts block (the default weights + `VOTE_COUNT_FLOOR`). Export `viewerAffinity(candidate, profile): number`, `sessionAlignment(candidate, session): number`, and `scoreCandidate(candidate, profiles, session, maxPopularity): { combined: number; balance: number; perViewer: [number, number] }`. Pure integer/float set math over `genre_ids`; uses `MOVIE_GENRES` only via ids (no name lookups).

#### 3. Role selection

**File**: `src/lib/recommend/roles.ts` + `src/lib/recommend/index.ts`

**Intent**: Select the three distinct role-labeled picks with the FR-009 diversity guarantee, returning a persistence-ready shape.

**Contract**: Export `type Role = "safe" | "compromise" | "wild_card"`; `interface Pick { role: Role; movie: TmdbMovie; score: number }`; `interface RecommendationResult { picks: Pick[] }`. Export `recommend(profiles: [Profile, Profile], session: SessionPrefs, candidates: TmdbMovie[]): RecommendationResult` — computes `maxPopularity` over the pool, scores all candidates, selects safe (max `combined`), compromise (max `balance`, ≠ safe), wild card (max `combined` among candidates whose `genre_ids` set is fully disjoint from safe's `genre_ids`; fallback = min Jaccard overlap; ≠ safe & compromise). Returns 1–3 distinct picks (never fabricates when the pool is too thin). `Profile`/`SessionPrefs` are local input interfaces matching the loaded row shapes (genre id arrays + mood/intensity).

### Success Criteria:

#### Automated Verification:

- Type check / build passes: `npx astro sync && npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- A temporary harness (debug log under `astro dev`) feeding two sample profiles + a session + a fixed candidate list returns three **distinct** picks where the wild card **shares no genre** with the safe pick (FR-009), the compromise differs from safe, and excluded-genre candidates are visibly down-ranked.
- A thin candidate list (2 items) returns 2 picks without error; an empty list returns 0 picks.

**Implementation Note**: Pause for human confirmation of the diversity/scoring behavior before Phase 4.

---

## Phase 4: API endpoint — `POST /api/recommendations`

### Overview

The single I/O composition point: auth-guard, load the two profiles + the target session under RLS, retrieve candidates, score, assign roles, persist the recommendation + picks, and redirect to the results page — with the FR-008 preconditions and graceful degradation.

### Changes Required:

#### 1. Recommendations endpoint

**File**: `src/pages/api/recommendations.ts`

**Intent**: Generate and persist one recommendation run for the user's session, then redirect to its results page; degrade gracefully on every missing precondition.

**Contract**: `export const POST: APIRoute`. Reads `session_id` from `formData()`. Builds the RLS client (`createClient(headers, cookies)`; null → redirect `/sessions?error=<encoded>` mirroring `sessions.ts` `fail`). Redirect `/auth/signin` if no `context.locals.user`. Then:
1. Load the user's `viewer_profiles` (order by slot). If fewer than **2**, redirect `/profiles?error=<need two viewer profiles>` (FR-008/US-01 precondition).
2. Load the target session: by `session_id` when present (RLS-scoped), else the latest (`order by created_at desc limit 1`). If none, redirect `/sessions?error=<start a session first>`.
3. `createTmdbClient()`; if null → redirect `/sessions?error=<recommendations unavailable: TMDB not configured>` (persist nothing).
4. `fetchCandidates(client, { genreIds: union(session.preferred, profileA.preferred, profileB.preferred), runtimeLteMinutes: session.runtime_limit_minutes, voteCountGte: VOTE_COUNT_FLOOR, pages: 3 })`. On thrown/aborted fetch → redirect `/sessions?error=<could not reach TMDB, try again>`.
5. `recommend([profileA, profileB], session, candidates)`. If `picks.length === 0` → redirect `/sessions?error=<no matching films, broaden your preferences>`.
6. Insert one `recommendations` row (`user_id`, `session_id`) → get `id`. Insert the `recommendation_picks` rows (one per pick, snapshotting `role, tmdb_movie_id, score, title, poster_path, overview, genre_ids, release_date, vote_average`).
7. Redirect `/sessions/${session.id}/recommendations`.

Reuse the `textField`/`fail` helpers and the `URLSearchParams({ error })` redirect idiom from `src/pages/api/sessions.ts:6-16`.

**Critical detail**: guard auth **in-route** (`/api/*` is not in `PROTECTED_ROUTES`); the genre union is OR (`|`); excluded genres are NOT passed to discover (penalty lives in scoring).

### Success Criteria:

#### Automated Verification:

- Type check / build passes: `npx astro sync && npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Logged-in user with 2 profiles + a session POSTs and is redirected to `/sessions/<id>/recommendations`; a `recommendations` row + exactly three `recommendation_picks` (distinct roles) persist (verify via a quick DB select).
- User with <2 profiles is redirected to `/profiles` with a clear message; nothing persists.
- With TMDB unconfigured (token unset), the POST redirects back to `/sessions` with a degraded message; nothing persists.
- Unauthenticated POST redirects to `/auth/signin`.
- End-to-end POST completes within `<10s` under local workerd.

**Implementation Note**: Pause for human confirmation of the end-to-end + degradation paths before Phase 5.

---

## Phase 5: Results UI + entry points

### Overview

Render the persisted three picks at a dynamic results page, add the "Get recommendations" trigger to `/sessions`, and confirm route protection — completing the user-visible north-star flow.

### Changes Required:

#### 1. Results page

**File**: `src/pages/sessions/[id]/recommendations.astro`

**Intent**: Server-load the latest recommendation for the session id (RLS-scoped) and render the three role-labeled cards; surface a friendly empty/error state.

**Contract**: Frontmatter builds the RLS client; loads the most recent `recommendations` row `where session_id = Astro.params.id` (RLS already scopes to owner) and its `recommendation_picks`, then **order them safe → compromise → wild_card in the frontmatter** via an explicit role-rank map (a plain SQL `order by role` would sort alphabetically — compromise, safe, wild_card — which is the wrong display order). If none, render a "no recommendations yet — generate from your session" message linking back to `/sessions`. Render inside `<Layout title>` with the `bg-cosmic` shell and a `grid gap-6 md:grid-cols-3` of hand-rolled glass cards (`rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl`), each showing: a role badge (Safe pick / Compromise / Wild card), poster `<img src={`https://image.tmdb.org/t/p/w500${poster_path}`}>` (with a placeholder when `poster_path` is null), title, release year, `vote_average`, and genre names mapped from `genre_ids` via `MOVIE_GENRES` (`src/lib/genres.ts`). A "← Back to session" link to `/sessions`. No island needed (static render); no TMDB call.

#### 2. "Get recommendations" trigger

**File**: `src/pages/sessions.astro`

**Intent**: Let the user generate recommendations from their current/latest session.

**Contract**: When a latest *saved* session exists (the page already loads it), render — in a **distinct "Your saved session" block, visually separate from the editable `SessionForm`** — a `<form method="POST" action="/api/recommendations">` with a hidden `session_id` (the latest session's id) and a primary submit button ("Get recommendations"). Because this is a second, independent form, it operates on the **persisted** session only; include explicit copy beside it ("Recommendations use your saved preferences — save any changes first") so an unsaved edit in `SessionForm` can't silently be ignored. No-JS native POST (matches the app's PRG pattern). If a recommendation already exists for that session, optionally also show a "View recommendations" link to `/sessions/<id>/recommendations` (lightweight existence check in frontmatter).

**Critical detail**: do not render the trigger when there is no saved session (a fresh, never-saved form) — there is no `session_id` to post.

#### 3. Dashboard / route protection

**File**: `src/pages/dashboard.astro` (optional copy), verification only for `src/middleware.ts`

**Intent**: Keep entry points discoverable; confirm the results route is guarded.

**Contract**: No middleware change — `/sessions/[id]/recommendations` is covered by the existing `/sessions` prefix in `PROTECTED_ROUTES` (`src/middleware.ts:4`, startsWith match). Optionally adjust the dashboard's `/sessions` anchor copy to hint the recommendations flow; no new route added there.

### Success Criteria:

#### Automated Verification:

- Build / type check passes: `npx astro sync && npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- After a POST, `/sessions/<id>/recommendations` shows three cards with correct role labels, posters, titles, years, ratings, and genres; the wild card's genre visibly differs from the safe pick's.
- Reloading the results page re-renders from persisted rows with no TMDB call (fast; works even with the token unset).
- "Get recommendations" on `/sessions` triggers the flow and lands on the results page.
- Visiting `/sessions/<id>/recommendations` for a session with no recommendation shows the friendly empty state.
- A second account cannot view the first account's recommendations URL (RLS → empty state).
- Unauthenticated access to the results page redirects to `/auth/signin`.

**Implementation Note**: Pause for human confirmation of the full manual flow; this completes the slice.

---

## Testing Strategy

### Unit Tests:

- None at the app level (no runner yet; deferred to the Module-3 `/10x-test-plan`). The scoring/diversity logic is written as the pure `src/lib/recommend/` module specifically so those tests are trivial to add later.

### Integration Tests (pgTAP):

- `recommendations_isolation.sql`: two impersonated users see only their own `recommendations` + `recommendation_picks`; cannot update/delete the other's; `unique (recommendation_id, role)` and the `role` check reject bad inserts.

### Manual Testing Steps:

1. Sign in (account with 2 profiles + a saved session); open `/sessions`; click "Get recommendations"; confirm redirect to `/sessions/<id>/recommendations` with three distinct, role-labeled cards within <10s.
2. Confirm the wild card's dominant genre differs from the safe pick's (FR-009).
3. Reload the results page; confirm it renders from persistence with no TMDB call (try with the token temporarily unset).
4. Sign in as an account with <2 profiles; trigger; confirm redirect to `/profiles` with a message and no persisted row.
5. Unset `TMDB_READ_ACCESS_TOKEN`; trigger; confirm a degraded message on `/sessions` and nothing persisted; restore the token.
6. As a second account, open the first account's results URL; confirm the empty state (RLS).
7. Confirm unauthenticated access to the results page and the API both redirect to sign-in.
8. Teeth check (Phase 1): drop a picks policy → `db:verify` fails → `db:reset` restores green.

## Performance Considerations

Retrieval is capped at 2–3 discover pages (~40–60 candidates), 2–3 subrequests, under an ~8s `AbortController` budget — comfortably within the 50-subrequest cap and `<10s` NFR. Tuning note: `vote_count.gte` (default 100) applied at the discover query compounds with the runtime + genre filters and can thin niche-taste pools — it's a tunable knob (relax it, or move it to a soft scoring gate) if the thin-pool fallback fires too often in practice. Scoring is O(candidates) integer set math (negligible CPU). The results page reads persisted rows only (no TMDB subrequest); poster images load client-side. Snapshotting display fields into `recommendation_picks` keeps the results page fast, reloadable, and resilient to later TMDB downtime. Verify the full timing under local workerd (real runtime).

## Migration Notes

Two new tables only; no existing data to migrate. Local-only application (`npm run db:reset`); hosted push is human-gated (`persistence-conventions.md:108-119`). `recommendation_picks` carries a denormalized `user_id` for uniform owner-scoped RLS. `recommendations.session_id` and `recommendation_picks.recommendation_id` cascade-delete, so removing a session or a run cleans up its picks.

## References

- Research: `context/changes/scored-recommendations/research.md`
- Input contract (session): `supabase/migrations/20260606085900_movie_night_sessions.sql`; plan `context/changes/movie-night-session-prefs/plan.md`
- Taste fields (profiles): `supabase/migrations/20260603115857_viewer_profiles.sql`
- TMDB seam: `src/lib/tmdb.ts:15-46`; env `astro.config.mjs:21`
- Genre vocab: `src/lib/genres.ts`; mood/intensity: `src/lib/session-options.ts`
- POST + redirect-with-error precedent: `src/pages/api/sessions.ts:6-126`
- Server-load + island page precedent: `src/pages/sessions.astro:7-70`
- In-route API auth guard: `src/pages/api/health/integrations.ts:14-19`
- New-table RLS checklist: `docs/reference/persistence-conventions.md:122-132`
- Runtime constraints: `context/foundation/infrastructure.md:64,96`; PRD FR-005..FR-009 `context/foundation/prd.md:78-96`
- Roadmap slice: `context/foundation/roadmap.md` (S-03)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer — recommendations + recommendation_picks tables

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:reset` — dea41db
- [x] 1.2 pgTAP isolation + constraint tests pass: `npm run db:verify` — dea41db
- [x] 1.3 Lint passes: `npm run lint` — dea41db

#### Manual

- [x] 1.4 Teeth check: drop a picks policy → `db:verify` fails → `db:reset` restores green — dea41db

### Phase 2: TMDB discover client

#### Automated

- [x] 2.1 Type check / build passes: `npx astro sync && npm run build` — 6c58c98
- [x] 2.2 Lint passes: `npm run lint` — 6c58c98

#### Manual

- [x] 2.3 `fetchCandidates` returns a deduped non-empty `TmdbMovie[]` with expected fields, <10s, ≤3 subrequests (local workerd) — 6c58c98
- [x] 2.4 Unset token → `createTmdbClient()` null, caller degrades (no throw) — 6c58c98

### Phase 3: Scoring + role/diversity engine

#### Automated

- [x] 3.1 Type check / build passes: `npx astro sync && npm run build`
- [x] 3.2 Lint passes: `npm run lint`

#### Manual

- [x] 3.3 Three distinct picks; wild card shares no genre with safe pick (Jaccard fallback if pool too narrow); compromise ≠ safe; excluded genres down-ranked
- [x] 3.4 Thin list (2) → 2 picks; empty list → 0 picks; no error

### Phase 4: API endpoint — POST /api/recommendations

#### Automated

- [ ] 4.1 Type check / build passes: `npx astro sync && npm run build`
- [ ] 4.2 Lint passes: `npm run lint`

#### Manual

- [ ] 4.3 2 profiles + session → redirect to results; 1 recommendation + 3 distinct picks persisted
- [ ] 4.4 <2 profiles → redirect to `/profiles`, nothing persisted
- [ ] 4.5 TMDB unconfigured → degraded redirect to `/sessions`, nothing persisted
- [ ] 4.6 Unauthenticated POST → `/auth/signin`
- [ ] 4.7 End-to-end POST completes <10s (local workerd)

### Phase 5: Results UI + entry points

#### Automated

- [ ] 5.1 Build / type check passes: `npx astro sync && npm run build`
- [ ] 5.2 Lint passes: `npm run lint`

#### Manual

- [ ] 5.3 Results page shows three role-labeled cards (poster/title/year/rating/genres); wild card genre differs from safe
- [ ] 5.4 Reload renders from persistence with no TMDB call (works with token unset)
- [ ] 5.5 "Get recommendations" on `/sessions` triggers and lands on results
- [ ] 5.6 Session with no recommendation shows friendly empty state
- [ ] 5.7 Second account cannot view first account's results URL (RLS empty state)
- [ ] 5.8 Unauthenticated results page → `/auth/signin`
