# Remembered Taste Core (S-01) Implementation Plan

## Overview

Collapse the shipped two-slot `viewer_profiles` model into **one remembered taste core per user** — stable preferred + excluded genres only — and repurpose `/profiles` into a single-core editor. This is the load-bearing model change every later reshape slice (S-02–S-05) assumes (PRD FR-001, FR-002; roadmap S-01).

The scoring engine is **not** generalized here — that is S-02. To keep the shipped recommendations flow green in the gap between slices, S-01 adds a small, explicitly throwaway adapter that loads the single core and feeds it to the existing two-viewer engine as a degenerate duo (`recommend([core, core], …)`).

## Current State Analysis

- **Model is structurally a pair.** `supabase/migrations/20260603115857_viewer_profiles.sql` enforces exactly two profiles via `slot smallint check (slot in (1,2))` + `unique (user_id, slot)`. Columns: `display_name text not null`, `preferred_genre_ids int[]`, `excluded_genre_ids int[]`, `note text`. Owner-scoped RLS (4 policies) + `viewer_profiles_user_id_idx`.
- **Three readers of `viewer_profiles`:**
  - `src/pages/profiles.astro` — selects `slot, display_name, preferred_genre_ids, excluded_genre_ids, note`; renders two `ProfileForm` cards keyed by `bySlot`.
  - `src/pages/api/profiles.ts` — POST upserts by `(user_id, slot)`; requires `slot ∈ {1,2}` and a non-empty `display_name`.
  - `src/pages/api/recommendations.ts` — selects `slot, preferred_genre_ids, excluded_genre_ids`; **errors if `< 2` profiles** (line 71) and passes exactly `[profiles[0], profiles[1]]` into `recommend()` (line 133); also OR-unions both profiles' preferred genres into the TMDB discover hint (`unionGenres`, lines 117–121).
- **The engine takes a fixed pair.** `src/lib/recommend/roles.ts:87` — `recommend(profiles: [Profile, Profile], session, candidates)`. `Profile` (`src/lib/recommend/scoring.ts:35`) is just `{ preferred_genre_ids, excluded_genre_ids }`. Feeding two identical profiles is type-correct and scales every candidate's per-viewer reward uniformly, so ranking, roles, and diversity are unaffected.
- **`display_name` / `note` have no downstream consumer** beyond `profiles.astro`/`api/profiles.ts`. `recommendations.ts` never reads them. `movie_night_sessions` already carries its own session `note`.
- **Component reuse:** `src/components/profiles/ProfileForm.tsx` already renders the two `GenrePicker`s (preferred / avoid) with mutually-exclusive toggling and hidden `preferred_genre_ids` / `excluded_genre_ids` form entries — exactly what the core needs, minus `slot`, `display_name`, and `note`.
- **Nav / guard:** `src/pages/dashboard.astro:19` links to `/profiles`; `src/middleware.ts:4` protects `/profiles`. Both URLs are retained.

## Desired End State

- `viewer_profiles` holds at most **one row per user** (`unique(user_id)`, no `slot`/`display_name`/`note`).
- A logged-in operator visits `/profiles`, sees a single "remembered taste core" card, sets preferred + excluded genres, saves, and on reload the selection persists.
- `/api/recommendations` still returns three role-labeled picks from the single core (degenerate-duo stopgap), within the existing budget.
- `npm run lint`, typecheck, and build all pass; no reference to `slot`, `display_name`, or `note` survives against `viewer_profiles`.

Verify by: applying the migration locally, saving a core via `/profiles`, reloading to confirm persistence, then running a session end-to-end to confirm three picks still appear.

### Key Discoveries:

- `recommend()` signature is a fixed tuple `[Profile, Profile]` (`src/lib/recommend/roles.ts:87`) — the degenerate-duo call `recommend([core, core], …)` needs **zero** engine change.
- `recommendations.ts:71` is the hard `< 2` gate that must be replaced with a `core == null` gate.
- `ProfileForm` is reusable nearly as-is; the change is subtractive (remove slot/name/note), not additive.
- Existing data is **wiped** (per decision) — the migration needs no row-preserving backfill.

## What We're NOT Doing

Explicitly deferred to later slices (scope lock confirmed during planning):

