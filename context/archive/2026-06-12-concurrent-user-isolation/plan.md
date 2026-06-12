# Concurrent User Isolation — Harden + Repro Implementation Plan

## Overview

A production report (roadmap S-08) claims that when a second user logs in while a
first user is mid-session, "the app stops working" — concurrent use by two logged-in
users is effectively impossible. Research (`research.md`) **refuted the stated
hypothesis** (a shared, non-per-request auth client): the code uses the textbook
per-request `@supabase/ssr` pattern, holds zero shared mutable per-user state, RLS is
enabled and correct on every table (confirmed live via Supabase advisors + `list_tables`),
and DB-layer isolation is already proven by pgTAP. The breakage mechanism is therefore
**unconfirmed**, and read-only diagnostics could not capture it (auth/api logs empty).

This plan does **not** pretend to fix an unknown bug. It does two no-regret things that
are correct regardless of root cause:

1. **Repro + diagnose** — build a deterministic, instrumented reproduction that pins
   *which layer* actually fails under two concurrent authenticated flows, and confirms
   there is no cross-user data leak.
2. **Harden** — close the app-layer defense-in-depth gap (reads that trust RLS alone)
   by adding explicit owner filters, so isolation no longer depends solely on RLS plus
   the correct key being deployed.

The targeted fix for whatever breakage Phase 1 identifies is a **separate follow-up
change**, opened once the root cause is named.

## Current State Analysis

- **Auth client is per-request-correct.** `src/lib/supabase.ts:5-24` is a factory
  (`createServerClient` per call, cookie `getAll`/`setAll` bound to the request). Every
  entry point calls it per request (`middleware.ts:14`, `sessions.astro:18`,
  `profiles.astro:13`, `recommendations.astro:11`, `api/recommendations.ts:79`, the
  `api/auth/*` routes). Identity comes from the secure `getUser()` (`middleware.ts:19`),
  stashed in per-request `Astro.locals.user`. No `getSession()` anywhere.
- **No shared mutable per-user state in `src/`.** Module-scope `Map`/`Set`s are
  immutable lookup tables (`genres.ts`, `session-options.ts`, `PicksGrid.tsx`); the
  pipeline (`recommend-run.ts`) threads `user.id` and keeps all state in locals.
- **RLS is on and correct** on all six tables (live `list_tables` → `rls_enabled:true`;
  security advisor shows only an unrelated leaked-password WARN). Owner-scoped policies
  per `supabase/migrations/*`. The deployed anon key is `role: anon` (publishable-keys
  check); **the production Worker `SUPABASE_KEY` value is being verified by the user**.
- **DB-layer isolation already tested.** `supabase/tests/*_isolation.sql` (5 files, run
  via `npm run db:verify`) prove RLS partitions every table by owner.
- **App-layer defense-in-depth gap.** Four reads carry no explicit `.eq("user_id", …)`
  and rely entirely on RLS: `sessions.astro:28-34` (latest-session error-refill,
  `order(created_at).limit(1)` — the read the report implicates), `sessions.astro:45-48`
  (core-seed), `profiles.astro:16-20` (core), `recommendations.astro:15-21` (scoped by
  `session_id` URL param but not `user_id`).
- **No app-level test runner.** Vitest is not bootstrapped (test-plan §3 Phase 1, not
  started). pgTAP is wired. `package.json` is `"type":"module"`, Node `22.14.0` (global
  `fetch`), no `scripts/` dir yet. Local Supabase has `enable_confirmations = false`
  (`supabase/config.toml:209`), so programmatic signup yields a live session with no
  email step.

## Desired End State

- A committed, re-runnable repro (`scripts/repro-concurrent-isolation.mjs` + an `npm`
  script) that drives two concurrent authenticated flows against local `astro dev`
  (real workerd), exercises the heavy recommendation pipeline concurrently, prints
  per-layer timing/outcome, and **asserts cross-user isolation**. Running it produces a
  clear verdict: either it reproduces the breakage and names the failing layer, or it
  demonstrates two concurrent users working — both are documented in `research.md`.
- All four unscoped app-layer reads carry an explicit `.eq("user_id", user.id)` filter;
  the repro's isolation assertions stay green; `npm run lint` and `astro check` pass.
- `research.md` / `change.md` record the confirmed root-cause finding and the user's
  key-verification result; test-plan §6.3 cookbook documents the app-layer isolation
  probe pattern.

