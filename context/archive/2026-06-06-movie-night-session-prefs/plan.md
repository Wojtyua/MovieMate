# Start a Movie-Night Session and Save Preferences (S-02) — Implementation Plan

## Overview

Add MovieMate's second product table, `movie_night_sessions`, and the UI/API to start a movie-night session and save its preferences. A logged-in user opens `/sessions`, fills the evening's constraints — mood, preferred genres, excluded genres, runtime limit, intensity, and a free-text note — and saves; each save starts a **new** session row (one row per evening), and the most recent session is editable in place. This is roadmap slice S-02 (`movie-night-session-prefs`), satisfying FR-003 (start a session) and FR-004 (save the six preference fields), and it establishes the **input contract S-03 reads** to retrieve and score candidates.

## Current State Analysis

- **The owner-scoped RLS pattern is proven by S-01 and is the template to mirror.** `supabase/migrations/20260603115857_viewer_profiles.sql` applies `docs/reference/persistence-conventions.md`: `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()`, a `user_id` index, `enable row level security`, and four per-command policies scoped by `auth.uid() = user_id`. `supabase/tests/` holds the pgTAP isolation fixtures that prove teeth by impersonating two users. `movie_night_sessions` is the second real product table and follows the same checklist (`persistence-conventions.md:122-132`).
- **The per-request Supabase client already enforces RLS with zero changes.** `src/lib/supabase.ts:5-24` builds the client from the anon key + the user's cookie JWT, so PostgREST runs every query as the authenticated user. A table + policies is sufficient — no typed wrapper.
- **The form-POST → upsert API → redirect-with-`?error=` flow is established.** `src/pages/api/profiles.ts` reads `formData()`, validates, writes via the RLS client, and `context.redirect`s back with `?error=<encoded>&slot=<n>` on failure or `?saved=<n>` on success. `src/pages/profiles.astro` loads rows server-side (RLS-scoped), maps them into props, and hydrates a React island with `client:load`.
- **Genre fields and their validation already exist.** `src/lib/genres.ts` exports `MOVIE_GENRES` (TMDB id↔name) and `isKnownGenreId`; `api/profiles.ts:18-25` parses repeated form fields into a de-duped, validated `int[]` of TMDB genre IDs. Session preferred/excluded genres reuse this verbatim so S-03's TMDB discover query (FR-005) needs no name→id translation.
- **TMDB discover hard-filters by genre, runtime, rating, release window** (`src/lib/tmdb.ts`, FR-005). Of FR-004's six fields only **runtime** and **genres** are TMDB hard filters; **mood** and **intensity** are local-scoring signals (FR-007), not external query params. Rating/release-window are derived by S-03 at retrieval time — not user-entered fields in this slice.
- **Routes are guarded by a prefix list.** `src/middleware.ts:4` `PROTECTED_ROUTES = ["/dashboard", "/profiles"]`; the middleware redirects unauthenticated users to `/auth/signin` and populates `context.locals.user`.
- **No app-level test suite.** AGENTS.md: DB tests use pgTAP under `supabase/tests/`, run via `npm run db:verify`; app-level testing arrives in a later module.

## Desired End State

A logged-in user visits `/sessions`, sees a "start a movie night" form, fills mood / preferred genres / excluded genres / runtime limit / intensity / note (all optional, sensible defaults), and saves. A new `movie_night_sessions` row is created scoped to their account, and the page redirects back showing that just-created session in editable mode (re-saving it updates the same row rather than creating another). A second user signing in sees none of the first user's sessions. Verified by: `npm run db:verify` passes (isolation), the page loads behind auth, creating round-trips, editing the latest session updates in place, and a second account cannot see the first's rows.

### Key Discoveries:

- Owner-scoped RLS template + new-table checklist: `docs/reference/persistence-conventions.md:122-132`.
- The S-01 table to mirror (minus the slot cap): `supabase/migrations/20260603115857_viewer_profiles.sql`.
- Validated repeated-genre-field parsing to reuse: `src/pages/api/profiles.ts:18-25` + `src/lib/genres.ts`.
- Form-POST → write → redirect-with-`?error=` precedent: `src/pages/api/profiles.ts:11-15,77-82`.
- Server-side RLS-scoped load + island hydration precedent: `src/pages/profiles.astro:16-23,45-66`.
- Route protection is a prefix list: `src/middleware.ts:4`.

