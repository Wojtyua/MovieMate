---
date: 2026-06-06T12:54:10+0200
researcher: Wojciech Derlikiewicz
git_commit: 66f81ae6b1d1c67887a5d1b5f4773ebe928219b8
branch: main
repository: 10xMovie
topic: "S-03 scored-recommendations — codebase grounding for the recommendation engine"
tags: [research, codebase, tmdb, scoring, recommendations, supabase, workerd]
status: complete
last_updated: 2026-06-06
last_updated_by: Wojciech Derlikiewicz
---

# Research: S-03 scored-recommendations — codebase grounding

**Date**: 2026-06-06T12:54:10+0200
**Researcher**: Wojciech Derlikiewicz
**Git Commit**: 66f81ae6b1d1c67887a5d1b5f4773ebe928219b8 (local; not yet on origin/main)
**Branch**: main
**Repository**: 10xMovie

## Research Question

Ground the implementation plan for roadmap slice **S-03 (scored-recommendations)** — "user submits session preferences and receives three meaningfully distinct, role-labeled recommendations (safe pick / compromise pick / wild card) drawn from TMDB candidates scored against both viewer profiles and the session constraints, within <10s" (US-01, FR-005..FR-009). Map the exact input contracts, the TMDB/AI/Supabase seams, the API/page/UI patterns, and the runtime constraints the engine must respect.

## Summary

S-03's prerequisites are all in place and the codebase is unusually well-prepared for it:

- **Input contracts are settled and TMDB-native.** Two `viewer_profiles` (slot 1/2) supply `preferred_genre_ids[]` / `excluded_genre_ids[]` / freeform `note`; the latest `movie_night_sessions` row supplies `mood`, `preferred_genre_ids[]`, `excluded_genre_ids[]`, `runtime_limit_minutes`, `intensity`, `note`. Genre ids are already authoritative TMDB ids — **no name→id translation needed**. Profiles capture genres only (no per-viewer mood/intensity).
- **The external seams exist but are stubs.** `src/lib/tmdb.ts` is a thin reachability client (`createTmdbClient().request(path, init)` → raw `Response`, bearer v4 token, `null` when unconfigured). **No discover query, no param builder, no pagination, no response types, no timeout** — all of that is S-03's to build on top of the `request()` seam. The AI client (`src/lib/ai.ts`) is fully wired but **belongs to S-04**; S-03 is deterministic and AI-free.
- **The big design tensions to resolve in `/10x-plan`:** (1) **scoring weights + the diversity threshold** that guarantees wild-card ≠ safe-pick in genre/tone (the FR-009 guardrail, the one genuinely novel piece); (2) **ephemeral vs. persisted recommendations** — no `recommendations` table exists, and the established architecture is POST→redirect→server-render (PRG), which doesn't fit "compute 3 picks" cleanly; S-04 (justification per pick) and S-05 (select one pick) will likely want a durable recommendation identity; (3) **`runtime` is not on TMDB discover list items** — only the `with_runtime.lte` hard filter is free; actual per-candidate runtime costs a `/movie/{id}` subrequest each, in tension with the 50-subrequest cap and <10s NFR.
- **Runtime constraints are hard and documented:** 50 subrequests/request (free plan, the first limit hit), 10ms CPU/invocation (free), `<10s` NFR. Mitigation of record: "batch/limit candidate count." `astro dev` runs real workerd here, so the NFR and subrequest behavior are **locally verifiable** (per auto-memory + infrastructure.md).

## Detailed Findings

### A. Scoring inputs — data contracts (settled)

**`viewer_profiles`** — `supabase/migrations/20260603115857_viewer_profiles.sql`:
- `slot smallint NOT NULL check (slot IN (1,2))`, `unique (user_id, slot)` — exactly two profiles per user.
- `display_name text NOT NULL`; `preferred_genre_ids int[] NOT NULL default '{}'`; `excluded_genre_ids int[] NOT NULL default '{}'`; `note text` (nullable, unstructured).
- **Taste fields are genre-only + freeform note. No mood/intensity at profile level** — those are session attributes. If scoring wants per-viewer mood weighting, that's a profile-schema extension out of S-03 scope.