- **Generalizing the scoring engine** to formally accept one-or-two viewers — S-02. S-01 only adds the throwaway degenerate-duo adapter at the API read path.
- **Session-first home entry point + pre-filling tonight's session genres** from the core — S-02.
- **Solo role set / widening `recommendation_picks.role` CHECK** (dropping "compromise") — S-02.
- **"Save tonight's genres as my core" affordance** — S-02. S-01's only edit surface is the repurposed `/profiles` editor.
- **Renaming the `viewer_profiles` table or `/profiles` URL** to domain-accurate names — deferred to avoid churn; the table/URL keep their names.
- **Touching `movie_night_sessions`, the affinity/scoring weights, or persistence of a second viewer.**

## Implementation Approach

Three phases in dependency order: migrate the schema first (so the new shape exists), rewrite the read/write surface for the single core, then patch the recommendations read path so the shipped flow stays green. The degenerate-duo adapter in Phase 3 is deliberately small and marked as throwaway so S-02 deletes it cleanly.

**Cross-phase note:** the recommendations path is *red between Phase 1 and Phase 3* — once the migration lands, `recommendations.ts` still selects the dropped `slot` column and finds 0 rows, so it stays broken until Phase 3 rewrites its read path. Each phase's own gates (lint/typecheck/build/`db:verify`) pass per-phase, but the end-to-end recs flow should only be demoed/verified after Phase 3.

## Critical Implementation Details

- **Migration ordering & data wipe.** The `unique(user_id)` constraint cannot be added while two-slot rows exist for a user. Wipe rows (`delete from public.viewer_profiles`) **before** adding the constraint, within the same migration. Drop `unique (user_id, slot)` before dropping the `slot` column. Follow the additive/reversible convention loosely — this is a destructive reshape on dev-only data, so a clean forward migration is acceptable; do not attempt a down-migration that resurrects two slots.
- **Degenerate-duo ranking invariance.** Passing `[core, core]` doubles the per-viewer preferred/excluded contribution, but uniformly across all candidates, so the relative ordering and role/diversity assignment are unchanged versus a single-viewer pass. This is why the stopgap is safe without an engine change.

## Phase 1: Schema migration — two slots → one core

### Overview

A new forward migration reshapes `viewer_profiles` in place to a single-core-per-user table.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<timestamp>_remembered_taste_core.sql` (new; timestamp per the existing `YYYYMMDDHHMMSS_` convention)

**Intent**: Convert the two-slot `viewer_profiles` table into a single remembered-taste-core-per-user table, keeping the genre columns and the owner-scoped RLS/index untouched.

**Contract**: A forward migration that, in order: (1) `delete from public.viewer_profiles;` (wipe existing dev rows); (2) `drop column slot`, `drop column display_name`, `drop column note` — dropping `slot` automatically removes the `slot in (1,2)` CHECK and the unnamed `unique (user_id, slot)` constraint that involve it (no separate `DROP CONSTRAINT` needed, and no CASCADE — the constraints involve only table-internal columns); (3) `alter table public.viewer_profiles add constraint viewer_profiles_user_id_key unique (user_id)`. Leave the four RLS policies, `enable row level security`, and `viewer_profiles_user_id_idx` as-is. End state columns: `id, user_id, preferred_genre_ids, excluded_genre_ids, created_at, updated_at`.

#### 2. Rewrite the pgTAP isolation suite for the single-core model

**File**: `supabase/tests/viewer_profiles_isolation.sql`

**Intent**: The existing suite (run via `npm run db:verify` → `supabase test db`) seeds fixtures with `slot`/`display_name` and asserts the slot CHECK + `(user_id, slot)` UNIQUE — all removed by change #1, so it errors on the first insert. Rewrite it to prove own-data isolation plus the new single-core uniqueness.

**Contract**: Change the fixture inserts (lines ~27–29) to `insert into public.viewer_profiles (user_id, preferred_genre_ids) values (…)` with no `slot`/`display_name`. Swap the two `display_name` reads (lines ~62, ~85) for a surviving column (e.g. `preferred_genre_ids`) or a `count(*)`/`user_id` check. Replace the three slot-cap assertions (lines ~95–112: the `lives_ok` slot-2 insert and the two `throws_ok` for CHECK `23514` / dup-slot `23505`) with **one** `throws_ok(… , '23505', …)` proving a second row for the same `user_id` violates the new `unique(user_id)`. Update `select plan(N)` to the new assertion count and refresh the FR-002 header comment (lines ~6–7) to describe a single core, not "exactly two profiles". Keep the RLS-impersonation harness (`set local role authenticated` + `request.jwt.claims`) and the surrounding own-data assertions unchanged.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a local/dev Supabase (`npm run db:reset`) with no errors.
- A post-migration schema check shows `viewer_profiles` has no `slot`, `display_name`, or `note` columns and a `unique(user_id)` constraint.
- pgTAP suite passes: `npm run db:verify` (proves own-data isolation + the new single-core uniqueness).
- Build passes: `npm run build`.

#### Manual Verification:

- The four RLS policies still exist and own-data isolation still holds (a second user cannot read the first user's row) — now also covered automatically by `db:verify`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding. Phase blocks use plain bullets; the `## Progress` section owns the checkboxes.

