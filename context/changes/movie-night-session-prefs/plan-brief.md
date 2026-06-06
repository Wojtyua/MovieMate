# Start a Movie-Night Session and Save Preferences (S-02) — Plan Brief

> Full plan: `context/changes/movie-night-session-prefs/plan.md`

## What & Why

Add the `movie_night_sessions` table plus API and UI so a logged-in user can **start a movie-night session and save its preferences** — mood, preferred genres, excluded genres, runtime limit, intensity, and a note (FR-003, FR-004). These six fields are the **input contract S-03 reads** to retrieve TMDB candidates and score them, so getting their shape right now avoids rework downstream.

## Starting Point

S-01 (`viewer_profiles`) just shipped the full owner-scoped RLS pattern end-to-end: an RLS table + pgTAP isolation test, a form-POST upsert API that validates and redirects, and a protected Astro page hydrating a React island. This slice is a faithful sibling of that work — the same three-phase shape, reusing `genres.ts` and the auth form primitives.

## Desired End State

A logged-in user opens `/sessions`, fills the evening's constraints (all optional, sensible defaults), and saves. Each save **starts a new session row**; the most recent session is shown editable in place, and "Start another session" yields a fresh form. A second account sees none of the first's sessions. The slice stops at persisting preferences — no recommendations yet.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Session multiplicity | Many sessions — new row per save (no slot cap) | A session is a concrete evening; cleanly lets S-03/S-05 reference a `session_id` and avoids overwriting | Plan |
| Data model | Single `movie_night_sessions` table (no separate prefs table) | 1:1 normalization is overkill for one pair at MVP scale | Plan |
| mood & intensity | Predefined selects (fixed vocab), validated server-side like genre IDs | Clean, validatable signals for FR-007 scoring; `note` covers free text | Plan |
| intensity storage | `text` with DB `check (low/medium/high)`, default `medium` | Small stable ordinal set warrants a DB constraint | Plan |
| Field set | Exactly the 6 FR-004 fields | Zero scope creep; S-03 derives rating/release-window at retrieval | Plan |
| Create vs edit | Keyed by hidden `session_id` (insert if absent, update if present) | Analog of S-01's upsert-by-slot, adapted to unbounded rows | Plan |
| Required fields | All optional, sensible defaults | Preferences are hints not gates; "start" is instant; mirrors profiles | Plan |
| UI scope | New-session form + edit-latest only (no history list, no `[id]` route) | Closest to FR-003/004; history/detail belong with S-03/S-05 | Plan |

## Scope

**In scope:** `movie_night_sessions` table + RLS + pgTAP isolation test; `session-options.ts` (mood/intensity vocab + validators); `POST /api/sessions` (create-or-update); `/sessions` page + form island; route protection; dashboard link.

**Out of scope:** slot cap / unique constraint; session history list; `/sessions/[id]` route; rating/release-window fields; recommendations/scoring/retrieval (S-03); runtime TMDB fetches; app-level test framework; remote DB push.

## Architecture / Approach

Mirror S-01's three layers. **Data:** owner-scoped RLS table, unbounded rows per user. **API:** one `POST /api/sessions` form handler that validates (reusing `parseGenreIds` + disjoint logic from `api/profiles.ts`), then inserts a new row or updates the named one, and redirects with `?error=`/`?saved=<id>`. **UI:** `/sessions` loads the latest session server-side (`order by created_at desc limit 1`), renders the form empty or pre-filled/bound-to-id, hydrated `client:load`. Genres reuse `genres.ts`; mood/intensity come from a new `session-options.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `movie_night_sessions` table + RLS + pgTAP isolation | Forgetting this table is *uncapped* (no slot/unique) — that's the one deviation from `viewer_profiles` |
| 2. API + options | `session-options.ts`, `POST /api/sessions` (create-or-update), route guard | Create-vs-update must key off `session_id` so re-saving edits in place, not appends |
| 3. UI | `/sessions` page + form island + dashboard link | Latest-session load + edit-mode binding must round-trip cleanly |

**Prerequisites:** F-02 (persistence baseline) and S-01 (viewer-profiles) are both done — table convention, genre reference, and form primitives all exist.
**Estimated effort:** ~1–2 sessions across 3 phases (a near-clone of S-01).

## Open Risks & Assumptions

- The mood vocabulary is a design choice made here (`light/funny/tense/thrilling/emotional/thought-provoking/cozy/dark/epic/romantic`); S-03 scoring must map these — adjust the list if S-03's scoring rule needs different buckets.
- "Edit latest" assumes a single in-progress session per evening is enough UX; if users need to edit an older session, a history/list view (deferred) would be required.
- Runtime is stored in minutes, nullable ("no limit"); S-03 maps non-null → TMDB `with_runtime.lte`.

## Success Criteria (Summary)

- A logged-in user can start a session, save all six preference fields, and see them persist as the latest session; re-saving edits in place while "Start another session" creates a distinct row.
- Sessions are strictly account-private (pgTAP isolation proves it) and a user can hold many.
- All preference fields are optional and a blank/default session saves successfully.