**Verification:** `node scripts/repro-concurrent-isolation.mjs` (or `npm run repro:isolation`)
exits 0 with isolation assertions passing and a printed per-layer report; `npm run lint`,
`astro check`, and `npm run db:verify` all pass.

### Key Discoveries

- Repro can authenticate through the app's own `/api/auth/signin` (form POST) and reuse
  the returned `Set-Cookie` jar — exercising the real workerd cookie/auth path end to
  end, no need to hand-assemble `sb-<ref>-auth-token` chunks. (`src/pages/api/auth/signin.ts:13`)
- `enable_confirmations = false` locally (`supabase/config.toml:209`) → `signup.ts`
  returns a live session immediately, so two test users can be created without Mailpit.
- `recommendRun` already returns layer-distinct failure messages ("Could not reach
  TMDB, try again", "Recommendations unavailable: TMDB is not configured", etc.,
  `src/lib/recommend-run.ts:61,134,150`) — useful coarse signal the script classifies,
  complemented by gated server-side timing.
- The heavy path (note → AI parse + TMDB relaxation ladder, `pages:3` each) is the
  realistic subrequest/quota pressure point (`recommend-run.ts:107-145`).

## What We're NOT Doing

- **Not** writing the targeted fix for the actual breakage — Phase 1 identifies the
  layer; the fix is a separate follow-up change (its shape depends on the finding).
- **Not** bootstrapping Vitest or Playwright, and **not** pulling test-plan Phase 1/4
  infra forward. The formal app-layer Vitest integration test remains test-plan Phase 3,
  deferred until Vitest exists.
- **Not** adding new pgTAP assertions — DB-layer isolation is already proven.
- **Not** changing user-visible behavior. The owner filters are a no-op under the anon
  key; this is hardening, not a UX change.
- **Not** reading/altering the deployed Worker secret — the user verifies it out of band.
- **Not** introducing a shared query-helper abstraction (chosen: inline filters).

## Implementation Approach

Phase 1 builds the diagnostic instrument and runs it to convert the "unconfirmed cause"
into a named finding. Phase 2 lands the root-cause-agnostic hardening and re-uses the
Phase 1 probe to prove it changed nothing for legitimate users while closing the
RLS-only gap. Phase 3 makes the isolation probe a durable, re-runnable regression and
writes the findings + cookbook entry back. Instrumentation added in Phase 1 is gated
behind a debug flag so it can stay in the tree without noise.

## Critical Implementation Details

- **Per-layer instrumentation must be gated and server-side.** The external calls run
  inside the Worker, invisible to the Node script over HTTP. Add lightweight timing
  around each external boundary (Supabase `getUser` in middleware; TMDB discover, AI
  parse, Supabase reads/writes in `recommend-run`) that emits a structured line
  (e.g. JSON with a request-correlation id + layer + ms + ok/err) **only when a debug
  env flag is set**, to the Worker console — which `astro dev` surfaces on stdout. The
  repro script launches/attaches to `astro dev`, captures stdout, and correlates by id.
  Keep it off by default; never log secrets or PII (no tokens, no emails).
- **Two concurrent flows, real overlap.** The script must fire both users' heavy
  `/api/recommendations` POSTs so they are genuinely in flight simultaneously
  (`Promise.all`, not sequential), to pressure shared TMDB/OpenRouter quota and the
  Worker subrequest budget — the realistic worst case from the report.
- **Heavy mode needs keys.** The heavy pipeline requires `TMDB_READ_ACCESS_TOKEN` and
  (for the note path) `OPENROUTER_API_KEY` in the repro env. Document a light mode
  (auth + reads only, no external keys) so the harness still runs in their absence and
  can isolate the auth-layer hypothesis from the quota-layer one.

## Phase 1: Deterministic repro harness + per-layer instrumentation

### Overview

Build the instrumented two-user repro and run it to pin the breakage layer (or prove
concurrent use works), and confirm no cross-user leak.

### Changes Required

#### 1. Repro harness script

**File**: `scripts/repro-concurrent-isolation.mjs` (new)

**Intent**: Drive two concurrent authenticated user flows against a running local
`astro dev` and report, per layer, what happened — reproducing the reported breakage
deterministically or demonstrating it does not occur. Doubles as the app-layer
cross-user isolation probe.

