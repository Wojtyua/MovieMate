---
date: 2026-06-11T10:37:53+0200
researcher: Wojciech Derlikiewicz
git_commit: 897b58dcf74f7771c145ef07a38e03079cc5e5a8
branch: main
repository: 10xMovie
topic: "S-05 — Select a pick and mark it watched (dedup filter on retrieval)"
tags: [research, codebase, recommendations, watched-dedup, supabase, rls, retrieval-pipeline]
status: complete
last_updated: 2026-06-11
last_updated_by: Wojciech Derlikiewicz
---

# Research: S-05 — Select a pick and mark it watched

**Date**: 2026-06-11T10:37:53+0200
**Researcher**: Wojciech Derlikiewicz
**Git Commit**: 897b58dcf74f7771c145ef07a38e03079cc5e5a8
**Branch**: main
**Repository**: 10xMovie

## Research Question

For roadmap slice **S-05 (`select-and-mark-watched`)** — "user can select one recommendation to close the decision, mark it watched, and have watched films excluded from future candidate retrieval for the account" (PRD FR-011, FR-012; US-01) — find exactly where in the live codebase to:

1. exclude watched films from candidate retrieval,
2. render a select / mark-watched action on the picks UI,
3. persist a per-account `watched` set (new table + endpoint), following existing migration / RLS / API conventions.

## Summary

S-05 is unusually low-risk because **the retrieval seam already exists and is wired**: `fetchCandidates()` accepts `excludeMovieIds?: Set<number>` and already applies it (`src/lib/tmdb-discover.ts:127,150,185`), explicitly labelled "Watched-exclusion seam (S-05)". It is just **never populated** — `recommend-run.ts` does not pass it. The work is three small, well-bounded pieces:

- **Persistence** — a new owner-scoped `watched` table keyed by `(user_id, tmdb_movie_id)` with a `unique` dedup constraint, four RLS policies, an index, and a pgTAP isolation test. This mirrors the denormalized-owner shape of `recommendation_picks` and the `unique (user_id, slot)` upsert pattern of `viewer_profiles`. The persistence docs and the RLS example migration **already name "watched-dedup (S-05)"** as an anticipated table.
- **Mutation endpoint** — a JSON API route under `src/pages/api/` that reads `context.locals.user`, returns `401` JSON when unauthenticated, and idempotently inserts `{ user_id, tmdb_movie_id }` (upsert on the unique constraint). This follows the JSON-style pattern of `health/integrations.ts` (the form/redirect endpoints are the wrong template here, since this is a fetch-from-React action).
- **Retrieval wiring** — in `recommend-run.ts`, query the user's watched `tmdb_movie_id`s into a `Set<number>` before the relaxation ladder and pass it as `excludeMovieIds` into the existing `fetchCandidates()` call.
- **UI** — the picks results page (`src/pages/sessions/[id]/recommendations.astro`) is currently **pure server-rendered Astro with no React island**. A "mark watched" button requires extracting the pick card into a `client:*` React island (or adding a small island), then calling the new endpoint via `fetch`. `tmdb_movie_id` is already fetched and available client-side; the pick `id` is **not** needed for the watched table (watched is keyed by TMDB id, not by pick).

**Key design decision to lock in `/10x-plan`:** "watched" is keyed by **`tmdb_movie_id` per account**, in its own table — NOT a `watched_at` column on `recommendation_picks`. This matches the PRD ("a dedup filter, not a scoring signal, not a browsable list", and explicitly "watch history as a scoring signal or browsable list" is a Non-Goal) and matches the retrieval seam, which excludes by TMDB id across all future runs regardless of which run surfaced the film.

## Detailed Findings

### Area 1 — Candidate retrieval & the exclusion seam (the load-bearing finding)

The exclusion mechanism is already built and tested-shaped; only the data feed is missing.

- **The seam** — `src/lib/tmdb-discover.ts:127`:
  ```ts
  /** Watched-exclusion seam (S-05); defaults to empty (no exclusions). */
  excludeMovieIds?: Set<number>;
  ```
- **Where it is applied** — `src/lib/tmdb-discover.ts:150` reads `const exclude = opts.excludeMovieIds ?? new Set<number>()`, and the actual filter is the dedup line `src/lib/tmdb-discover.ts:185`:
  ```ts
  if (!byId.has(movie.id) && !exclude.has(movie.id)) { ... }
  ```
  i.e. watched-exclusion runs in the **same pass as id-dedup**, before a movie enters the candidate pool, before scoring/role assignment.
