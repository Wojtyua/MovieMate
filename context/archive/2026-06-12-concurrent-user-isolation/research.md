---
date: 2026-06-12T16:40:34+0200
researcher: Wojciech Derlikiewicz
git_commit: 7df157cfc9f6568c17260cb0d11a18f0e32238ea
branch: main
repository: MovieMate
topic: "Concurrent logged-in users break each other (multi-user isolation defect)"
tags: [research, codebase, auth, supabase-ssr, rls, cloudflare-workers, concurrency, security]
status: complete
last_updated: 2026-06-12
last_updated_by: Wojciech Derlikiewicz
---

# Research: Concurrent logged-in users break each other (multi-user isolation defect)

**Date**: 2026-06-12T16:40:34+0200
**Researcher**: Wojciech Derlikiewicz
**Git Commit**: 7df157cfc9f6568c17260cb0d11a18f0e32238ea
**Branch**: main
**Repository**: MovieMate (Wojtyua/MovieMate)

## Research Question

Production defect (roadmap S-08): with one user logged in the app works fine, but
when a second user logs in while the first is creating a session and choosing movie
preferences, the app stops working — concurrent use by two logged-in users is
effectively impossible.

The change brief carried a *leading hypothesis to confirm, not assume*: shared
mutable server-side auth/session state across concurrent requests on the Astro SSR /
Cloudflare Workers runtime (e.g. a non-per-request Supabase client whose identity gets
overwritten when a second user authenticates). Three questions to resolve:

1. Confirm the actual root cause against current code.
2. Determine whether this is pure disruption or also a cross-account **data leak**.
3. Establish a deterministic repro.

## Summary

**The stated hypothesis is not supported by the current code.** Every server entry
point builds its Supabase client through a per-request factory
(`createClient(headers, cookies)` in `src/lib/supabase.ts:5`) that reads auth state
from the request's own cookies. There is **no module-scope Supabase client, no
shared `currentUser`, and no mutable per-user state at module scope anywhere in
`src/`**. The "identity gets overwritten by a second login" mechanism described in
the brief does not exist in this codebase.

**Data-leak verdict: low risk under the documented configuration, but there is a real
defense-in-depth gap.** All five domain tables enable RLS with correct owner-scoped
`auth.uid() = user_id` policies, and `SUPABASE_KEY` is documented throughout as the
**anon** key, so PostgREST runs every query as the authenticated cookie-holder. The
data queries in the pages, however, carry **no explicit `.eq("user_id", …)`** — they
trust RLS as the *sole* authority. The most exposed query is the session error-refill
(`src/pages/sessions.astro:28-34`): `order(created_at desc).limit(1)` with no owner
filter. Under the anon key this returns the caller's own latest row; the instant RLS
is weakened (a `service_role` key misconfigured into `SUPABASE_KEY`, a future
RLS-disabled table, a `security definer` view), it silently returns *another user's*
latest session — exactly the "creating a session" surface the reporter described.
**This requires verifying the production `SUPABASE_KEY` value, which is not readable
from the repo.**

**Most likely real cause of the reported breakage is a runtime/infra concurrency
limit, not a code identity bug** — and confirming it requires the deterministic repro
the brief asks for, because static reading cannot observe it. Ranked candidates are in
§"Architecture Insights". The single highest-value next step is the two-browser repro
in §"Deterministic Repro", instrumented to capture *which* layer fails (TMDB,
OpenRouter, Supabase auth, or Worker limits).

## Detailed Findings

### The auth/session client is per-request-correct (hypothesis refuted)

`src/lib/supabase.ts:5-24` is a **factory function**, not a singleton. It calls
`createServerClient` (from `@supabase/ssr@0.10.3`) fresh on every invocation, wiring
cookie `getAll`/`setAll` to the *request's* `Headers` and the *request's*
`AstroCookies`:

- `getAll()` parses `requestHeaders.get("Cookie")` — request-scoped (`supabase.ts:11-16`).
- `setAll()` writes through the request's `cookies.set` (`supabase.ts:17-21`).

Every entry point calls this factory per request — verified across the whole tree:

- `src/middleware.ts:14` — `createClient(context.request.headers, context.cookies)`
- `src/pages/sessions.astro:18`, `src/pages/profiles.astro:13`,
  `src/pages/sessions/[id]/recommendations.astro:11`
- `src/pages/api/recommendations.ts:79`, `src/pages/api/watched.ts:22`,
  `src/pages/api/profiles.ts:33`
