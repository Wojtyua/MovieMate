# Own-Data Isolation (IDOR) — Test-Plan Phase 3 Implementation Plan

## Overview

This change implements **Phase 3 of the test-plan ("Own-data isolation")**, defending
**Risk #4 — IDOR**: a logged-in user A reaching user B's sessions / recommendations /
taste core by swapping an identifier. The defense is a **two-user integration test** at
the application's real data seam: two freshly signed-up users, each with their own
authenticated `@supabase/supabase-js` client, run against the **local Supabase stack**.
User A writes one row into every owner-scoped entity; user B then reads A's identifiers
and must get **empty** results; user A reads its own rows as a positive ("teeth")
control. The sharpest case — the `/sessions/[id]/recommendations` URL-id-swap — is
covered by B querying `recommendations` with A's `session_id`.

The phase is **test-only** (no product-code changes) and **env-gated** so the keyless
default `npm run test:run` (and pre-push) stay infra-free; the isolation suite runs on
demand via a new `npm run test:isolation` with the local stack up.

## Current State Analysis

- **The risk is real but narrow.** Reading the API surface: every write endpoint
  (`src/pages/api/profiles.ts`, `watched.ts`, `recommendations.ts`) derives `user_id`
  from the JWT (`context.locals.user`) and **never** from request input — so there is no
  foreign-id-to-write swap vector. The one genuine URL-id-swap surface is
  `src/pages/sessions/[id]/recommendations.astro:13-29`: it reads `recommendations` by
  `session_id` (taken from the URL) and `recommendation_picks` by `recommendation_id`,
  with **no explicit owner filter** — protected solely by RLS. `sessions.astro` and
  `profiles.astro` read "my latest / my taste core" implicitly via RLS (no input id).
- **RLS is on and proven at the DB layer.** Per-table pgTAP fixtures
  (`supabase/tests/*_isolation.sql`) impersonate two users via `request.jwt.claims` and
  assert partitioned visibility plus cross-user tamper rejection. That proves the
  **policies**; it does not exercise the app's `createClient`-with-cookie-JWT wiring, nor
  the URL-swap read path.
- **The app's data seam.** `src/lib/supabase.ts` builds a per-request `@supabase/ssr`
  client with the **anon key + the user's cookie JWT**, so PostgREST runs every query as
  the authenticated user and `auth.uid()` policies apply. The integration test mirrors
  this with raw `@supabase/supabase-js` clients each carrying a real user session token.
- **The prior `concurrent-user-isolation` change (roadmap S-08) was closed
  _no-defect_ with its entire plan unimplemented** (Progress all `[ ]`; closed by commit
  `7b97ccf`). Its planned `repro:isolation` script and owner-scope read hardening never
  shipped — so neither exists in the tree today. This phase is the _planned_ Lesson-2
  integration coverage, not that bug investigation.
- **Test infra.** Vitest 3.2.6 is bootstrapped (`vitest.config.ts`), `node` environment,
  `@/*` alias via `vite-tsconfig-paths`, `tests/e2e/**` excluded (Playwright owns it).
  `@supabase/supabase-js` is already a dependency. The config comment already anticipates
  _"the Phase 3 integration test"_ scoping its own `astro:env` resolution.
- **Local stack facts** (`supabase/config.toml`): API at `http://127.0.0.1:54321`,
  `auth.enable_confirmations = false` (so `signUp` returns a live session with a real
  JWT), `site_url = http://127.0.0.1:4321`. The local anon key is obtainable from
  `supabase status` / standard local defaults.
- **Cookbook §6.3** in `context/foundation/test-plan.md` currently reads
  `TBD — see §3 Phase 3`; the §3 Phase 3 row Status is `not started`.

### Key Discoveries:

- URL-swap vector lives at `src/pages/sessions/[id]/recommendations.astro:18` — `.eq("session_id", id)` with `id` from `Astro.params`, owner-gated only by RLS.
- All write endpoints set `user_id` from `context.locals.user` — `src/pages/api/watched.ts:46`, `profiles.ts:44-50`, `recommendations.ts:96`.
- pgTAP two-user pattern to mirror at the app layer: `supabase/tests/recommendations_isolation.sql` (impersonation + positive control + survives-tamper).
- The seam to test: `src/lib/supabase.ts` (anon key + JWT → PostgREST as user).
- `enable_confirmations = false` (`supabase/config.toml:209`) makes per-run signup yield a live session — no email step.

## Desired End State

`npm run test:isolation`, with the local Supabase stack running, passes a Vitest
integration spec that signs up two fresh users and proves B cannot read A's data across
every owner-scoped entity (taste core, sessions, recommendations, picks, watched) plus
the URL-swap case, while A reads its own rows successfully (teeth control). A keyless
`npm run test:run` still passes with the spec **skipped** (not failed). The test-plan
§6.3 cookbook documents the pattern, §3 Phase 3 reads `complete` pointing at this change
folder, §5 records the on-demand isolation gate, and §6.6 carries a phase note.

Verify: `npm run test:run` green without Docker (spec skipped); `npm run db:start &&
npm run test:isolation` green; deliberately reusing A's token/ids for B's reads turns the
spec red.

## What We're NOT Doing

- **No product-code changes.** Reads stay RLS-only; we do **not** add defense-in-depth
  `.eq("user_id", …)` owner filters (RLS is proven correct; that hardening is a separate
  change if ever wanted).
- **No pgTAP additions** — DB-layer policy isolation is already covered per-table.
- **No HTTP/page-level SSR harness** — invoking `.astro` routes is Phase 4's e2e layer.
- **No CI wiring and no pre-push gate** for the Docker-dependent suite — CI authoring is
  a deferred lesson; the keyless default suite and pre-push stay infra-free.
- **No cross-user _write_/tamper assertions** — pgTAP already covers tamper, and the app
  write endpoints don't accept foreign ids, so synthetic write attacks add little signal.
- **No teardown / no fixed-UUID seeding** — fresh unique users per run; throwaway rows
  are harmless and wiped on `db:reset`.

## Implementation Approach

Add a self-contained, env-gated integration spec under a new `tests/integration/`
directory plus a tiny authed-client helper. Gating is by an explicit env flag
(`RUN_ISOLATION`) set only by the `test:isolation` script, combined with a fast
stack-reachability check that fails with a clear message if the flag is set but the stack
is down. Local Supabase URL/anon key come from env (`SUPABASE_URL` / `SUPABASE_KEY`) with
documented local defaults. The spec follows the pgTAP two-user shape but at the app
client seam: A writes, B reads-A-empty, A reads-own-nonempty. Then a markdown-only doc
write-back lands the cookbook entry and status flips.

## Critical Implementation Details

- **Gating must keep `test:run` green without Docker.** The spec is collected by default
  `vitest run` (it lives outside the excluded `tests/e2e/**`), so it must self-skip when
  the flag is unset. Use `describe.skipIf(!process.env.RUN_ISOLATION)`. The
  `test:isolation` script sets `RUN_ISOLATION=1`; when set, a `beforeAll` reachability
  probe to `${SUPABASE_URL}/auth/v1/health` fails fast with a clear "start the local
  stack (`npm run db:start`)" message rather than emitting opaque connection errors.
- **Positive control is the teeth.** Asserting only "B sees zero rows" is satisfied by a
  broken-auth false green. Each entity must assert **both** B-sees-0 **and** A-sees-its-own
  (count ≥ 1), so the test fails if writes silently no-op or auth is misconfigured.
- **Use raw `@supabase/supabase-js` `createClient`, not `@/lib/supabase`.** The app helper
  needs Astro `cookies`/`Headers`; the test instead signs in each user and lets the
  supabase-js client carry the session token, which reproduces the same "PostgREST as the
  authenticated user" behavior the seam relies on.

