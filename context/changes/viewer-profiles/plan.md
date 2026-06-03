# Create and Edit Two Viewer Profiles (S-01) — Implementation Plan

## Overview

Add MovieMate's first product table, `viewer_profiles`, and the UI/API to manage it. A logged-in user can create and edit **exactly two** viewer profiles — each holding one person's taste (preferred genres, excluded genres, a free-text note) — and sees only their own data. This is roadmap slice S-01 (`viewer-profiles`), satisfying FR-001 (own-data isolation) and FR-002 (two profiles), and it establishes the taste-field contract that S-03 scoring (FR-007) will consume.

## Current State Analysis

- **Persistence pattern is fully prescribed but unused by any product table.** `docs/reference/persistence-conventions.md` plus the reference migration `supabase/migrations/20260530165958_rls_convention_example.sql` (`rls_example`) define the owner-scoped RLS template: `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()`, an index on `user_id`, `enable row level security`, and four per-command policies scoped by `auth.uid() = user_id`. A pgTAP isolation test (`supabase/tests/rls_example_isolation.sql`) proves it has teeth by impersonating two users. `viewer_profiles` is the first real product table.
- **The per-request Supabase client already enforces RLS with zero changes.** `src/lib/supabase.ts:5-24` builds a client from the anon key + the user's cookie JWT, so PostgREST runs every query as the authenticated user. No typed wrapper is needed — a table + policies is sufficient.
- **Auth flow is the UI/API template to mirror.** Pages hydrate a React island with `client:load` (`src/pages/auth/signin.astro:16`), forms `method="POST"` to an `APIRoute` under `src/pages/api/` (`src/components/auth/SignInForm.tsx:43`, `src/pages/api/auth/signup.ts`), and the handler builds the RLS client and redirects back with `?error=<encoded>` on failure. Reusable form primitives exist: `FormField`, `SubmitButton`, `ServerError`, `PasswordToggle` under `src/components/auth/`.
- **Routes are guarded by a prefix list.** `src/middleware.ts:4` `PROTECTED_ROUTES = ["/dashboard"]`; the middleware redirects unauthenticated users to `/auth/signin` and populates `context.locals.user`.
- **TMDB discover filters by genre ID.** `src/lib/tmdb.ts` shows the integration uses raw `fetch` against TMDB. TMDB's discover endpoint (used by S-03/FR-005) filters by numeric genre IDs, so storing genre preferences as TMDB IDs avoids a name→ID translation downstream.
- **No app-level test suite.** AGENTS.md: "there is no app-level test suite yet"; DB tests use pgTAP under `supabase/tests/`, run via `npm run db:verify`. Testing/quality gates arrive in a later module.

## Desired End State

A logged-in user visits `/profiles`, sees two profile editors (slots 1 and 2) pre-filled with any existing data, edits a profile's name / preferred genres / excluded genres / note, saves, and the change persists scoped to their account. A second user signing in sees only their own profiles. Attempting to exceed two profiles is structurally impossible. Verified by: `npm run db:verify` passes (isolation + slot-cap), the page loads behind auth, saving round-trips, and a second account cannot see the first's rows.

### Key Discoveries:

- Owner-scoped RLS template + new-table checklist: `docs/reference/persistence-conventions.md:122-132`.
- RLS works with no client change because of the cookie-JWT client: `src/lib/supabase.ts:5-24`.
- Form-POST-then-redirect-with-`?error=` precedent: `src/pages/api/auth/signup.ts:21-25`, consumed in `src/pages/auth/signin.astro:5`.
- Route protection is a prefix list: `src/middleware.ts:4`.
- pgTAP impersonation is mandatory (owner/superuser bypass RLS): `docs/reference/persistence-conventions.md:84-105`.

## What We're NOT Doing

