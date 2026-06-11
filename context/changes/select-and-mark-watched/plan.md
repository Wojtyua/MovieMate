# Select and Mark Watched (S-05) Implementation Plan

## Overview

Implement roadmap slice **S-05** (PRD FR-011, FR-012; US-01): let a logged-in operator select one of tonight's three picks to close the decision, mark it watched, and have every watched film excluded from all future candidate retrieval for the account. "Watched" is a **dedup filter only** — not a scoring signal, not a browsable list (PRD Non-Goals).

The retrieval seam already exists and is wired (`fetchCandidates` accepts `excludeMovieIds?: Set<number>` and applies it at `src/lib/tmdb-discover.ts:185`); it is simply never populated. The work is four bounded layers: a new `watched` table, a JSON mark-watched endpoint, one-line retrieval wiring, and the picks UI's first interactive island.

## Current State Analysis

- **Retrieval seam is pre-built but unfed.** `excludeMovieIds?: Set<number>` is declared (`src/lib/tmdb-discover.ts:127`), defaulted (`:150`), and applied in the same pass as id-dedup before a movie enters the candidate pool (`:185` — `if (!byId.has(movie.id) && !exclude.has(movie.id))`). The only references to it in `src/` are the three inside `tmdb-discover.ts`. `recommend-run.ts:124-132` calls `fetchCandidates` **without** `excludeMovieIds`.
- **`recommendRun` already holds the inputs.** Its signature is `recommendRun(supabase, user: { id }, session, second)` (`src/lib/recommend-run.ts:45-50`); the watched-set query slots in before the relaxation ladder (~`recommend-run.ts:97`), and the resulting `Set<number>` passes into the existing `fetchCandidates` call.
- **Persistence convention is established and copyable.** `viewer_profiles.sql` (`supabase/migrations/20260603115857_viewer_profiles.sql`) is a complete owner-scoped table: `id uuid` PK, `user_id uuid ... default auth.uid()`, `created_at`, a `unique (...)` dedup constraint, an owner index, RLS enabled, and four `<table>_<op>_own` policies. The example migration `20260530165958_rls_convention_example.sql:5-6` and `docs/reference/persistence-conventions.md:11` **already name "watched-dedup (S-05)"** as an anticipated table. pgTAP isolation tests live in `supabase/tests/` (`recommendations_isolation.sql` to mirror).
- **Endpoint patterns are settled.** API routes guard in-route via `context.locals.user` (not `PROTECTED_ROUTES`, which is page-only — `src/middleware.ts:4`). JSON style returns a 401 JSON when unauthed (`src/pages/api/health/integrations.ts:14-19`). Writes upsert on the unique constraint (`src/pages/api/profiles.ts:43-52`, `onConflict`). `user_id` always comes from `context.locals.user.id`, never the body. Validation is hand-rolled (no zod in the repo); the Supabase client is untyped (no generated `Database` types — code casts where needed).
- **Picks page is server-only.** `src/pages/sessions/[id]/recommendations.astro` server-fetches the latest run's picks and renders them in a pure Astro `{...}` loop (lines 83-121) with **no React island and no actions**. `tmdb_movie_id` is in the select clause (`:48`) and rendered. Existing islands use `client:load` (`SessionForm`, `ProfileForm`), and every existing mutation is a native HTML `<form>` POST — there is **no `fetch`-from-React mutation** in the repo yet. shadcn `Button` (`src/components/ui/button.tsx`) is the control to reuse.
- **No Vitest yet.** `package.json` has `lint`, `db:reset`, `db:verify`, `build` — no `test`/`typecheck` script. Unit testing is owned by test-plan Phase 1, not this slice. Type checking is `astro check`.

## Desired End State

A logged-in operator views their three picks, clicks "Mark watched" on one card; the card is highlighted, the other two dim, and the button becomes a disabled "Watched ✓". The TMDB id is persisted to a per-account `watched` table (idempotent). On the **next** recommendation run, that film never reappears in any candidate-retrieval attempt. Watched data is partitioned per owner by RLS. Verify: `npm run db:reset && npm run db:verify` pass (including the new isolation test); a local `astro dev` run shows the marked film excluded from a subsequent run's picks.