---

## Phase 2: Single-core editor (write + read surface)

### Overview

Rewrite the POST handler, the page, and the form so the operator maintains exactly one core of preferred + excluded genres.

### Changes Required:

#### 1. Core upsert endpoint

**File**: `src/pages/api/profiles.ts`

**Intent**: Replace the slot-keyed, name-required upsert with a single-core upsert keyed on the owner. Remove all `slot`, `display_name`, and `note` handling.

**Contract**: POST parses only `preferred_genre_ids` + `excluded_genre_ids` (reuse the existing `parseGenreIds` validation, including the disjoint-sets check and unknown-genre rejection). Upsert into `viewer_profiles` with `{ user_id, preferred_genre_ids, excluded_genre_ids, updated_at }` using `{ onConflict: "user_id" }`. Error redirects go to `/profiles?error=…` (drop the `slot` query param); success redirects to `/profiles?saved=1` (or a slotless `?saved` flag). Keep the auth guard and the Supabase-not-configured guard.

#### 2. Core editor page

**File**: `src/pages/profiles.astro`

**Intent**: Render a single "remembered taste core" card instead of two slot cards.

**Contract**: Select only `preferred_genre_ids, excluded_genre_ids` from `viewer_profiles`, take the single row (`maybeSingle()` or `data?.[0]`), and render one `ProfileForm` (single-core variant). Drop the `[1,2].map` loop, the `bySlot` map, the `slot`/`display_name`/`note` plumbing, and the per-slot error/saved keying. Update the page copy ("These two profiles feed…" → single-core wording). Keep the Layout, dashboard back-link, and error/saved banners (now slotless).

#### 3. Core form component

**File**: `src/components/profiles/ProfileForm.tsx` (repurposed; may be renamed to `TasteCoreForm.tsx` if preferred — update the import in `profiles.astro` accordingly)

**Intent**: Reduce the form to the two genre pickers for the single core; remove the slot hidden input, the name field, and the note textarea.

**Contract**: Props drop `slot`, `displayName`, `note` — keep `preferredGenreIds`, `excludedGenreIds`, `serverError`, `justSaved`. Keep both `GenrePicker`s, the mutually-exclusive `toggle` logic, and the hidden `preferred_genre_ids` / `excluded_genre_ids` entries that match `formData.getAll()`. Remove the `display_name`/`note` inputs and the `handleSubmit` name-required guard. Heading/button copy becomes "Remembered taste core" / "Save taste core". The form still POSTs to `/api/profiles`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck` (or `astro check`) — no references to removed props/columns remain.
- Linting passes: `npm run lint`.
- Build passes: `npm run build`.

#### Manual Verification:

- `/profiles` shows one taste-core card; selecting preferred/avoid genres, saving, and reloading persists the selection.
- Selecting the same genre as both preferred and avoid is prevented in the UI and rejected by the API.
- The dashboard `/profiles` link and middleware guard still work (logged-out users are redirected).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Recommendations stopgap (degenerate duo)

### Overview

Keep the shipped recommendations flow returning three picks from the single core, without touching the scoring engine.

### Changes Required:

#### 1. Adapt the recommendations read path

**File**: `src/pages/api/recommendations.ts`

**Intent**: Load the single remembered taste core instead of requiring two profiles, and feed it to the unchanged two-viewer engine as a degenerate duo. Mark this as throwaway scope that S-02 replaces.

**Contract**: Replace the `viewer_profiles` query + `< 2` gate (lines 66–80) with a single-core load: select `preferred_genre_ids, excluded_genre_ids`, take the one row; if absent, redirect to `/profiles` with "Set your taste core before getting recommendations". Build one `core: Profile`. Update `unionGenres(...)` (lines 117–121) to union `session.preferred_genre_ids` + `core.preferred_genre_ids` (drop the second-profile arg). Call `recommend([core, core], session, candidates)` (line 133). Add a short comment flagging the `[core, core]` duplication as a temporary S-01 shim removed in S-02. Persistence (steps 6–7) is unchanged.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck` — `recommend([core, core], …)` satisfies the `[Profile, Profile]` tuple.
- Linting passes: `npm run lint`.
- Build passes: `npm run build`.