**`movie_night_sessions`** — `supabase/migrations/20260606085900_movie_night_sessions.sql`:
- `mood text` (nullable; validated to a 10-value vocab in the API, not the DB).
- `preferred_genre_ids int[]` / `excluded_genre_ids int[]` (NOT NULL default `'{}'`).
- `runtime_limit_minutes int` (nullable; `check (… IS NULL OR > 0)`; null = "no limit" → omit TMDB `with_runtime.lte`).
- `intensity text NOT NULL default 'medium' check (intensity IN ('low','medium','high'))`.
- `note text` (nullable). **No slot cap / unique constraint** — unbounded rows; S-03 reads the latest (`order by created_at desc limit 1`).

**Vocabularies** (static, server-validated, no runtime TMDB call):
- `src/lib/genres.ts` — `MOVIE_GENRES` = 19 TMDB movie genres (`interface MovieGenre {id:number;name:string}`); `isKnownGenreId(id)`. Comment (`genres.ts:9`) confirms ids come from TMDB `GET /genre/movie/list` → discover-ready.
- `src/lib/session-options.ts` — `MOODS` (10: light, funny, tense, thrilling, emotional, thought-provoking, cozy, dark, epic, romantic), `INTENSITIES` (low/medium/high), `type Intensity`, `DEFAULT_INTENSITY = "medium"`, `isKnownMood`, `isKnownIntensity`. Comments (`:6-13`) explicitly name these as **S-03 local-scoring signals** (TMDB discover has no mood/intensity param).

**TS row interfaces already declared** (reuse shapes): `ProfileRow` (`src/pages/profiles.astro:6-12`), `SessionRow` (`src/pages/sessions.astro:7-15`).

> S-02 was verified built-to-plan — no input-contract drift.

### B. TMDB retrieval surface (stub — S-03 must build the engine)

`src/lib/tmdb.ts` (47 lines, F-01 reachability stub):
- `createTmdbClient(): TmdbClient | null` (`:15-28`) → `{ baseUrl, request(path, init?) : Promise<Response> }`. Auth: `Authorization: Bearer ${TMDB_READ_ACCESS_TOKEN}` (`:23`) — **v4 read-access token (bearer), not v3 api_key**. Base `https://api.themoviedb.org/3`. Raw web-standard `fetch`, workerd-safe, no SDK.
- `pingTmdb()` (`:35-46`) — only `GET /authentication`, returns `.ok`. Returns `false` on any throw.
- **No timeout / no retry / no AbortController** (deliberate, subrequest-budget comment `:30-33`). Returns `null` when token absent (never throws).
- **Zero TMDB response types; no discover/configuration/movie-detail/genre-list calls anywhere.**

Env: `TMDB_READ_ACCESS_TOKEN` from `astro:env/server` (`tmdb.ts:1`), declared `astro.config.mjs:21` (server, secret, optional). Present in `.env.example` and `.dev.vars` (JWT-shaped, `scopes:["api_read"]`). The v3 `TMDB_API_KEY` was intentionally left unused.

Only caller today: `src/pages/api/health/integrations.ts` — auth-guarded (`401 JSON` if no `locals.user`, `:14-19`), `Promise.all([pingTmdb(), pingAi()])` (`:22`), returns `{tmdb, ai, detail?}`. This is the **auth-guard + concurrent-subrequest pattern to mirror** for the S-03 endpoint.