**Contract**: A Node ESM script (Node 22 global `fetch`, no new deps). Reads a base URL
(default `http://127.0.0.1:4321`) and a `--mode=light|heavy` flag (default `heavy`).
Steps: (1) ensure two test users exist via `POST /api/auth/signup` (idempotent — treat
"already registered" as success), capturing each user's cookie jar from `Set-Cookie`;
(2) **heavy mode**: both users `POST /api/auth/.../api/recommendations` with a populated
form (mood, preferred/excluded genres, a free-text `note`) concurrently via
`Promise.all`, following redirects manually so the final `?error=` or
`/sessions/<id>/recommendations` target is captured per user; **light mode**: both users
concurrently `GET /sessions`, `/profiles`; (3) **isolation assertions** — user B
requests user A's `GET /sessions/<A-session-id>/recommendations` and user A's flows, and
the script asserts B never receives A's data (empty/redirect/403); (4) print a per-layer
report (from captured `astro dev` stdout instrumentation, correlated by request id) and
a final PASS/FAIL with a one-line root-cause classification. Non-zero exit on any
isolation failure or unhandled error. Manage cookies manually (parse `Set-Cookie`, send
`Cookie`) — do not depend on a cookie-jar library.

#### 2. Gated per-layer server instrumentation

**File**: `src/middleware.ts`, `src/lib/recommend-run.ts`

**Intent**: Emit per-layer timing/outcome for the external boundaries so the script can
attribute a failure to auth vs TMDB vs OpenRouter vs Supabase data, without guessing.

**Contract**: A tiny internal helper (e.g. `src/lib/debug-timing.ts`, new) exporting a
gated `timeLayer(label, reqId, fn)` that, when `DEBUG_CONCURRENCY` (new optional
`astro:env/server` boolean/string field) is set, measures `fn` and `console.log`s one
structured JSON line `{reqId,layer,ms,ok}` (never any secret/PII); when unset it is a
pass-through with zero output. Wrap: `getUser()` in `middleware.ts:17-19`; the TMDB
`fetchCandidates` ladder, the `parseNote` AI call, the `watched` read, and the
`recommendations`/`recommendation_picks` writes in `recommend-run.ts`. A request id is
derived once per request (e.g. `crypto.randomUUID()` in middleware, passed via
`locals`). Default-off; declared `optional: true` in `astro.config.mjs` env schema.

#### 3. Repro npm script + test-user seed note

**File**: `package.json`, `scripts/repro-concurrent-isolation.mjs` (header doc)

**Intent**: One-command invocation and a documented setup (two users, dev server, env).

**Contract**: Add `"repro:isolation": "node scripts/repro-concurrent-isolation.mjs"`.
The script's header comments document prerequisites: `npm run db:start`, `astro dev`
running with `DEBUG_CONCURRENCY=1` and TMDB/OpenRouter keys for heavy mode, and the two
test-user credentials (created idempotently by the script).

### Success Criteria

#### Automated Verification