#### Manual Verification:

- With a saved taste core, starting a session and requesting recommendations returns three role-labeled picks within the response budget.
- With no taste core saved, the flow redirects to `/profiles` with the new message (no crash).
- Picks still persist (a `recommendations` run + three `recommendation_picks` rows are written).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This closes S-01.

---

## Testing Strategy

### DB tests (pgTAP, `npm run db:verify`):

- **`supabase/tests/viewer_profiles_isolation.sql` must be rewritten** for the single-core model (Phase 1, change #2): its slot/display_name fixtures and slot-cap assertions break against the migrated schema. New shape: own-data isolation assertions (kept) + one `unique(user_id)` violation check (replacing the three slot-cap checks). This is a required Phase 1 gate.
- The sibling suites (`movie_night_sessions_isolation.sql`, `recommendations_isolation.sql`) are unaffected functionally; refresh only the stale "slot cap" contrast comments in `movie_night_sessions_isolation.sql` while editing (see F4).

### Unit Tests:

- No engine changes, so no new scoring unit tests are required for S-01 (the degenerate-duo stopgap reuses the unchanged engine).

### Integration Tests:

- End-to-end: save a taste core → start a session → request recommendations → three picks render and persist.
- Negative: request recommendations with no core saved → redirect to `/profiles`, no 500.

### Manual Testing Steps:

1. Apply the migration; confirm `viewer_profiles` has the single-core shape and `unique(user_id)`.
2. Visit `/profiles`, set preferred + excluded genres, save, reload — selection persists.
3. Attempt to mark a genre both preferred and avoid — UI prevents it; API rejects a forged request.
4. Run a full session → confirm three role-labeled picks appear and persist.
5. Sign out → hitting `/profiles` redirects to sign-in.

## Performance Considerations

None new. The single-core query is lighter than the two-profile query. The `<10s` recommendation budget is unaffected (no AI on the path in S-01).

## Migration Notes

Destructive reshape on dev-only data: existing two-slot rows are **wiped** (per decision — no backfill). Forward-only; do not author a down-migration that recreates two slots. The `unique(user_id)` constraint must be added only after the wipe and after dropping `unique(user_id, slot)` and the `slot` column.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-01 (remembered-taste-core)
- PRD: `context/foundation/prd.md` → FR-001, FR-002; Constraints (data migration); OQ-3 (edit surface)
- Upstream frame: `context/changes/session-first-flow/frame.md`
- Current model: `supabase/migrations/20260603115857_viewer_profiles.sql`
- Engine signature (unchanged): `src/lib/recommend/roles.ts:87`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration — two slots → one core

#### Automated

- [x] 1.1 Migration applies cleanly via `npm run db:reset` with no errors — 695b5dd
- [x] 1.2 Schema check: no `slot`/`display_name`/`note` columns; `unique(user_id)` present — 695b5dd
- [x] 1.3 pgTAP suite passes: `npm run db:verify` (rewritten single-core isolation test) — 695b5dd
- [x] 1.4 Build passes: `npm run build` — 695b5dd

#### Manual

- [x] 1.5 Four RLS policies intact; own-data isolation still holds (also covered by db:verify) — 695b5dd

### Phase 2: Single-core editor (write + read surface)

#### Automated

- [x] 2.1 Typecheck passes (no references to removed props/columns)
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Build passes: `npm run build`

#### Manual

- [x] 2.4 `/profiles` shows one taste-core card; save + reload persists selection
- [x] 2.5 Preferred/avoid overlap prevented in UI and rejected by API
- [x] 2.6 Dashboard link + middleware guard still work (logged-out redirect)

### Phase 3: Recommendations stopgap (degenerate duo)

#### Automated

- [ ] 3.1 Typecheck passes: `recommend([core, core], …)` satisfies the tuple
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`

#### Manual

- [ ] 3.4 Saved core → session → three role-labeled picks within budget
- [ ] 3.5 No core saved → redirect to `/profiles`, no crash
- [ ] 3.6 Picks persist (one `recommendations` run + three `recommendation_picks` rows)