- No delete/clear of a profile slot — edit-only (upsert). FR-002 says "create and edit".
- No fetching the genre list from TMDB at runtime — a static const is used instead.
- No app-level test framework (Vitest etc.) — pgTAP only, per AGENTS.md scope.
- No scoring, no session, no recommendations — those are S-02/S-03.
- No requirement that both profiles be filled before saving — slots are independent.
- No pushing this migration to the hosted DB — remote application is human-gated (`persistence-conventions.md:108-119`).

## Implementation Approach

Follow the codebase's prescribed orderings: for the data layer, the new-table checklist (schema → index → RLS → policies → pgTAP test → `db:reset && db:verify` → teeth check); for the feature, data → API → UI. The profile shape is `(user_id, slot, display_name, preferred_genre_ids int[], excluded_genre_ids int[], note text, timestamps)` with `unique(user_id, slot)` and `check (slot in (1,2))` making "exactly two" structural. The API is a single `POST /api/profiles` that upserts one slot via `on conflict (user_id, slot)` and redirects. The UI is one protected page rendering two editors built from the existing auth form primitives.

## Critical Implementation Details

- **The slot cap is enforced by two constraints together**, not the unique index alone: `check (slot in (1,2))` bounds the slot domain and `unique (user_id, slot)` prevents duplicates — together they cap a user at two rows. The pgTAP test must assert a third insert (slot 3, or duplicate slot) fails.
- **Upsert must target the slot, not the id.** `on conflict (user_id, slot) do update` is what makes "create or edit slot N" idempotent; the insert policy's `with check (auth.uid() = user_id)` and the update policy must both hold for upsert to pass under RLS.

## Phase 1: Data layer — `viewer_profiles` table + RLS + pgTAP

### Overview

Create the first product table following the owner-scoped RLS convention, with two-slot structure, and prove isolation + the slot cap with a pgTAP test.

### Changes Required:

#### 1. Migration: `viewer_profiles`

**File**: `supabase/migrations/<timestamp>_viewer_profiles.sql` (scaffold via `npm run db:new viewer_profiles`)

**Intent**: Define the owner-scoped `viewer_profiles` table holding the two-slot taste profiles, with RLS enabled and the four per-command policies, so FR-001 holds at the data layer and FR-002's "exactly two" is structural.

**Contract**: Table `public.viewer_profiles` with columns: `id uuid primary key default gen_random_uuid()`; `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()`; `slot smallint not null check (slot in (1,2))`; `display_name text not null`; `preferred_genre_ids int[] not null default '{}'`; `excluded_genre_ids int[] not null default '{}'`; `note text`; `created_at timestamptz not null default now()`; `updated_at timestamptz not null default now()`. Constraints: `unique (user_id, slot)`. Index: `viewer_profiles_user_id_idx on (user_id)`. `enable row level security` + the four policies (`viewer_profiles_{select,insert,update,delete}_own`) scoped by `auth.uid() = user_id`, copied verbatim in shape from `persistence-conventions.md:48-62`. (No snippet — this is a direct application of the documented template.)

#### 2. pgTAP test: isolation + slot cap

**File**: `supabase/tests/viewer_profiles_isolation.sql`

**Intent**: Prove two impersonated users each see only their own profiles and cannot tamper with the other's, and that the slot constraints cap a user at two profiles.

**Contract**: Mirror `supabase/tests/rls_example_isolation.sql` structure (single rolled-back transaction, `set local role authenticated` + `request.jwt.claims` per user). Assert: (a) each user sees only their own rows on `select`; (b) a user cannot update/delete the other's row; (c) inserting a third distinct slot value or a duplicate `(user_id, slot)` fails. Seed two users via `insert into auth.users (id) ...` as the existing fixture does.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- pgTAP tests pass (isolation + slot cap): `npm run db:verify`
- Lint passes: `npm run lint`

#### Manual Verification:

- Teeth check: drop one policy (or the unique constraint), `npm run db:verify` fails, then `npm run db:reset` restores green — confirming the test isn't vacuous.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation of the teeth check before proceeding.

---

## Phase 2: API + genre reference

### Overview

Add the static TMDB genre lookup, the `/api/profiles` upsert endpoint, and protect the `/profiles` route.