**What S-03 must add on top of the `request()` seam:**
- `/discover/movie` call + query-param builder: `with_genres` (preferred), `without_genres` or scoring penalty (excluded — note FR-006 prescribes *strong scoring penalty*, not hard exclusion, for excluded genres; only **runtime** is a hard filter), `with_runtime.lte` (when runtime non-null), `vote_average.gte` / `vote_count.gte`, `primary_release_date` window, `sort_by`, `page`.
- Multi-page retrieval (pagination) to get enough candidates to score — **capped** for the 50-subrequest budget.
- Response parsing + types for the fields scoring needs: `id`, `title`, `genre_ids`, `vote_average`, `popularity`, `release_date`, `overview`, `poster_path`. **Caveat:** discover list items do **not** include `runtime` — only the `with_runtime.lte` query filter is free; real per-candidate runtime = one `/movie/{id}` subrequest each.
- A seam for future **watched-exclusion** (S-05): TMDB has no "exclude these movie ids" param → client-side filter step. S-03 must isolate retrieval behind a seam a later `excludeWatched(candidates)` can wrap, without depending on it.
- An `AbortController`/timeout budget to honor `<10s`.

### C. AI client + env/config + degradation (context for the <10s NFR)

`src/lib/ai.ts` (61 lines, fully wired — **S-04 territory, untouched by S-03**):
- `createAiClient(): AiClient | null` (`:22`) → `complete(messages, maxTokens): Promise<Response>` (raw response). OpenRouter `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer ${OPENROUTER_API_KEY}`, body `{model, messages, max_tokens}`. Model = `AI_MODEL ?? "openai/gpt-4o-mini"` (`:6,26`). `pingAi()` (`:49`). Returns `null` when unconfigured (never throws), no timeout.

`astro.config.mjs:17-25` — complete `astro:env` schema, all `context:"server", access:"secret", optional:true`: `SUPABASE_URL`, `SUPABASE_KEY`, `TMDB_READ_ACCESS_TOKEN`, `OPENROUTER_API_KEY`, `AI_MODEL`. Adapter `cloudflare()`, `output:"server"`. **S-03 needs no new env field.**

`src/lib/config-status.ts` — `configStatuses` (Supabase / TMDB / AI configured-booleans + Polish messages; AI message frames justifications as a disable-able feature) and derived `missingConfigs`. `Layout.astro` renders a `<Banner>` per `missingConfigs` — reuse to surface a degraded "TMDB unavailable" state.

**Graceful-degradation contract (uniform):** every client factory (`supabase.ts:6-8`, `tmdb.ts:15-18`, `ai.ts:23-25`) returns `null` when unconfigured and never throws. Any new S-03 service module must follow this.

**Degradation policy (infrastructure.md:97, roadmap.md:137):** AI is a feature flag; **S-03 scoring must produce the 3 picks without AI**. AI justifications (S-04) layer on and degrade if upstream is slow/down. So the S-03 `<10s` budget is spent on TMDB subrequests + CPU scoring, not AI latency.

### D. API / page / UI patterns to mirror

**API skeleton** (`src/pages/api/sessions.ts:28-126`, `profiles.ts`):
```ts
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  // textField(form,name).trim(); parseGenreIds via form.getAll() (Number+isKnownGenreId+dedupe, null on bad)
  // validate → on failure: fail(context, msg)  →  redirect `/path?${new URLSearchParams({error})}`
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail(context, "Supabase is not configured");
  const user = context.locals.user;
  if (!user) return context.redirect("/auth/signin");
  // … write … then context.redirect(`/path?saved=${id}`)
};
```
- Helpers `textField`/`parseGenreIds`/`fail` at `sessions.ts:6-26`. Preferred/excluded overlap rejected (`:53-55`). Insert-vs-update branches on hidden `session_id`.
- **Auth note (from F-01):** `PROTECTED_ROUTES` does a 302→signin (page-oriented). An **API** endpoint should guard in-route with `401 JSON` (per `integrations.ts:14-19`), not rely on the prefix list.

**Astro page** (`sessions.astro`, `profiles.astro`): frontmatter builds RLS client + loads rows `if (supabase && user)`; reads `Astro.url.searchParams` (`error`/`saved`); maps rows → island props inline; wraps in `<Layout title>`; `client:load` hydration set in the parent.