## What We're NOT Doing

- **No slot cap and no upsert-by-slot.** Sessions are unbounded over time; each "start" is a new row. (This is the one structural difference from `viewer_profiles`.)
- **No session history list or browsable past-sessions view** — only the new-session form + edit-the-latest. A history/list view, if ever wanted, belongs with S-03/S-05.
- **No `/sessions/[id]` dynamic route** — editing targets the user's most recent session by id, fetched server-side; no per-id page in this slice.
- **No rating ceiling or release-window fields** — out of FR-004; S-03 derives those at retrieval time.
- **No recommendations, scoring, candidate retrieval, or "Get recommendations" action** — that is S-03. This slice stops at persisting session preferences.
- **No fetching genres/moods from TMDB at runtime** — static consts, validated server-side.
- **No app-level test framework** — pgTAP only, per AGENTS.md scope.
- **No pushing this migration to the hosted DB** — remote application is human-gated (`persistence-conventions.md:108-119`).

## Implementation Approach

Follow the codebase's prescribed orderings: for the data layer, the new-table checklist (schema → index → RLS → policies → pgTAP test → `db:reset && db:verify` → teeth check); for the feature, data → API → UI. The session shape is `(id, user_id, mood text, preferred_genre_ids int[], excluded_genre_ids int[], runtime_limit_minutes int, intensity text, note text, timestamps)` — no `slot`, no unique constraint, so a user accumulates many rows. The API is a single `POST /api/sessions` that **inserts** a new row when no `session_id` is submitted and **updates** the named row (RLS-scoped) when one is present, then redirects. The UI is one protected page rendering the new-session form, which after a save reloads showing the latest session bound to its id for in-place editing. `mood` and `intensity` are constrained to fixed vocabularies validated exactly like genre IDs (a new `src/lib/session-options.ts` mirroring `genres.ts`).

## Critical Implementation Details

- **Create vs edit is keyed by a hidden `session_id` field, not by a slot.** Absent/empty `session_id` → `insert`; present → `update ... where id = <session_id>` (RLS already constrains it to the owner, but the handler should still scope the update by id). This is the analog of S-01's upsert-by-slot, adapted to unbounded rows. Re-posting the latest session's form must update that row, not append a new one.
- **`mood` and `intensity` are stored as text but constrained to a fixed vocabulary** validated server-side (`isKnownMood`, `isKnownIntensity`) — the same defense `isKnownGenreId` provides. A DB `check` on `intensity in ('low','medium','high')` is appropriate (small, stable ordinal set); `mood` is validated in the API against `session-options.ts` rather than a DB enum so the vocabulary can grow without a migration.
- **`runtime_limit_minutes` is nullable** ("no limit" is a real choice). S-03 maps a non-null value to TMDB `with_runtime.lte`; null means the runtime hard filter is omitted.

## Phase 1: Data layer — `movie_night_sessions` table + RLS + pgTAP

### Overview

Create the second product table following the owner-scoped RLS convention — unbounded rows per user (no slot cap) — and prove isolation with a pgTAP test mirroring the S-01 fixture.

### Changes Required:

#### 1. Migration: `movie_night_sessions`

**File**: `supabase/migrations/<timestamp>_movie_night_sessions.sql` (scaffold via `npm run db:new movie_night_sessions`)

**Intent**: Define the owner-scoped `movie_night_sessions` table holding one row per started session and its six FR-004 preference fields, with RLS enabled and the four per-command policies, so FR-001 holds at the data layer and S-03 has a stable per-session input contract.