- **The gap** — `src/lib/recommend-run.ts:123-135` builds the 4-step relaxation ladder and calls `fetchCandidates(tmdb, { genreIds, castIds, keywordIds, runtimeLteMinutes, voteCountGte, pages: 3, signal })` — **no `excludeMovieIds`**. Confirmed by grep: the only `excludeMovieIds` references in `src/` are the three inside `tmdb-discover.ts` itself.
- **Where to feed it** — `recommend-run.ts` already receives `supabase` and `user: { id }` (signature ~line 45-47) and is called from `src/pages/api/recommendations.ts:142` as `recommendRun(supabase, user, session, second)`. Query the watched set once, before the ladder loop (around `recommend-run.ts:106`, after entity resolution), then pass the resulting `Set<number>` into the `fetchCandidates` call.
- **TMDB id field** is `id: number` on `TmdbMovie` (`src/lib/tmdb-discover.ts:19`); persisted as `tmdb_movie_id int` on picks (`recommend-run.ts:173`, `pick.movie.id`).

**Pool-shrink consideration (real, must be called out in the plan):** the always-three-picks guarantee comes from the relaxation ladder breaking at the first attempt with `candidates.length >= 3` (`recommend-run.ts:133`); if no ladder step yields ≥3 after exclusion, the run fails with "Could not reach TMDB, try again" (`recommend-run.ts:142`). Excluding watched films **shrinks every attempt's pool**. With `pages: 3` (~180 raw candidates/attempt) this is unlikely to bite in dev, but for a heavy-watcher account the exclusion could in principle push a narrow-genre query below three. This is the one risk to verify: it intersects test-plan **Risk #1 ("fewer than three picks")**. No new mitigation is obviously needed (the ladder already broadens), but the plan should state the behavior and decide whether exclusion should also relax (it should not — a watched film must never be re-recommended).

### Area 2 — Persistence: new `watched` table (migrations + RLS + schema)

Conventions are documented canonically at `docs/reference/persistence-conventions.md` (authoritative "how to add a table" guide with a New-table checklist).

- **Migrations** live in `supabase/migrations/` as `<YYYYMMDDHHMMSS>_<name>.sql`, applied in filename order. Scaffold with `npm run db:new <name>` (→ `supabase migration new`); the timestamp prefix is generated, not hand-authored. Apply locally with `npm run db:reset`; verify with `npm run db:verify` (pgTAP via `supabase test db`). **No `db:push` script** — remote apply is human-gated and manual. Wrangler is not involved in DB migration (`npm run deploy` = `astro build && wrangler deploy` only).
- **Owner-scoped RLS** — enable RLS + four per-command policies, all scoped to `auth.uid() = user_id`, named `<table>_<operation>_own`. `select`/`delete` use `using`; `insert` uses `with check`; `update` uses both. Copyable template at `supabase/migrations/20260603115857_viewer_profiles.sql:39-62` (and the canonical example `supabase/migrations/20260530165958_rls_convention_example.sql:30-52`). RLS needs zero client changes because `src/lib/supabase.ts` builds a per-request client with anon key + user cookie JWT, so PostgREST runs queries as the authenticated user.
- **Column conventions** (every owner-scoped table): `id uuid primary key default gen_random_uuid()`; `user_id uuid not null references auth.users (id) on delete cascade default auth.uid()`; `created_at timestamptz not null default now()`; an owner index `create index <table>_user_id_idx on public.<table> (user_id);`. Small fixed domains → inline `check (...)`; dedup/upsert targets → a `unique (...)` constraint.
- **`recommendation_picks` definition** — `supabase/migrations/20260606115345_recommendations.sql:33-55`: TMDB id column is **`tmdb_movie_id int not null`** (plain `int`, not bigint/uuid). Child tables carry their **own denormalized `user_id`** rather than joining to the parent, so RLS is uniform — the pattern a `watched` table should copy.
- **Anticipated already:** `supabase/migrations/20260530165958_rls_convention_example.sql:5-6` and `docs/reference/persistence-conventions.md:11` explicitly name **"watched-dedup (S-05)"** as a future product table.
- **pgTAP isolation test is mandatory** (New-table checklist step 6): add `supabase/tests/watched_isolation.sql` mirroring `supabase/tests/recommendations_isolation.sql` (two users via `set local role authenticated` + `request.jwt.claims`, assert partitioned visibility).

Derived `watched` shape (to be finalized in `/10x-plan`, not prescriptive):
```
id uuid pk default gen_random_uuid()
user_id uuid not null references auth.users(id) on delete cascade default auth.uid()
tmdb_movie_id int not null
created_at timestamptz not null default now()
unique (user_id, tmdb_movie_id)            -- idempotent marking + dedup
create index watched_user_id_idx on public.watched (user_id);
+ enable RLS + four watched_*_own policies
+ supabase/tests/watched_isolation.sql
```

### Area 3 — Mutation endpoint (mark watched)