**Styling vocabulary** (`Layout.astro` + pages): shell `bg-cosmic min-h-screen p-4`, content `mx-auto max-w-2xl py-8`; glass card `rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl`; gradient heading `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text … text-transparent`; back link `text-sm text-purple-300 hover:underline`. **Three-role results view → `grid gap-6 md:grid-cols-3`, one glass card per role.**

**React island / shared primitives:** native `<form method="POST">` (no fetch); repeated hidden inputs sharing a `name` for genre arrays (`SessionForm.tsx:154-159`); `client:load` in parent; `SubmitButton` (useFormStatus), `ServerError`, `FormField` under `src/components/auth/`. **shadcn surface is tiny:** only `src/components/ui/button.tsx` (Button + buttonVariants) + `LibBadge.astro`. No Card/Badge(React)/Select/Dialog — S-03 hand-rolls result cards from the glass vocabulary (or adds shadcn components if the plan chooses).

**Dashboard** (`dashboard.astro:17-30`): a `flex flex-wrap gap-3` row of anchor-buttons (`/profiles`, `/sessions`); S-03 adds a consistent "Get recommendations" entry.

### E. Watched-exclusion & persistence (greenfield for S-03)

- **S-05 has shipped nothing** — no `watched` table/route/logic anywhere in `src/` or `supabase/`. S-03 must not depend on it; isolate retrieval behind an exclusion-ready seam.
- **No `recommendations` table exists.** Architecture is PRG (POST→redirect→server-render), which doesn't fit "compute 3 picks." **Design tension (decide in /10x-plan):** ephemeral (simplest, <10s-safe, picks not addressable) vs. persisted (`recommendations` + per-pick rows so S-04 can attach a justification per pick and S-05 can reference the selected pick). Minimum: design the in-memory pick shape to be persistence-ready — `{ role, tmdbMovieId, score, … }` — even if the table is deferred.

## Code References

- `supabase/migrations/20260603115857_viewer_profiles.sql` — profile taste fields (genres + note), slot 1/2 cap.
- `supabase/migrations/20260606085900_movie_night_sessions.sql:18-39` — session input contract (6 FR-004 fields).
- `src/lib/genres.ts` — 19 TMDB genre ids + `isKnownGenreId`.
- `src/lib/session-options.ts:6-13` — mood/intensity vocab; comments name S-03's local scoring step.
- `src/lib/tmdb.ts:15-28,35-46` — `request()` seam to extend; `pingTmdb`; bearer v4 token; no discover/types/timeout.
- `src/lib/ai.ts:22-60` — OpenRouter client (S-04); null-when-unconfigured contract.
- `src/lib/supabase.ts:5-24` — RLS SSR client factory `createClient(headers, cookies)`; null when unconfigured.
- `src/lib/config-status.ts` — `configStatuses` / `missingConfigs` degradation report.
- `astro.config.mjs:17-25` — full astro:env schema (no new field needed for S-03).
- `src/pages/api/sessions.ts:6-126` / `src/pages/api/profiles.ts` — POST handler skeleton, helpers, redirect-with-error idiom.
- `src/pages/api/health/integrations.ts:14-22` — in-route 401 auth guard + `Promise.all` subrequest pattern.
- `src/middleware.ts:4,14-29` — `PROTECTED_ROUTES = ["/dashboard","/profiles","/sessions"]`; `locals.user` population; 302 guard.
- `src/pages/sessions.astro:7-70` / `src/pages/profiles.astro` — server-load + searchParams + island-props pattern.
- `src/layouts/Layout.astro` — Banner(missingConfigs) + glass/`bg-cosmic` styling.
- `src/components/sessions/SessionForm.tsx:78-159` — native form POST + repeated genre fields + `client:load`.
- `src/components/ui/button.tsx` — the only shadcn React primitive.
- `src/pages/dashboard.astro:17-30` — entry-point anchor pattern.

## Architecture Insights