## Phase 1: Two-user IDOR integration test

### Overview

Stand up the gated integration spec and its helper: two freshly signed-up authenticated
clients against the local stack, the read-leak matrix across all owner-scoped entities
plus the URL-swap, and a positive teeth control — wired behind `npm run test:isolation`
without breaking the keyless default suite.

### Changes Required:

#### 1. Authenticated-client test helper

**File**: `tests/integration/supabase-clients.ts`

**Intent**: Provide a helper that signs up a fresh unique user against the local stack and
returns an authenticated `@supabase/supabase-js` client carrying that user's session, so
the spec can obtain two independent authed identities (A and B) with no shared state.

**Contract**: Exports `signUpClient(): Promise<{ client: SupabaseClient; userId: string;
email: string }>` (email `iso-${Date.now()}-${rand}@example.com`). Reads
`SUPABASE_URL` / `SUPABASE_KEY` from `process.env` with local defaults
(`http://127.0.0.1:54321` + local anon key). Relies on `enable_confirmations = false` so
`signUp` returns a live session; throws a descriptive error if no session comes back.

#### 2. The isolation spec

**File**: `tests/integration/own-data-isolation.test.ts`

**Intent**: Prove user B cannot read user A's data at the app client seam across every
owner-scoped entity and the URL-swap vector, with a positive control proving the writes
landed and auth works.

**Contract**: A `describe.skipIf(!process.env.RUN_ISOLATION)` block. `beforeAll` probes
`${SUPABASE_URL}/auth/v1/health` and fails fast if unreachable, then signs up A and B and
has A write one row per entity: `viewer_profiles` (upsert taste core), `movie_night_sessions`
(insert, capture `sessionId`), `recommendations` (insert with `session_id`, capture
`recId`), `recommendation_picks` (insert under `recId`), `watched` (insert). Tests assert,
per entity: **B reads → 0 rows** (for recommendations/picks, B filters by A's `sessionId`
/ `recId` — the URL-swap case) **and** **A reads own → ≥ 1 row**. `user_id` on A's inserts
comes from the `auth.uid()` column default (no explicit id passed), exercising the real
ownership-on-insert path.

#### 3. The gated npm script

**File**: `package.json`

**Intent**: Add a one-command entry that runs only the isolation spec with the gate flag
set, leaving `test` / `test:run` untouched.

**Contract**: New script `"test:isolation": "RUN_ISOLATION=1 vitest run tests/integration/own-data-isolation.test.ts"`. No change to `test`, `test:run`, or `vitest.config.ts` exclude (the spec self-skips when the flag is unset).

### Success Criteria:

#### Automated Verification:

- Keyless default suite stays green (spec skipped): `npm run test:run`
- Isolation suite passes with the local stack up: `npm run db:start && npm run test:isolation`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- With the stack up, `npm run test:isolation` output shows the spec **executed** (not skipped) and every entity assertion ran.
- Teeth check: point B's reads at A's session via A's own client/token (or assert B-sees-A's-row) and confirm the spec goes **red**; revert.
- With the flag set but the stack **down**, the run fails with the clear "start the local stack" message, not an opaque connection error.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing (teeth check + skip behavior) was successful before proceeding to Phase 2.

---

## Phase 2: Documentation write-back

### Overview

Record the new pattern and flip the phase status so the test-plan reflects reality:
cookbook §6.3, the §3 rollout row, the §5 gate table, and a §6.6 phase note.

### Changes Required:

#### 1. Cookbook §6.3 — Adding an own-data / authorization test

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 3` placeholder with an actionable worked
example + recipe so the next own-data test follows this pattern.

**Contract**: §6.3 names the worked example (`tests/integration/own-data-isolation.test.ts`

- `tests/integration/supabase-clients.ts`) and captures the recipe: two fresh authed
  supabase-js clients vs the local stack; the read-leak-plus-positive-control oracle;
  `RUN_ISOLATION` env gating so the keyless suite stays infra-free; the URL-swap vector as
  the sharpest case; the relationship to the DB-layer pgTAP coverage (app-wiring vs policy).

#### 2. §3 rollout row + §5 gate + §6.6 note

**File**: `context/foundation/test-plan.md`

**Intent**: Move Phase 3 to `complete`, point it at this change folder, record the gate,
and add a phase note.

**Contract**: §3 Phase 3 row Status → `complete`, Change folder → `context/archive/<this-change>/`
(or `context/changes/own-data-isolation/` until archived). §5 adds a row for the on-demand
isolation gate (local, not blocking, Docker-dependent). §6.6 appends a 2–3 line "Phase 3"
note capturing the no-id-swap-at-write finding and the app-seam-vs-pgTAP distinction.
"Last updated" date bumped.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- No broken intra-doc references introduced (the change folder path resolves).

#### Manual Verification:

- §6.3 reads as actionable guidance a contributor could follow without re-deriving it.
- §3 Phase 3 Status and Change-folder columns are accurate; §5 gate row matches the actual `test:isolation` behavior.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before considering the change done.

---

## Testing Strategy

### Integration Tests:

- Two-user read-leak matrix across `viewer_profiles`, `movie_night_sessions`,
  `recommendations`, `recommendation_picks`, `watched` — B-sees-0 + A-sees-own per entity.
- URL-id-swap: B queries `recommendations` by A's `session_id` and `recommendation_picks`
  by A's `recommendation_id` → empty.

### Manual Testing Steps:

1. `npm run test:run` with no Docker → green, isolation spec reported skipped.
2. `npm run db:start && npm run test:isolation` → green, spec executed.
3. Break isolation (B reads via A's token / assert B sees A's row) → spec red → revert.
4. Stop the stack, run `npm run test:isolation` → clear "start the local stack" failure.

## Performance Considerations

Negligible — a handful of inserts/selects against the local stack per run. The suite is
gated out of the hot keyless path, so it adds no latency to `test:run` or pre-push.

## Migration Notes

None — no schema or product-code changes. Throwaway auth/users rows from per-run signups
are harmless and cleared by `npm run db:reset`.

## References

- Test plan (risk, layer, anti-patterns, cookbook target): `context/foundation/test-plan.md` (§2 Risk #4, §3 Phase 3, §6.3)
- Persistence convention (RLS-via-authed-client seam): `docs/reference/persistence-conventions.md`
- URL-swap read surface: `src/pages/sessions/[id]/recommendations.astro:13-29`
- App data seam: `src/lib/supabase.ts`
- pgTAP two-user pattern mirrored at the app layer: `supabase/tests/recommendations_isolation.sql`
- Prior bug investigation (closed no-defect, unimplemented): `context/archive/2026-06-12-concurrent-user-isolation/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Two-user IDOR integration test

#### Automated

- [x] 1.1 Keyless default suite stays green (spec skipped): `npm run test:run` — 4540746
- [x] 1.2 Isolation suite passes with the local stack up: `npm run db:start && npm run test:isolation` — 4540746
- [x] 1.3 Linting passes: `npm run lint` — 4540746
- [x] 1.4 Type checking passes: `npm run typecheck` — 4540746

#### Manual

- [x] 1.5 With the stack up, `npm run test:isolation` shows the spec executed (not skipped) and every entity assertion ran — 4540746
- [x] 1.6 Teeth check: forcing B to read A's row turns the spec red; revert — 4540746
- [x] 1.7 Flag set but stack down → clear "start the local stack" failure, not an opaque connection error — 4540746

### Phase 2: Documentation write-back

#### Automated

- [x] 2.1 Linting passes: `npm run lint`
- [x] 2.2 No broken intra-doc references (change folder path resolves)

#### Manual

- [x] 2.3 §6.3 reads as actionable guidance without re-deriving it
- [x] 2.4 §3 Phase 3 Status/Change-folder accurate; §5 gate row matches `test:isolation` behavior