- **Route style:** API routes live in `src/pages/api/`, handlers named by verb (`export const POST: APIRoute`). Two styles exist: **form/redirect** (`profiles.ts`, `recommendations.ts` — read `FormData`, write, `context.redirect`) and **JSON** (`health/integrations.ts` — `new Response(JSON.stringify(...), { status, headers })`). A mark-watched action invoked from a React island via `fetch` should follow the **JSON** style.
- **Auth/guard:** API routes are deliberately NOT in `middleware.ts`'s `PROTECTED_ROUTES` (`src/middleware.ts:4`, page routes only) — they guard **in-route** via `const user = context.locals.user;`. JSON endpoints return `401` JSON when missing (pattern at `src/pages/api/health/integrations.ts:14-19`). `user_id` always comes from `context.locals.user.id` (the JWT), **never from the request body** (`recommendations.ts:91-93`).
- **Client access:** `createClient(context.request.headers, context.cookies)` from `src/lib/supabase.ts:5-24`; returns `null` when env missing — every caller null-checks.
- **Write pattern:** idempotent insert via upsert on the unique constraint — mirror `viewer_profiles` upsert (`src/pages/api/profiles.ts:43-52`, `onConflict: "user_id"`); here `onConflict: "user_id,tmdb_movie_id"`. Validation is **hand-rolled, no zod anywhere** in the repo — small parse/early-return helpers.
- **Types:** no generated Supabase `Database` types; the client is untyped and code casts where needed (`recommendations.ts:113`). No type-regeneration step when adding a table — a `watched` endpoint just references `.from("watched")` and shapes its own TS.

### Area 4 — Picks UI: select + mark watched

- **Results page** — `src/pages/sessions/[id]/recommendations.astro` (≈1-128). Server-side Supabase fetch of the latest `recommendations` row by `session_id`, then its `recommendation_picks` (select at line ~48: `role, tmdb_movie_id, title, poster_path, overview, genre_ids, release_date, vote_average`). Picks sorted by `ROLE_RANK`. Cards are rendered in a **pure Astro `{...}` loop (lines ~82-122) — there is NO React island on this page** and no existing buttons/actions on the cards.
- **What's available client-side:** `tmdb_movie_id` IS in the select and rendered, so a mark-watched action has everything it needs (watched is keyed by TMDB id). The pick **`id` UUID is NOT fetched** — but it is **not required** for S-05 (we are not writing back to `recommendation_picks`).
- **Island + mutation pattern:** existing islands use `client:load` (e.g. `<SessionForm client:load />` in `sessions.astro:73`); all current mutations are **native HTML form POSTs** to API routes (`SessionForm.tsx`, `ProfileForm.tsx`) — there is **no existing `fetch`-from-React mutation** in the repo. S-05 introduces the first one (a button → `fetch` POST → JSON response), so it sets a small new convention rather than copying one. shadcn `Button` (`src/components/ui/button.tsx`) with the project's purple styling (see `SubmitButton.tsx`) is the control to reuse.
- **Decision-closing state:** none exists today. The plan must decide the post-mark UX — disable/replace the button, show a "watched ✓" state, and whether "select one to close the decision" (FR-011) is purely visual (highlight the chosen card) or also navigates away. Per the roadmap, "watched" is only a dedup filter, so the minimal honest implementation is: a per-card "Mark watched" action that records the TMDB id; "select to close the decision" can be the same gesture (selecting = marking watched) unless the team wants them split.

## Code References

- `src/lib/tmdb-discover.ts:127` — `excludeMovieIds?: Set<number>` seam (S-05), currently unpopulated
- `src/lib/tmdb-discover.ts:150` — reads the exclude set (defaults empty)
- `src/lib/tmdb-discover.ts:185` — `if (!byId.has(movie.id) && !exclude.has(movie.id))` — the actual exclusion + dedup point
- `src/lib/tmdb-discover.ts:19` — `id: number` (TMDB id field on `TmdbMovie`)
- `src/lib/recommend-run.ts:123-135` — relaxation ladder loop calling `fetchCandidates` **without** `excludeMovieIds` (wiring gap)
- `src/lib/recommend-run.ts:133` — `if (candidates.length >= 3) break` (always-three guarantee)
- `src/lib/recommend-run.ts:142` — failure path when pool < 3 ("Could not reach TMDB")
- `src/lib/recommend-run.ts:173` — `tmdb_movie_id: pick.movie.id` (pick persistence)
- `src/pages/api/recommendations.ts:85,142` — `context.locals.user` → `recommendRun(supabase, user, session, second)`
- `src/pages/sessions/[id]/recommendations.astro:~48` — picks select clause (has `tmdb_movie_id`, not `id`)
- `src/pages/sessions/[id]/recommendations.astro:~82-122` — pure-Astro pick-card loop (no island)
- `src/pages/api/health/integrations.ts:14-19` — JSON 401 unauthenticated pattern (template for the new endpoint)
- `src/pages/api/profiles.ts:43-52` — upsert/`onConflict` write pattern to mirror
- `src/lib/supabase.ts:5-24` — `createClient(headers, cookies)` per-request RLS client
- `src/middleware.ts:4,16-23` — `PROTECTED_ROUTES` (pages only); `context.locals.user` population
- `supabase/migrations/20260606115345_recommendations.sql:33-55` — `recommendation_picks` (`tmdb_movie_id int`, denormalized `user_id`, dedup `unique`)
- `supabase/migrations/20260603115857_viewer_profiles.sql:29,39-62` — `unique (user_id, slot)` dedup + full 4-policy RLS block to copy
- `supabase/migrations/20260530165958_rls_convention_example.sql:5-6,30-52` — names "watched-dedup (S-05)"; canonical RLS template
- `supabase/tests/recommendations_isolation.sql` — pgTAP isolation test to mirror as `watched_isolation.sql`
- `docs/reference/persistence-conventions.md` — authoritative add-a-table checklist (RLS, test, apply steps)