### Key Discoveries:

- Retrieval seam: `src/lib/tmdb-discover.ts:127,150,185` — accept, default, apply `excludeMovieIds`.
- Wiring gap: `src/lib/recommend-run.ts:124-132` — `fetchCandidates` called without `excludeMovieIds`; `recommend-run.ts:45-50` already receives `supabase` + `user.id`.
- Table to copy: `supabase/migrations/20260603115857_viewer_profiles.sql` (full owner-scoped + 4-policy RLS block); dedup via `unique (user_id, tmdb_movie_id)`.
- TMDB id is `tmdb_movie_id int` on picks (`supabase/migrations/20260606115345_recommendations.sql:33-55`); same plain `int` here.
- Endpoint template: `src/pages/api/health/integrations.ts` (JSON 401 guard); upsert mirror: `src/pages/api/profiles.ts:43-52`.
- UI: `src/pages/sessions/[id]/recommendations.astro:83-121` pure-Astro card loop, no island; `tmdb_movie_id` already available client-side.
- pgTAP mirror: `supabase/tests/recommendations_isolation.sql` → new `supabase/tests/watched_isolation.sql`.

## What We're NOT Doing

- **No `watched_at` column on `recommendation_picks`.** Watched is keyed by `tmdb_movie_id` per account in its own table — it excludes across all future runs regardless of which run surfaced the film (matches the seam and the PRD).
- **No unwatch / undo.** Marking is one-way and idempotent for this slice (PRD does not ask for it).
- **No browsable watch list or count** in the UI or endpoint response — the PRD bans watch history as a list/scoring signal.
- **No relaxation of the exclusion.** A watched film must never be re-recommended; the existing relaxation ladder is the only lever for the pool-shrink edge.
- **No separate "select" persistence.** Select and mark-watched are a single gesture; "select to close the decision" is the same action that records the dedup.
- **No Vitest / unit-test harness** — owned by test-plan Phase 1. This slice's gates are lint, `astro check`, `build`, and `db:verify` (pgTAP).
- **No remote DB apply** — migrations apply locally (`db:reset`); remote apply is human-gated and out of scope.

## Implementation Approach

Build bottom-up: table → endpoint → retrieval wiring → UI. Phases 1-3 are server-only and independent of the UI; Phase 4 depends on Phase 2's endpoint. Each phase copies an established pattern, so the risk is integration correctness (RLS isolation, idempotency, exclusion actually firing), not novel design. The one genuinely new convention is the repo's first `fetch`-from-React mutation (Phase 4), kept deliberately minimal.

## Critical Implementation Details