**Contract**: Table `public.movie_night_sessions` with columns: `id uuid primary key default gen_random_uuid()`; `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()`; `mood text`; `preferred_genre_ids int[] not null default '{}'`; `excluded_genre_ids int[] not null default '{}'`; `runtime_limit_minutes int` (nullable; optional `check (runtime_limit_minutes is null or runtime_limit_minutes > 0)`); `intensity text not null default 'medium' check (intensity in ('low','medium','high'))`; `note text`; `created_at timestamptz not null default now()`; `updated_at timestamptz not null default now()`. **No `slot`, no unique constraint** — rows are unbounded per user. Index: `movie_night_sessions_user_id_idx on (user_id)`. `enable row level security` + the four policies (`movie_night_sessions_{select,insert,update,delete}_own`) scoped by `auth.uid() = user_id`, copied in shape from `persistence-conventions.md:48-62`. (No snippet — direct application of the documented template; see `viewer_profiles.sql` for the worked example.)

#### 2. pgTAP test: isolation

**File**: `supabase/tests/movie_night_sessions_isolation.sql`

**Intent**: Prove two impersonated users each see only their own sessions and cannot read, update, or delete the other's.

**Contract**: Mirror `supabase/tests/rls_example_isolation.sql` / the `viewer_profiles` isolation fixture (single rolled-back transaction, `set local role authenticated` + `request.jwt.claims` per user, seed users via `insert into auth.users (id) ...`). Assert: (a) each user sees only their own rows on `select`; (b) a user cannot update or delete the other's row; (c) a user can insert multiple sessions for themselves (confirming there is intentionally no slot cap). No slot-cap assertion (unlike S-01).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- pgTAP tests pass (isolation + multi-insert): `npm run db:verify`
- Lint passes: `npm run lint`

#### Manual Verification:

- Teeth check: drop one policy, `npm run db:verify` fails, then `npm run db:reset` restores green — confirming the test isn't vacuous.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation of the teeth check before proceeding.

---

## Phase 2: API + session-options reference

### Overview

Add the static mood/intensity vocabulary with validators, the `/api/sessions` create-or-update endpoint, and protect the `/sessions` route.

### Changes Required:

#### 1. Session-options reference

**File**: `src/lib/session-options.ts`

**Intent**: Provide the canonical mood and intensity vocabularies for the UI selects and for server-side validation of submitted values, without any runtime external call — mirroring `genres.ts`.

**Contract**: Export `MOODS: readonly { id: string; label: string }[]` (a small fixed set, e.g. `light`, `funny`, `tense`, `thrilling`, `emotional`, `thought-provoking`, `cozy`, `dark`, `epic`, `romantic`) and `INTENSITIES: readonly { id: 'low'|'medium'|'high'; label: string }[]`. Export `isKnownMood(id: string): boolean` and `isKnownIntensity(id: string): boolean`, each backed by a `Set` like `genres.ts:38-43`. `intensity` ids must match the DB `check` set; `mood` ids are the stored text values.

#### 2. Sessions create-or-update endpoint

**File**: `src/pages/api/sessions.ts`

**Intent**: Accept a session-preferences submission, validate it, INSERT a new session (or UPDATE the named one) scoped to the authenticated user, and redirect back to `/sessions` with success or `?error=`.

**Contract**: `export const POST: APIRoute`. Reads `session_id` (optional), `mood`, `preferred_genre_ids` (repeated), `excluded_genre_ids` (repeated), `runtime_limit_minutes`, `intensity`, `note` from `formData()`. Validates: genre IDs all known and preferred/excluded disjoint (reuse the `parseGenreIds` + disjoint logic from `api/profiles.ts:18-25,47-49`); `mood` empty or `isKnownMood`; `intensity` empty (→ default `medium`) or `isKnownIntensity`; `runtime_limit_minutes` empty (→ null) or a positive integer. All fields optional. Builds the RLS client via `createClient` (null → redirect with config error, mirroring `profiles.ts:54-57`); redirect to `/auth/signin` if no `context.locals.user`. If `session_id` present: `update` that row's fields `where id = session_id` (RLS scopes to owner) and set `updated_at`; else `insert` a new row (`user_id` from `user.id`). On error redirect `/sessions?error=<encoded>`; on success redirect `/sessions?saved=<id>` (so the page can show the latest session and a confirmation). Mirror the `fail()` redirect-with-encoded-error idiom from `profiles.ts:11-15`.

#### 3. Protect the route