- Script runs end to end against local `astro dev`: `npm run repro:isolation` exits 0 in light mode
- Heavy mode runs with keys present and prints a per-layer report: `npm run repro:isolation -- --mode=heavy`
- Isolation assertions pass (user B never receives user A's data)
- `npm run lint` passes
- `astro check` passes (new env field + instrumentation typecheck clean)

#### Manual Verification

- The per-layer report makes the failing layer (or "no failure — concurrent users work") unambiguous
- With `DEBUG_CONCURRENCY` unset, `astro dev` produces no new log noise (instrumentation is truly gated)
- The root-cause finding is written into `research.md` (new "Confirmed root cause" follow-up section) and reflected in `change.md`

**Implementation Note**: After Phase 1 automated checks pass, pause for the human to run
the heavy-mode repro in a real local environment (keys + dev server) and confirm the
captured finding before proceeding.

---

## Phase 2: App-layer owner-scope hardening

### Overview

Add explicit `.eq("user_id", user.id)` to every unscoped owner-owned read, so no read
trusts RLS alone, then prove via the Phase 1 probe that nothing changed for legitimate
users.

### Changes Required

#### 1. Scope the session reads

**File**: `src/pages/sessions.astro`

**Intent**: Make the error-refill latest-session read and the taste-core seed read
explicitly owner-scoped (fail-safe; the report implicates the error-refill read).

**Contract**: Add `.eq("user_id", user.id)` to the `movie_night_sessions` query
(`sessions.astro:28-33`, before `order/limit/maybeSingle`) and to the `viewer_profiles`
seed query (`sessions.astro:45-48`). `user` is already in scope (`sessions.astro:17`).
No behavior change under the anon key.

#### 2. Scope the profile read

**File**: `src/pages/profiles.astro`

**Intent**: Owner-scope the taste-core read.

**Contract**: Add `.eq("user_id", user.id)` to the `viewer_profiles` query
(`profiles.astro:16-19`). `user` already in scope (`profiles.astro:11`).

#### 3. Scope the recommendations read by owner

**File**: `src/pages/sessions/[id]/recommendations.astro`

**Intent**: Constrain the run lookup by owner in addition to the `session_id` URL param,
so a guessed/another-user `session_id` cannot select a row even if RLS were weakened.

**Contract**: Add `.eq("user_id", user.id)` to the `recommendations` query
(`recommendations.astro:15-20`), keeping the existing `.eq("session_id", id)`. `user`
already in scope (`recommendations.astro:9`). The `recommendation_picks` follow-up read
is already constrained by the owner-scoped `runId`; leave as is.

### Success Criteria

#### Automated Verification

- `npm run repro:isolation` isolation assertions still pass (legitimate users still see their own data)
- `npm run lint` passes
- `astro check` passes
- `npm run db:verify` passes (no DB-layer regression)

#### Manual Verification

- Logged-in user still sees their own latest session on the error-refill path, their taste core on `/profiles` and `/sessions`, and their picks on the recommendations page (no accidental over-filtering)
- Diff is limited to added `.eq("user_id", …)` clauses — no behavioral/UX change

**Implementation Note**: Pause after automated checks for the human to click through
sessions (including a forced `?error=` refill), profiles, and a recommendations page as
a real user to confirm no over-filtering.

---

## Phase 3: Lock the isolation regression + document

### Overview

Make the isolation probe a durable regression, write the confirmed root-cause finding
and key-verification result back, and document the app-layer isolation probe in the
test-plan cookbook.

### Changes Required

#### 1. Durable isolation regression entry point

**File**: `package.json`, `scripts/repro-concurrent-isolation.mjs`

**Intent**: Ensure the cross-user isolation assertions are runnable as a focused check
(not only as part of the full heavy repro), so the Phase 2 hardening has a guard.

**Contract**: Support a `--mode=isolation` (or reuse `light`) path that runs only the
auth + cross-user read assertions (no external keys required) and exits non-zero on any
leak. Document it in the script header. (No CI YAML changes here — wiring gates into CI
is owned by the test-plan Phase 5 / Module-1 Lesson 5, per CLAUDE.md boundaries.)

#### 2. Write back the finding

**File**: `context/changes/concurrent-user-isolation/research.md`,
`context/changes/concurrent-user-isolation/change.md`

**Intent**: Record what the repro proved (the named failing layer, or "concurrent use
works"), and the user's deployed-key verification result, so the follow-up fix change
(if any) starts from fact.

**Contract**: Append a "Confirmed root cause (repro)" section to `research.md` resolving
its Open Questions; update `change.md` notes with the verdict and the key-check outcome.

#### 3. Cookbook entry for the app-layer isolation probe

**File**: `context/foundation/test-plan.md`

**Intent**: Fill the §6.3 "Adding an own-data / authorization test" placeholder with the
app-layer probe pattern (script location, how to run, what it asserts), and note the
formal Vitest two-user integration test remains test-plan Phase 3 (pending Vitest
bootstrap in Phase 1).

**Contract**: Edit §6.3 only (and, if accurate, mark §3 Phase 3 row notes to point at
this change's probe as partial app-layer coverage). Do not alter the frozen strategy
(§1–§5) beyond the cookbook/notes. Follow the test-plan's own update conventions.

### Success Criteria

#### Automated Verification

- `npm run repro:isolation -- --mode=isolation` runs without external keys and passes
- `npm run lint` passes
- Markdown artifacts are valid (no broken intra-doc references)

#### Manual Verification

- `research.md` Open Questions are resolved with the repro finding; `change.md` records the key-verification result
- test-plan §6.3 reads as actionable guidance for the next contributor adding an own-data test
- A reader can reproduce the diagnosis from the documented steps alone

**Implementation Note**: This phase is documentation + a small script affordance; no app
behavior changes. Confirm with the human that the written finding matches what they
observed in the Phase 1 heavy-mode run.

---

## Testing Strategy

### Unit Tests

- None added (no Vitest by design). The deterministic logic under test (RLS scoping) is
  already covered by pgTAP at the DB layer.

### Integration Tests

- The repro script is the integration surface: two concurrent authenticated flows
  end-to-end through real workerd, with cross-user isolation assertions.

### Manual Testing Steps

1. `npm run db:start`; ensure local migrations applied.
2. Start `DEBUG_CONCURRENCY=1 astro dev` with TMDB/OpenRouter keys in `.dev.vars`.
3. `npm run repro:isolation -- --mode=heavy`; read the per-layer report and PASS/FAIL.
4. Force the error-refill path as a single user (submit with a deliberately empty/invalid
   field) and confirm your own latest session re-fills after Phase 2.
5. As user B, manually request a known user-A `/sessions/<A-id>/recommendations` URL and
   confirm no A data is shown.

## Performance Considerations

The added owner filters narrow queries (equal/faster; owner columns are indexed per the
migrations). Instrumentation is gated and a pass-through when off, so zero production
cost. The repro intentionally generates load (heavy concurrent pipeline) — run it
against local/staging, not production.

## Migration Notes

No schema migration. One new optional `astro:env/server` field (`DEBUG_CONCURRENCY`),
default-off; no secret rotation. No data backfill.

## References

- Research: `context/changes/concurrent-user-isolation/research.md`
- Per-request client: `src/lib/supabase.ts:5-24`; auth: `src/middleware.ts:14-23`
- Unscoped reads to harden: `src/pages/sessions.astro:28-34,45-48`,
  `src/pages/profiles.astro:16-20`, `src/pages/sessions/[id]/recommendations.astro:15-21`
- Heavy pipeline: `src/lib/recommend-run.ts:107-145`; layer-distinct messages: `:61,134,150`
- Auth endpoint for repro login: `src/pages/api/auth/signin.ts`; local auth config:
  `supabase/config.toml:209`
- DB-layer isolation already proven: `supabase/tests/*_isolation.sql`
- Test-plan Risk #4 / Phase 3 + §6.3 cookbook: `context/foundation/test-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Deterministic repro harness + per-layer instrumentation

#### Automated

- [ ] 1.1 Script runs end to end against local `astro dev`: `npm run repro:isolation` exits 0 in light mode
- [ ] 1.2 Heavy mode runs with keys present and prints a per-layer report: `npm run repro:isolation -- --mode=heavy`
- [ ] 1.3 Isolation assertions pass (user B never receives user A's data)
- [ ] 1.4 `npm run lint` passes
- [ ] 1.5 `astro check` passes (new env field + instrumentation typecheck clean)

#### Manual

- [ ] 1.6 The per-layer report makes the failing layer (or "concurrent users work") unambiguous
- [ ] 1.7 With `DEBUG_CONCURRENCY` unset, `astro dev` produces no new log noise (gating verified)
- [ ] 1.8 Root-cause finding written into `research.md` and reflected in `change.md`

### Phase 2: App-layer owner-scope hardening

#### Automated

- [ ] 2.1 `npm run repro:isolation` isolation assertions still pass
- [ ] 2.2 `npm run lint` passes
- [ ] 2.3 `astro check` passes
- [ ] 2.4 `npm run db:verify` passes

#### Manual

- [ ] 2.5 Logged-in user still sees own latest session (forced `?error=` refill), taste core, and picks — no over-filtering
- [ ] 2.6 Diff limited to added `.eq("user_id", …)` clauses — no behavioral/UX change

### Phase 3: Lock the isolation regression + document

#### Automated

- [ ] 3.1 `npm run repro:isolation -- --mode=isolation` runs without external keys and passes
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 Markdown artifacts valid (no broken intra-doc references)

#### Manual

- [ ] 3.4 `research.md` Open Questions resolved with the repro finding; `change.md` records key-verification result
- [ ] 3.5 test-plan §6.3 reads as actionable guidance for the next own-data test
- [ ] 3.6 A reader can reproduce the diagnosis from the documented steps alone