- `src/pages/auth/callback.ts:13`, `src/pages/api/auth/signin.ts:9`,
  `signup.ts:9`, `signout.ts:5`

No call site stores the client at module scope or reuses it across requests.

### No shared mutable per-user state anywhere in `src/`

A full sweep for module-scope mutable state, globals, and caches returned **only
immutable lookup tables and per-call locals**:

- `globalThis` / `global.` — zero hits in `src/` (only a CSS import in `Layout.astro:2`).
- Module-scope `new Map`/`new Set`: all are static, immutable lookups built from
  constants — `src/lib/genres.ts:38,45`, `src/lib/session-options.ts:44,47`,
  `src/components/sessions/PicksGrid.tsx:32`. None hold user data.
- Every other `Set`/`Map` is a local inside a function or a React state updater
  (`SessionForm.tsx`, `ProfileForm.tsx`, `SecondViewer.tsx`, `recommend/*`).
- The pipeline (`src/lib/recommend-run.ts`) threads `user.id` as an explicit
  parameter (`recommend-run.ts:46`) and keeps **all** state in function locals
  (`aiGenreIds`, `candidates`, the `AbortController`/`setTimeout` budget at
  `recommend-run.ts:99-102`). Nothing escapes the call.
- The TMDB and AI client factories (`src/lib/tmdb.ts:15`, `src/lib/ai.ts:44`) close
  over **config only** (`TMDB_READ_ACCESS_TOKEN`, `OPENROUTER_API_KEY`, model id),
  never user data.

On Cloudflare Workers module scope is shared across requests within an isolate, so
this sweep is the decisive test for the brief's hypothesis — and it comes back clean.

### Auth identity uses the secure path

Identity is resolved once per request in middleware via `supabase.auth.getUser()`
(`src/middleware.ts:19`) — the server-validated call, **not** the insecure
`getSession()`. Result is stashed in `context.locals.user` (`middleware.ts:20`), which
is per-request in Astro. `getSession`/`getClaims` are used nowhere
(`src/middleware.ts:19` is the only `getUser`/`getSession`/`getClaims` hit in `src/`).
Pages and API routes read `Astro.locals.user` (e.g. `sessions.astro:17`,
`recommendations.ts:85`, `Topbar.astro:2`) rather than re-deriving it.

### RLS is correct and consistent across all tables

Every domain table enables RLS with four per-command owner-scoped policies
(`using (auth.uid() = user_id)` for select/delete, `with check` for insert,
both for update) and an owner column defaulting to `auth.uid()`:

- `viewer_profiles` — `supabase/migrations/20260603115857_viewer_profiles.sql:39-62`
- `movie_night_sessions` — `supabase/migrations/20260606085900_movie_night_sessions.sql`
- `recommendations` + `recommendation_picks` —
  `supabase/migrations/20260606115345_recommendations.sql:65-102`
- `watched` — `supabase/migrations/20260611085444_watched.sql:35-58`
- canonical template — `supabase/migrations/20260530165958_rls_convention_example.sql:30-52`

`SUPABASE_KEY` is documented as the **anon public key** in `README.md:109,136,140`,
`AGENTS.md:11`, and confirmed in prior plans
(`context/archive/2026-05-30-persistence-baseline-rls/plan.md:13`). Under that key,
the per-request cookie JWT drives `auth.uid()` and RLS scopes every query to its
owner — there is no cross-user read at the DB layer.

### The defense-in-depth gap: app queries rely on RLS alone

Page/endpoint reads carry **no explicit owner predicate** — they depend entirely on
RLS being correctly configured *and* on the correct anon key being deployed:

- **Highest exposure** — `src/pages/sessions.astro:28-34`: on the error-refill path,
  `movie_night_sessions … order("created_at", {ascending:false}).limit(1).maybeSingle()`
  with no `.eq("user_id", user.id)`. The code comment ("the just-persisted session is
  the latest row") is true *only* under owner-scoped RLS. With RLS bypassed this
  returns the globally latest session — a different user's preferences — which both
  breaks User A's flow and leaks User B's data. This is the exact scenario the report
  describes.
- `src/pages/profiles.astro:16-20` — `viewer_profiles … maybeSingle()`, no owner filter.
- `src/pages/sessions.astro:45-48` — taste-core seed, `maybeSingle()`, no owner filter.
- `src/pages/sessions/[id]/recommendations.astro:15-26` — scoped by `session_id` (a
  URL param) but **not** by `user_id`; relies on RLS to reject another owner's id.

These are correct today but fail *open*, not *closed*. Adding explicit
`.eq("user_id", user.id)` makes them fail safe and removes the single-point dependence
on the deployed key being anon.

### Cloudflare / runtime configuration

`astro.config.mjs` — `output: "server"`, `adapter: cloudflare()`, all secrets declared
`context: "server", access: "secret"` via `astro:env`. `wrangler.jsonc` —
`nodejs_compat`, `compatibility_date 2026-05-08`, observability enabled. No KV /
Durable Object / cache binding that could share state. Per memory, local `astro dev`
runs real workerd, so the repro below exercises the production runtime.

## Code References

- `src/lib/supabase.ts:5-24` — per-request `createServerClient` factory (anon key + cookie JWT)
- `src/middleware.ts:14-23` — per-request client + `getUser()` → `locals.user`
- `src/lib/recommend-run.ts:46-49,99-102` — pipeline threads `user.id`, all state local
- `src/pages/sessions.astro:27-34` — **unscoped** latest-session refill (top leak surface)
- `src/pages/profiles.astro:15-21` — unscoped taste-core read (RLS-only)
- `src/pages/sessions/[id]/recommendations.astro:13-29` — session-id scoped, RLS for owner
- `src/pages/api/recommendations.ts:79-146` — per-request client, `locals.user` guard, heavy pipeline
- `src/pages/api/auth/signin.ts:9-19` — per-request `signInWithPassword`
- `supabase/migrations/20260606115345_recommendations.sql:65-102` — owner-scoped RLS (representative)

## Architecture Insights — ranked alternative causes for the breakage

Because the code holds no shared per-user state, the reported "second login breaks the
first" almost certainly originates at the runtime/infra layer. Candidates, ranked, each
with how the repro disambiguates it:

1. **Shared external quota / Worker subrequest budget under concurrent pipeline runs.**
   `/api/recommendations` is heavy: AI parse + a relaxation ladder of TMDB discover
   calls (`pages: 3` each, multiple attempts — `recommend-run.ts:107-145`) + entity
   resolution + Supabase reads/writes. Two concurrent runs share one TMDB token and one
   OpenRouter key (single global credentials) and the Worker's per-request subrequest /
   simultaneous-connection ceiling. A tripped shared limit surfaces as "the app stops
   working" for whoever is mid-run. *Repro signal:* failures correlate with concurrent
   `/api/recommendations`, and logs show TMDB/OpenRouter 429s or Worker subrequest
   errors — not auth errors.
2. **`@supabase/supabase-js` global auth lock (`processLock`) contention.** In a
   non-browser runtime supabase-js serializes auth operations through a module-global
   lock shared by all GoTrueClient instances in the isolate. A second user's
   `signInWithPassword` and the first user's in-flight middleware `getUser()` calls
   contend on it; under load this manifests as slow/timed-out auth, which looks like
   "login broke everything." *Repro signal:* the *login* step itself hangs/times out
   while a concurrent request is in flight, with auth-layer (not TMDB) symptoms.
3. **A genuine module-scope leak outside `src/`** (a dependency or the adapter
   entrypoint). Low probability given the clean app code, but not excluded by static
   reading. *Repro signal:* User A's screen shows User B's actual data (not just an
   error) even with the anon key confirmed.
4. **Production `SUPABASE_KEY` is not the anon key.** If a `service_role`/secret key was
   deployed to the Worker/CI secret, RLS is bypassed and the unscoped queries above
   return cross-user rows. *Repro signal:* the IDOR probe below succeeds, or the
   sessions refill shows another account's preferences. **Verify the actual Worker
   secret — this cannot be read from the repo.**

## Deterministic Repro (to produce before planning)

Two parts: confirm the breakage, and separately probe for the leak.

**A. Breakage repro (two isolated sessions):**
1. Browser 1 (User A): sign in, open `/sessions`, fill preferences (include a free-text
   note so the AI + relaxation ladder maximize subrequests), submit `/api/recommendations`.
2. Browser 2 / incognito (User B): while A's run is in flight, sign in and submit a run.
3. Observe which side fails and *where*. Instrument with Worker logs / `observability`
   (already enabled in `wrangler.jsonc`) to capture whether the failure is TMDB/OpenRouter
   (429/timeout), Supabase auth (lock/timeout), or a Worker subrequest/CPU limit.
   This maps the failure onto candidates 1–2 above.

**B. Cross-account leak probe (RLS / key verification):**
1. As User A, note one of A's session ids and recommendation ids.
2. As User B, request `GET /sessions/<A-session-id>/recommendations` and any `/api/*`
   read; trigger A's `/sessions?error=…` refill while B holds a newer session.
3. Expected (anon key + RLS): B sees empty / 403 / only B's own rows. If B sees A's
   data, RLS is bypassed → candidate 4 confirmed (check the deployed `SUPABASE_KEY`).

> Note: a "two accounts in the **same** browser" test is *not* a valid repro — both
> share the `sb-<ref>-auth-token` cookie, so the second login legitimately overwrites
> the first. That is expected behavior, not the defect under investigation. The repro
> must use two separate cookie jars (two browsers / incognito).

## Risks-to-verify ↔ test-plan mapping

This change is roadmap **S-08** and lands squarely on **test-plan Risk #4** ("own-data
leak / IDOR", `context/foundation/test-plan.md:46`) and its rollout **Phase 3**
(own-data isolation, two-user integration test). The defense-in-depth gap here is the
concrete code surface Phase 3's "User B cannot reach User A's data" test must cover —
specifically the unscoped reads in `sessions.astro` / `profiles.astro` /
`recommendations.astro`. If candidate 1 (shared external quota) proves out, it also
touches Risk #2 (graceful degradation, Phase 2).

## Historical Context (from prior changes)

- `context/archive/2026-05-30-persistence-baseline-rls/plan.md:13-14` — establishes the
  locked convention: per-request `createServerClient` with the **anon key** + cookie
  JWT, RLS enforced "the moment tables exist," secrets convention "must not change."
  Confirms the intended (correct) design the live code still follows.
- `context/archive/2026-06-06-movie-night-session-prefs/plan.md:10` and
  `2026-06-03-viewer-profiles/plan.md:10` — "the per-request client already enforces
  RLS with zero changes" — the same RLS-only reliance that is now the defense-in-depth
  gap.
- `context/archive/2026-06-11-select-and-mark-watched/research.md:68` — owner-scoped RLS
  template, reaffirms anon-key + cookie-JWT model.
- `docs/reference/persistence-conventions.md:16` — source-of-truth statement that the
  client uses anon key + user cookie.

## Related Research

- `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3 — the IDOR/own-data-isolation
  rollout phase this change feeds.
- `context/archive/2026-06-06-scored-recommendations/research.md:83` — confirms the
  `astro:env` secret schema unchanged.

## Open Questions

1. **What key is actually deployed as the Worker/CI `SUPABASE_KEY`?** Repo says anon;
   production value is unverifiable from here. Resolve before ruling out the leak.
2. **Does the breakage reproduce with concurrent logins alone, or only with concurrent
   `/api/recommendations` runs?** Determines whether the cause is auth-lock contention
   (candidate 2) or external/Worker quota (candidate 1).
3. **What does the Worker observability log show at the moment of failure** — a TMDB/
   OpenRouter 429, a Supabase auth timeout, or a Worker subrequest/CPU limit? This is
   the single fact that picks the root cause.
4. Should the fix add explicit `.eq("user_id", user.id)` to the unscoped reads
   regardless of root cause (fail-safe defense in depth)? Recommended yes.

## Outcome — no reproducible defect (2026-06-12)

Closed without a code change. The reported breakage **does not reproduce**: the operator
confirmed concurrent use works in practice, consistent with this investigation (clean
per-request auth, no shared mutable state, RLS on + correct on all tables, DB-layer
isolation already proven by pgTAP). The leading hypothesis is **refuted**.

Resolution of the Open Questions above:

1. **Deployed key** — live anon key is `role: anon`; repo docs say `SUPABASE_KEY` is the
   anon key. The Worker secret value itself was not read; left to the operator to
   confirm. No evidence of a `service_role` deployment.
2. **Concurrent logins vs concurrent runs** — not bisected; the breakage did not recur,
   so the diagnostic repro (planned in `plan.md`) was not built.
3. **Runtime failure signature** — none captured; auth/api logs empty over the 24h
   window, no error reproduced.
4. **Defense-in-depth owner filters** — still recommended as a no-regret hardening
   (no-op under the anon key), but **deferred** as optional; not required to close this.

**Caveat:** "works" reflects normal/operator use, not a load-test of genuinely
concurrent heavy pipeline runs. If the symptom returns under real concurrency, reopen
using `plan.md` (the "harden + repro" plan) as the starting point.