**File**: `src/middleware.ts`

**Intent**: Require auth for `/sessions` like `/dashboard` and `/profiles`.

**Contract**: Add `"/sessions"` to `PROTECTED_ROUTES` (`src/middleware.ts:4`).

### Success Criteria:

#### Automated Verification:

- Type check / build passes: `npx astro sync && npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Unauthenticated GET `/sessions` redirects to `/auth/signin`.
- A POST with an unknown genre id is rejected with a visible error and persists nothing.
- A POST with an out-of-vocabulary `mood` or `intensity` is rejected.
- A POST with preferred and excluded sharing a genre is rejected.

**Implementation Note**: Pause for human confirmation after manual verification before Phase 3.

---

## Phase 3: UI — `/sessions` page with new-session form + edit-latest

### Overview

Build the protected page that renders the start-a-session form and, after a save, shows the latest session bound to its id for in-place editing, plus a dashboard entry point.

### Changes Required:

#### 1. Sessions page

**File**: `src/pages/sessions.astro`

**Intent**: Load the user's most recent session server-side (RLS-scoped) and render the preferences form — empty for a fresh start, or pre-filled and bound to the latest session's id after a save — surfacing any `?error=`/`?saved=`.

**Contract**: Frontmatter builds the RLS client and selects this user's `movie_night_sessions` ordered by `created_at desc limit 1` to get the latest session (id + the six fields). Reads `error`/`saved` from `Astro.url.searchParams`; when `saved=<id>` matches the latest row, render in edit mode (pass `sessionId`) and show a saved confirmation. Renders inside `Layout` using the existing `bg-cosmic` styling vocabulary from `profiles.astro`. Hydrates the form island with `client:load`. Mirror `profiles.astro:16-30,32-67` structure (header with "← Dashboard" link, intro copy, card wrapper).

#### 2. Session form island

**File**: `src/components/sessions/SessionForm.tsx` (and small sub-parts as needed)

**Intent**: The preferences editor that posts to `/api/sessions`, with a mood select, intensity select, runtime-limit select, two genre multi-selects (preferred/excluded), and a note field.

**Contract**: Props: optional `sessionId: string | null`, initial `mood`, `preferredGenreIds`, `excludedGenreIds`, `runtimeLimitMinutes`, `intensity`, `note`, and `serverError`/`justSaved`. Renders a `<form method="POST" action="/api/sessions">` with a hidden `session_id` field (empty for a new session). Genre multi-selects source `MOVIE_GENRES` (`src/lib/genres.ts`) and submit repeated `preferred_genre_ids` / `excluded_genre_ids`, with excluded options disjoint from preferred — reuse the selection approach from `ProfileForm` (`src/components/profiles/ProfileForm.tsx`). Mood/intensity selects source `MOODS`/`INTENSITIES` (`src/lib/session-options.ts`); runtime select offers presets (90/105/120/150/180 min + "No limit"→empty). Reuse `ServerError`/`SubmitButton` from `src/components/auth/`. All fields optional (no client-side required validation); no-JS fallback still posts. Provide a "Start another session" affordance that clears `session_id` (e.g. a link to `/sessions` for a fresh form).

#### 3. Dashboard entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Give the user a way to reach `/sessions`.

**Contract**: Add a link/button to `/sessions` in the dashboard card, styled consistently with the existing `/profiles` link / sign-out control.

### Success Criteria:

#### Automated Verification:

- Build/type check passes: `npx astro sync && npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Logged-in user opens `/sessions`, fills the form (mood, a few preferred/excluded genres, runtime, intensity, note), saves, and the values persist on reload as the latest session.
- Re-saving the shown (latest) session updates the same row — no second row is created (verify via a quick DB count or by re-load).
- "Start another session" yields an empty form, and saving it creates a distinct new row (the previous session is untouched).
- Starting a session with everything blank/default succeeds (all fields optional).
- A second account sees an empty form, not the first account's session.
- Unauthenticated `/sessions` redirects to sign-in.

**Implementation Note**: Pause for human confirmation of manual testing; this completes the slice.

---

## Testing Strategy

### Unit Tests:

- None at the app level (no suite exists yet; out of scope per AGENTS.md).

### Integration Tests (pgTAP):

- `movie_night_sessions_isolation.sql`: two impersonated users see only their own rows; cannot update/delete the other's; a user can insert multiple sessions (no slot cap).

### Manual Testing Steps:

1. Sign in; open `/sessions`; confirm an empty start-a-session form.
2. Fill mood, preferred/excluded genres, runtime, intensity, note; save; reload; values persist as the latest session.
3. Re-edit the shown session; save; confirm update (no extra row) via a DB count or re-load.
4. Use "Start another session"; save a second session; confirm a distinct new row and the first untouched.
5. Save a fully-blank/default session; confirm it succeeds.
6. Submit an unknown genre id / out-of-vocabulary mood / overlapping preferred+excluded; confirm error + no write.
7. Sign in as a second account; confirm an empty form (no cross-account leakage).
8. Confirm unauthenticated `/sessions` redirects to sign-in.

## Performance Considerations

Trivial scale (small users, few rows/user). The `user_id` index satisfies the RLS predicate; the latest-session load is `order by created_at desc limit 1`. Static genre/mood/intensity lists avoid any TMDB subrequest on this page, keeping `/sessions` independent of external availability.

## Migration Notes

New table only; no existing data to migrate. Local-only application (`npm run db:reset`); pushing to the hosted DB is a human-gated step (`persistence-conventions.md:108-119`) and is not part of this slice. `rls_example` is left in place per the convention doc.

## References

- Persistence convention + new-table checklist: `docs/reference/persistence-conventions.md`
- S-01 table to mirror (minus slot cap): `supabase/migrations/20260603115857_viewer_profiles.sql`
- Reference pgTAP test: `supabase/tests/rls_example_isolation.sql`
- RLS client: `src/lib/supabase.ts:5-24`
- Form-POST + redirect + genre parsing precedent: `src/pages/api/profiles.ts`
- Server-side load + island hydration precedent: `src/pages/profiles.astro`, `src/components/profiles/ProfileForm.tsx`
- Genre reference to reuse: `src/lib/genres.ts`
- Route protection: `src/middleware.ts:4`
- TMDB hard-filter capabilities: `src/lib/tmdb.ts`, FR-005; TMDB docs https://developer.themoviedb.org/docs/getting-started
- Roadmap slice: `context/foundation/roadmap.md` (S-02)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer — movie_night_sessions table + RLS + pgTAP

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:reset` — 71b575a
- [x] 1.2 pgTAP tests pass (isolation + multi-insert): `npm run db:verify` — 71b575a
- [x] 1.3 Lint passes: `npm run lint` — 71b575a

#### Manual

- [x] 1.4 Teeth check: drop a policy → `db:verify` fails → `db:reset` restores green — 71b575a

### Phase 2: API + session-options reference

#### Automated

- [x] 2.1 Type check / build passes: `npx astro sync && npm run build` — 1e871ea
- [x] 2.2 Lint passes: `npm run lint` — 1e871ea

#### Manual

- [x] 2.3 Unauthenticated `/sessions` redirects to `/auth/signin` — 1e871ea
- [x] 2.4 Unknown genre id is rejected, nothing persisted — 1e871ea
- [x] 2.5 Out-of-vocabulary mood or intensity is rejected — 1e871ea
- [x] 2.6 Overlapping preferred + excluded genre is rejected — 1e871ea

### Phase 3: UI — /sessions page with new-session form + edit-latest

#### Automated

- [x] 3.1 Build/type check passes: `npx astro sync && npm run build` — 1e871ea
- [x] 3.2 Lint passes: `npm run lint` — 1e871ea

#### Manual

- [x] 3.3 Fill + save a session; values persist on reload as the latest session — 1e871ea
- [x] 3.4 Re-save the shown session updates it (no duplicate row) — 1e871ea
- [x] 3.5 "Start another session" creates a distinct new row; previous untouched — 1e871ea
- [x] 3.6 Fully-blank/default session saves successfully — 1e871ea
- [x] 3.7 Second account sees an empty form (no cross-account leakage) — 1e871ea