- **State sequencing (Phase 3):** the watched-set query must run **before** the relaxation ladder and feed the same `Set<number>` into every `fetchCandidates` attempt. Exclusion applies on every attempt and never relaxes — the ladder broadens genres/filters, but the exclude set is constant across all four ladder steps.
- **Pool-shrink edge (Phase 3):** excluding watched films shrinks every attempt's pool. With `pages: 3` (~180 raw candidates/attempt) and the genre-broadening ladder, dev-scale data won't drop below three. If a heavy-watcher on a narrow genre ever exhausts the pool, the existing `candidates.length === 0` / `< 3` path returns "Could not reach TMDB, try again" (`recommend-run.ts:138,142-143`). This is a documented known edge (intersects test-plan Risk #1); no new mitigation and no distinct message in this slice.
- **`user_id` is server-derived (Phase 2):** the request body carries only `tmdb_movie_id`; `user_id` comes from `context.locals.user.id` via the column `default auth.uid()` and the JWT — never from the body.

## Phase 1: Persistence — `watched` table

### Overview

Add an owner-scoped `watched` table with a `(user_id, tmdb_movie_id)` dedup constraint, four RLS policies, an owner index, and a pgTAP isolation test. Pure pattern-copy from `viewer_profiles`.

### Changes Required:

#### 1. New migration — `watched` table

**File**: `supabase/migrations/<generated>_watched.sql` (scaffold with `npm run db:new watched`)

**Intent**: Create the per-account watched-dedup table the retrieval seam consumes. Copy the owner-scoped shape and full RLS block from `viewer_profiles.sql`, swapping the bounded-`slot` domain for a `tmdb_movie_id int` keyed by a `unique (user_id, tmdb_movie_id)` constraint so marking is idempotent and films dedup across runs.

**Contract**: Columns — `id uuid primary key default gen_random_uuid()`; `user_id uuid not null references auth.users (id) on delete cascade default auth.uid()`; `tmdb_movie_id int not null`; `created_at timestamptz not null default now()`; `unique (user_id, tmdb_movie_id)`. Then `create index watched_user_id_idx on public.watched (user_id);`, `alter table public.watched enable row level security;`, and the four policies `watched_select_own` / `watched_insert_own` / `watched_update_own` / `watched_delete_own` scoped to `auth.uid() = user_id` (select/delete `using`; insert `with check`; update both — mirror `viewer_profiles.sql:42-62`). No `updated_at` (rows are immutable once inserted).

#### 2. pgTAP isolation test

**File**: `supabase/tests/watched_isolation.sql`

**Intent**: Prove RLS partitions `watched` by owner — each of two users reads only their own rows and cannot update/delete the other's — and that the `unique (user_id, tmdb_movie_id)` constraint rejects a duplicate mark. Mirror `recommendations_isolation.sql`: one rolled-back transaction, two `auth.users`, impersonation via `set local role authenticated` + `request.jwt.claims`.

**Contract**: Seed two users + one watched row each (as superuser with explicit `user_id`). Assert: user A sees exactly their row and not B's; A cannot delete B's row; a second insert of A's existing `(user_id, tmdb_movie_id)` raises a unique violation. Follow the assertion style and `select * from finish();` / `rollback;` wrapper of the mirrored test.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- pgTAP isolation test passes: `npm run db:verify`
- Lint passes: `npm run lint`

#### Manual Verification:

- `watched` table exists with the four RLS policies and the owner index (inspect via Supabase Studio or `\d+ public.watched`).
- A duplicate `(user_id, tmdb_movie_id)` insert is rejected by the unique constraint.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation before proceeding.

---

## Phase 2: Mark-watched endpoint

### Overview

Add `POST /api/watched` — a JSON API route that guards in-route (401 JSON when unauthed), validates a `tmdb_movie_id`, and idempotently upserts `{ user_id, tmdb_movie_id }` on the unique constraint.

### Changes Required:

#### 1. New API route

**File**: `src/pages/api/watched.ts`

**Intent**: Persist a marked film for the current user. Follow the JSON endpoint style (`health/integrations.ts`) — not the form/redirect style — because the caller is a React `fetch`. Read `tmdb_movie_id` from the JSON body, validate it hand-rolled (positive integer), derive `user_id` from the JWT, and upsert so repeat marks are no-ops.

**Contract**: `export const POST: APIRoute`. Behavior: build the per-request client via `createClient(context.request.headers, context.cookies)` (null-check → 500 JSON `{ error: "Supabase is not configured" }`); if `!context.locals.user` → `401` JSON `{ error: "Unauthorized" }`; parse body, reject a missing/non-integer/non-positive `tmdb_movie_id` → `400` JSON `{ error: ... }`; `supabase.from("watched").upsert({ user_id: user.id, tmdb_movie_id }, { onConflict: "user_id,tmdb_movie_id" })`; on db error → `500` JSON `{ error: error.message }`; on success → `200` JSON `{ ok: true }`. All responses set `Content-Type: application/json`. `user_id` never read from the body.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run astro -- check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Unauthenticated `POST /api/watched` returns `401` JSON.
- Authenticated `POST` with a valid `tmdb_movie_id` returns `200 { ok: true }` and inserts one row; a repeat POST returns `200` and inserts no duplicate (verify row count in Studio).
- `POST` with a missing/invalid `tmdb_movie_id` returns `400` JSON.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation before proceeding.

---

## Phase 3: Retrieval wiring — feed `excludeMovieIds`

### Overview

Populate the existing exclusion seam: query the user's watched TMDB ids into a `Set<number>` before the relaxation ladder and pass it into the `fetchCandidates` call. Exclusion applies on every ladder attempt and never relaxes.

### Changes Required:

#### 1. Query watched set + pass to `fetchCandidates`

**File**: `src/lib/recommend-run.ts`

**Intent**: Before the relaxation ladder (~line 97, after the AI parse / before the `AbortController` budget block, or inside the try before the ladder), query `watched.tmdb_movie_id` for the current user into a `Set<number>`, then pass it as `excludeMovieIds` to the existing `fetchCandidates` call so watched films are filtered in the same pass as id-dedup, before scoring. A query failure degrades to an empty set (no exclusion) rather than failing the run — never block recommendations because the watched read hiccupped.

**Contract**: `const { data } = await supabase.from("watched").select("tmdb_movie_id").eq("user_id", user.id);` → `const watchedIds = new Set<number>((data ?? []).map((r) => Number((r as Record<string, unknown>).tmdb_movie_id)));`. Add `excludeMovieIds: watchedIds` to the `fetchCandidates(tmdb, { ... })` options object at `recommend-run.ts:124-132`. The same `watchedIds` set is used for every ladder attempt (it is constant across the loop). No change to the ladder structure, the budget, or the `< 3` failure path.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run astro -- check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Run a session, mark one of the three picks watched, run the same session again (or a new session with the same genres) on local `astro dev` — the marked film does not reappear in any pick slot.
- A user with no watched rows gets byte-for-byte the same picks as before (empty set = no exclusion).
- Recommendations still succeed (three picks) for a normal account after marking a few films.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation before proceeding.

---

## Phase 4: Picks UI — mark-watched island

### Overview

Make the picks page interactive: extract the pick card into a `client:load` React island with a "Mark watched" button that POSTs to `/api/watched`. On success, highlight the chosen card and dim the other two, and replace the button with a disabled "Watched ✓". On failure, show an inline error and leave the button actionable.

### Changes Required:

#### 1. New React island — picks grid with mark-watched

**File**: `src/components/sessions/PicksGrid.tsx` (new; co-locate with existing `sessions` components)

**Intent**: Render the three pick cards (moving the card markup out of the Astro loop) and own the mark-watched interaction and the highlight/dim state. Introduce the repo's first `fetch`-from-React mutation — keep it minimal. Reuse the shadcn `Button` (`src/components/ui/button.tsx`) with the project's purple styling; preserve the existing card visual structure (role badge, poster, title/year, genres) so only the action + selection states are new.

**Contract**: Props: the array of pick rows (role, tmdb_movie_id, title, poster_path, overview, genre_ids, release_date, vote_average) plus the genre-name map / poster base (or recompute client-side). Local state: `markedId: number | null` and a per-action `error`. On button click: `fetch("/api/watched", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tmdb_movie_id }) })`; on `res.ok` + `{ ok: true }` set `markedId` to that `tmdb_movie_id`; otherwise set an inline error and keep the button enabled. Rendering: when `markedId` is set, the matching card gets a highlight treatment (e.g. ring/brightness) and the other two are dimmed (reduced opacity), and the chosen card's button becomes a disabled "Watched ✓". Marking is one-way (no unwatch); a second card's button stays clickable but the spec treats the first mark as the closed decision — keep behavior simple (latest mark wins for the highlight). Display order (`ROLE_RANK`) and labels (`ROLE_LABEL`) move into or are passed to the island.

#### 2. Mount the island in the Astro page

**File**: `src/pages/sessions/[id]/recommendations.astro`

**Intent**: Replace the pure-Astro card loop (lines 83-121) with `<PicksGrid client:load picks={picks} />`, keeping the page's server-side fetch (lines 34-52), the empty-state branch (lines 70-80), the header, and the Layout wrapper unchanged. Pass the already-fetched `picks` (and any genre/poster helpers the island needs) as props.

**Contract**: Keep the server fetch and `PickRow` typing as the source of truth; the island receives serializable props only. The empty-state branch (`picks.length === 0`) stays server-rendered. No change to what the page fetches (`tmdb_movie_id` is already selected; pick `id` is still not needed).

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run astro -- check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Clicking "Mark watched" on a card highlights it, dims the other two, and replaces its button with a disabled "Watched ✓".
- The marked film is absent from a subsequent run's picks (end-to-end with Phase 3).
- A failed POST (e.g. simulated 500) shows an inline error and leaves the button clickable; no silent failure.
- The empty-state ("No recommendations yet") still renders for a session with no run.
- Page renders correctly on local `astro dev` (workerd runtime).

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- None in this slice — Vitest is owned by test-plan Phase 1. The exclusion logic is exercised via the pgTAP isolation test (Phase 1) and manual end-to-end verification (Phases 3-4).

### Integration Tests:

- pgTAP isolation test (`watched_isolation.sql`) is the integration-level guarantee for owner partitioning + dedup, run by `npm run db:verify`.

### Manual Testing Steps:

1. `npm run db:reset && npm run db:verify` — migration applies, all isolation tests (incl. `watched`) pass.
2. On `astro dev`: sign in, run a session, mark one pick watched — confirm highlight/dim + "Watched ✓".
3. Re-run the same session — confirm the marked film is excluded from all three slots.
4. Mark several films, run again — confirm three picks still return (no pool-shrink failure at dev scale).
5. Unauthenticated `POST /api/watched` → 401 JSON; duplicate mark → no second row.

## Performance Considerations

One extra owner-scoped `select` per recommendation run (indexed by `watched_user_id_idx`), negligible against the TMDB retrieval budget. The exclusion check is an O(1) `Set.has` inside the existing dedup pass — no added passes. The watched read runs once and is reused across all ladder attempts.

## Migration Notes

New table only; no data migration. Applies locally via `npm run db:reset`. Remote apply is human-gated and out of scope for this slice.

## References

- Research: `context/changes/select-and-mark-watched/research.md`
- Seam: `src/lib/tmdb-discover.ts:127,150,185`
- Wiring gap: `src/lib/recommend-run.ts:45-50,124-132,138,142`
- Table to copy: `supabase/migrations/20260603115857_viewer_profiles.sql`
- Endpoint template: `src/pages/api/health/integrations.ts`; upsert: `src/pages/api/profiles.ts:43-52`
- UI: `src/pages/sessions/[id]/recommendations.astro:83-121`
- pgTAP mirror: `supabase/tests/recommendations_isolation.sql`
- Convention: `docs/reference/persistence-conventions.md`
- Test-plan Risk #1 (pool shrink): `context/foundation/test-plan.md:43`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persistence — watched table

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:reset` — e094fd0
- [x] 1.2 pgTAP isolation test passes: `npm run db:verify` — e094fd0
- [x] 1.3 Lint passes: `npm run lint` — e094fd0

#### Manual

- [ ] 1.4 `watched` table exists with four RLS policies and the owner index
- [ ] 1.5 Duplicate `(user_id, tmdb_movie_id)` insert is rejected by the unique constraint

### Phase 2: Mark-watched endpoint

#### Automated

- [x] 2.1 Type check passes: `npm run astro -- check`
- [x] 2.2 Lint passes: `npm run lint`
- [x] 2.3 Build passes: `npm run build`

#### Manual

- [ ] 2.4 Unauthenticated POST returns 401 JSON
- [ ] 2.5 Valid POST returns 200 `{ ok: true }` and inserts one row; repeat POST inserts no duplicate
- [ ] 2.6 Invalid/missing `tmdb_movie_id` returns 400 JSON

### Phase 3: Retrieval wiring — feed excludeMovieIds

#### Automated

- [ ] 3.1 Type check passes: `npm run astro -- check`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`

#### Manual

- [ ] 3.4 Marked film does not reappear in a subsequent run's picks
- [ ] 3.5 User with no watched rows gets identical picks (empty set = no exclusion)
- [ ] 3.6 Recommendations still return three picks after marking a few films

### Phase 4: Picks UI — mark-watched island

#### Automated

- [ ] 4.1 Type check passes: `npm run astro -- check`
- [ ] 4.2 Lint passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build`

#### Manual

- [ ] 4.4 Clicking "Mark watched" highlights the card, dims the other two, shows disabled "Watched ✓"
- [ ] 4.5 Marked film is absent from a subsequent run's picks (end-to-end)
- [ ] 4.6 Failed POST shows inline error and leaves button clickable (no silent failure)
- [ ] 4.7 Empty-state still renders for a session with no run
- [ ] 4.8 Page renders correctly on local `astro dev` (workerd)