## Architecture Insights

- **Seam-first design pays off here.** The S-04 author pre-built the `excludeMovieIds` seam and documented it for S-05; the retrieval change is ~one query + one argument. This is the cheapest layer to cover the FR-012 risk and should be where the dedup logic lives — not in scoring, not in the UI.
- **Denormalized owner + `unique` dedup is the house pattern.** `recommendation_picks` carries its own `user_id`; `viewer_profiles` dedups on `unique (user_id, slot)`. The `watched` table is a textbook instance: `unique (user_id, tmdb_movie_id)`.
- **Two endpoint styles; pick JSON for fetch.** Form/redirect endpoints back HTML `<form>`s; this feature's button is a React `fetch` action, so the JSON-response style (`health/integrations.ts`) is the correct template, including the 401-JSON guard.
- **`user_id` is always server-derived from the JWT.** Never trust a body-supplied user id; the request only needs to carry `tmdb_movie_id`.
- **The picks page is the one server-only surface gaining interactivity.** Introducing the first `fetch`-from-React mutation is a deliberate, small new convention — keep it minimal and styled like the existing shadcn submit buttons.
- **RLS is enforced over PostgREST/HTTP (workerd runtime).** No raw `pg`; the per-request anon-key+JWT client means the new table's policies are the real access control. Per [[astro-dev-runs-in-workerd]], a local `astro dev` + `db:reset`/`db:verify` pass is genuine runtime proof.

## Historical Context (from prior changes)

- `context/archive/2026-06-11-ai-note-understanding/` (S-04) — introduced the relaxation ladder and the `excludeMovieIds` seam now being consumed; the `<10s` cumulative `AbortController` budget and "always three picks" guarantee come from this slice.
- `context/archive/2026-05-30-persistence-baseline-rls/` (F-02) — established the owner-scoped RLS convention, the example migration that names "watched-dedup (S-05)", and the pgTAP isolation-test requirement.
- `context/archive/2026-06-02-provision-external-apis/` (F-01) — TMDB access via raw `fetch`; the discover client S-05 reuses.
- `context/archive/2026-06-06-session-first-solo-flow/` (S-02), `2026-06-06-scored-recommendations/`, `2026-06-08-optional-inline-second-viewer/` (S-03) — built the picks pipeline, scoring/roles, and `recommendation_picks` persistence this slice depends on.

## Related Research

- None prior for this change. Foundation inputs: `context/foundation/prd.md` (FR-011/FR-012, US-01, Non-Goals), `context/foundation/roadmap.md` (S-05), `context/foundation/test-plan.md` (Risk #1 — "fewer than three picks").

## Open Questions

1. **Select vs. mark-watched — one gesture or two?** (FR-011 "select to close the decision" vs. FR-012 "mark watched"). Minimal honest read: a single per-card "Mark watched" action both closes the decision and records the dedup. Owner: user/team — resolve in `/10x-plan`.
2. **Post-mark UX.** Disable/replace the button, show "watched ✓", and/or navigate away? Resolve in `/10x-plan`.
3. **Pool-shrink behavior under heavy watch history** (intersects test-plan Risk #1). The exclusion must NOT relax (a watched film must never reappear), so the only lever is the existing ladder. Plan should state the behavior and confirm no extra mitigation is needed for dev-scale data.
4. **Endpoint contract.** Idempotent upsert on `(user_id, tmdb_movie_id)` returning JSON `{ ok }`; confirm whether an "unwatch"/undo is in scope (PRD does not ask for it → default: out of scope).