### Changes Required:

#### 1. Static genre reference

**File**: `src/lib/genres.ts`

**Intent**: Provide the canonical TMDB movie-genre id↔name list for the UI multi-select and for validating submitted genre IDs, without a runtime TMDB call.

**Contract**: Export `MOVIE_GENRES: readonly { id: number; name: string }[]` (TMDB's ~19 standard movie genres) and a helper to validate that an id is a known genre. IDs must match TMDB's official genre IDs so S-03's discover call needs no translation.

#### 2. Profiles upsert endpoint

**File**: `src/pages/api/profiles.ts`

**Intent**: Accept a single-slot profile submission, validate it, upsert it scoped to the authenticated user, and redirect back to `/profiles` with success or `?error=`.

**Contract**: `export const POST: APIRoute`. Reads `slot`, `display_name`, `preferred_genre_ids`, `excluded_genre_ids`, `note` from `formData()`. Validates: `slot ∈ {1,2}`; `display_name` non-empty (required); genre IDs are all known per `genres.ts`; preferred/excluded sets are disjoint. Builds the RLS client via `createClient` (return null → redirect with config error, mirroring `signup.ts:10-12`). Upserts into `viewer_profiles` on conflict `(user_id, slot)`. On error redirects `/profiles?error=<encoded>&slot=<n>`; on success redirects `/profiles` (optionally `?saved=<n>`). Mirror the redirect-with-encoded-error idiom from `src/pages/api/auth/signup.ts:21-25`.

#### 3. Protect the route

**File**: `src/middleware.ts`

**Intent**: Require auth for `/profiles` like `/dashboard`.

**Contract**: Add `"/profiles"` to `PROTECTED_ROUTES` (`src/middleware.ts:4`).

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro sync && npm run build` (or `astro check`)
- Lint passes: `npm run lint`

#### Manual Verification:

- Unauthenticated GET `/profiles` redirects to `/auth/signin`.
- A POST with a blank `display_name` redirects back with a visible error and persists nothing.
- A POST with an unknown genre id is rejected.

**Implementation Note**: Pause for human confirmation after manual verification before Phase 3.

---

## Phase 3: UI — `/profiles` page with two slot editors

### Overview

Build the protected page that loads both slots server-side and renders two editors, plus a dashboard entry point.

### Changes Required:

#### 1. Profiles page

**File**: `src/pages/profiles.astro`

**Intent**: Load the user's existing two profiles server-side (RLS-scoped) and render two slot editors, surfacing any `?error=`.

**Contract**: Frontmatter builds the RLS client, selects this user's `viewer_profiles` rows, and maps them by `slot` into two editor props (slot 1, slot 2), passing existing values or empty defaults. Reads `error`/`saved` from `Astro.url.searchParams`. Renders inside `Layout` using the existing `bg-cosmic` styling vocabulary from `dashboard.astro`/`signin.astro`. Hydrates the editor island(s) with `client:load`.

#### 2. Profile editor island

**File**: `src/components/profiles/ProfileForm.tsx` (and any small sub-parts as needed)

**Intent**: A per-slot editor that posts to `/api/profiles`, with name-required client validation and a genre multi-select for preferred/excluded genres.

**Contract**: Props: `slot: 1 | 2`, initial `displayName`, `preferredGenreIds`, `excludedGenreIds`, `note`, and `serverError`. Renders a `<form method="POST" action="/api/profiles">` with a hidden `slot` field. Reuses `FormField`/`SubmitButton`/`ServerError` from `src/components/auth/`. Genre selection is a multi-select sourced from `MOVIE_GENRES` (`src/lib/genres.ts`), submitting genre IDs; excluded options disjoint from preferred. Client-side validation: `display_name` required (mirror `SignInForm.tsx:18-30` validate/clearError pattern); preventDefault on invalid. No-JS fallback still posts.

#### 3. Dashboard entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Give the user a way to reach `/profiles`.

**Contract**: Add a link/button to `/profiles` in the dashboard card, styled consistently with the existing sign-out control.

### Success Criteria:

#### Automated Verification:

- Build/type check passes: `npx astro sync && npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Logged-in user opens `/profiles`, fills slot 1 (name + a few preferred/excluded genres + note), saves, and the values persist on reload.
- Editing slot 2 independently works and does not disturb slot 1.
- Re-saving slot 1 updates it (no duplicate row created).
- A second account sees empty slots, not the first account's data.
- Saving with an empty name shows the server error and nothing is written.

**Implementation Note**: Pause for human confirmation of manual testing; this completes the slice.

---

## Testing Strategy

### Unit Tests:

- None at the app level (no suite exists yet; out of scope per AGENTS.md).

### Integration Tests (pgTAP):

- `viewer_profiles_isolation.sql`: two impersonated users see only their own rows; cannot update/delete the other's; third/duplicate slot insert fails.

### Manual Testing Steps:

1. Sign in; open `/profiles`; confirm two empty slots.
2. Fill slot 1 (name, preferred genres, excluded genres, note); save; reload; values persist.
3. Fill slot 2; confirm slot 1 untouched.
4. Re-edit slot 1; confirm update (no extra row) via a quick DB count or re-load.
5. Submit slot 1 with blank name; confirm error + no write.
6. Sign in as a second account; confirm empty slots (no cross-account leakage).
7. Confirm unauthenticated `/profiles` redirects to sign-in.

## Performance Considerations

Trivial scale (small users, ≤2 rows/user). The `user_id` index satisfies the RLS predicate. Static genre list avoids any TMDB subrequest on this page, keeping `/profiles` independent of external availability.

## Migration Notes

New table only; no existing data to migrate. Local-only application (`npm run db:reset`); pushing to the hosted DB is a human-gated step (`persistence-conventions.md:108-119`) and is not part of this slice. `rls_example` is left in place per the convention doc.

## References

- Persistence convention + new-table checklist: `docs/reference/persistence-conventions.md`
- Reference migration: `supabase/migrations/20260530165958_rls_convention_example.sql`
- Reference pgTAP test: `supabase/tests/rls_example_isolation.sql`
- RLS client: `src/lib/supabase.ts:5-24`
- Form-POST + redirect precedent: `src/pages/api/auth/signup.ts`, `src/components/auth/SignInForm.tsx`
- Route protection: `src/middleware.ts:4`
- Roadmap slice: `context/foundation/roadmap.md` (S-01)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer — viewer_profiles table + RLS + pgTAP

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:reset` — 2dfa7f9
- [x] 1.2 pgTAP tests pass (isolation + slot cap): `npm run db:verify` — 2dfa7f9
- [x] 1.3 Lint passes: `npm run lint` — 2dfa7f9

#### Manual

- [x] 1.4 Teeth check: drop a policy/constraint → `db:verify` fails → `db:reset` restores green — 2dfa7f9

### Phase 2: API + genre reference

#### Automated

- [x] 2.1 Type check / build passes: `npx astro sync && npm run build` — dbd18da
- [x] 2.2 Lint passes: `npm run lint` — dbd18da

#### Manual

- [x] 2.3 Unauthenticated `/profiles` redirects to `/auth/signin` — dbd18da
- [x] 2.4 Blank `display_name` POST redirects with error, persists nothing — dbd18da
- [x] 2.5 Unknown genre id is rejected — dbd18da

### Phase 3: UI — /profiles page with two slot editors

#### Automated

- [x] 3.1 Build/type check passes: `npx astro sync && npm run build`
- [x] 3.2 Lint passes: `npm run lint`

#### Manual

- [x] 3.3 Fill + save slot 1; values persist on reload
- [x] 3.4 Edit slot 2 independently; slot 1 undisturbed
- [x] 3.5 Re-save slot 1 updates (no duplicate row)
- [x] 3.6 Second account sees empty slots (no cross-account leakage)
- [x] 3.7 Empty-name save shows error, nothing written