- **Uniform "null-when-unconfigured, never throw" factory contract** across supabase/tmdb/ai is the spine of graceful degradation; honor it in any new S-03 module.
- **RLS does the access control for free** — reading profiles + session via the cookie-JWT SSR client auto-scopes to the operator; no service-role, no manual `where user_id`.
- **PRG everywhere** — the app has no client-side fetch/JSON pattern yet. S-03's "compute" step is the first thing that doesn't fit form-POST→redirect; the plan must pick a rendering approach (e.g. POST→compute→persist→redirect-to-results-page, vs. a GET results page that computes on load).
- **workerd is the real local runtime** (`astro dev`): <10s NFR + 50-subrequest cap are testable locally — a local pass is genuine runtime proof (auto-memory: [[astro-dev-runs-in-workerd]]).
- **The only genuinely novel logic in S-03 is the deterministic scoring + diversity rule** (FR-007/FR-009); everything else is reuse. Expect `/10x-plan` to split this slice (retrieval, scoring/diversity, results UI — and possibly a persistence change), as the roadmap predicts (roadmap.md:125).

## Historical Context (from prior changes)

- `context/changes/movie-night-session-prefs/plan.md:5,13,49` — S-02 explicitly defines itself as "the input contract S-03 reads"; only runtime + genres are TMDB hard filters; mood/intensity are local scoring signals; runtime null → omit `with_runtime.lte`. Built-to-plan (no drift).
- `context/archive/2026-06-02-provision-external-apis/plan.md:19,42,55-56,178-181` — F-01 verified reachability only and **explicitly deferred discover/filtering/scoring to S-03**; documents the 50-subrequest cap, workerd≠Node, the `<10s` verification path, and the `request()` seam as "the S-03 reuse the plan anticipated" (`reviews/impl-review.md:21`). No `research.md` in that archive.
- `context/foundation/infrastructure.md:36,64,69,76,96,97` — risk register: subrequest cap is first limit; pre-mortem warns TMDB discover + AI fan-out toward 50; mitigation "batch/limit candidate count and AI calls per request"; AI is a feature flag; `astro dev` = real workerd.
- `context/foundation/prd.md:78-96` — FR-005 (discover hard filters; semantic matching local), FR-006 (hard-filter runtime, **penalize** excluded genres), FR-007 (score by both viewers + mood/runtime/rating/popularity), FR-008 (≤3), FR-009 (3 distinct; wild card ≠ safe pick in genre/tone), NFR <10s.
- `context/foundation/lessons.md` — one lesson (reconcile roadmap Backlog Handoff after archiving); not engine-relevant but applies when S-03 archives.

## Open Questions

1. **Scoring weights & diversity threshold** (the FR-009 guardrail) — how to weight per-viewer genre match vs. excluded-genre penalty vs. mood/intensity vs. rating/popularity, and what concrete metric guarantees wild-card differs from safe-pick in genre or tone. Owner: user/team; tunable in `/10x-plan`. This is the slice's core novel decision.
2. **Ephemeral vs. persisted recommendations** — does S-03 persist a `recommendations` (+ per-pick) row, or render ephemerally? S-04 (justification per pick) and S-05 (select one pick) lean toward persistence. May spawn a separate persistence change.
3. **Candidate-count budget** — how many discover pages / candidates to score to stay under 50 subrequests and <10s, and whether to pay `/movie/{id}` subrequests for real per-candidate runtime or rely solely on the `with_runtime.lte` hard filter.
4. **Excluded genres: filter or penalize?** FR-006 says strong *scoring penalty* (not hard exclusion) for excluded genres — confirm discover uses `with_genres` only (or also `without_genres`) and the penalty lives in scoring.
5. **Rendering approach** under the PRG-only architecture — results page that computes on GET vs. POST→compute→persist→redirect.

## Related Research

- No prior `research.md` under `context/changes/**` or `context/archive/**` for the recommendation engine (F-01 archive has none). This is the first.
