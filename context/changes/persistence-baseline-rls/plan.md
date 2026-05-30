# Persistence Baseline with Row-Level Access — Implementation Plan

## Overview

Wire Supabase migration tooling into the repo and establish a reusable "own data only" row-level-security (RLS) convention, so the first data-bearing slice (S-01 viewer-profiles) can add its table and trust FR-001 ("user can access only their own data") at the data layer.

The convention is made concrete — and verifiable — by shipping **one tiny canonical example table** that demonstrates the full loop: a migration creating an owner-scoped table with RLS enabled and `auth.uid()`-based policies. This is the copyable template every future slice mirrors. No product tables, no typed client layer are introduced here.

## Current State Analysis

- `supabase init` has already run: `supabase/config.toml` exists (`project_id = "10x-astro-starter"`, Postgres major 17) and `supabase/.gitignore` is present. There is **no `supabase/migrations/` directory yet**.
- The `supabase` CLI v2 (`^2.23.4`) is in `devDependencies`; `wrangler` v4 is present for deploy.
- `src/lib/supabase.ts` builds a per-request `createServerClient` using the **anon key** (`SUPABASE_KEY`, confirmed in `README.md:103,123`) plus the user's cookie JWT (`parseCookieHeader`). Because PostgREST requests carry the user's JWT, queries already run **as the authenticated user** — so `auth.uid()`-based RLS policies will be enforced the moment tables exist. No client change is needed for RLS to work.
- Secrets convention is locked and must not change: `SUPABASE_URL`/`SUPABASE_KEY` declared `context: "server", access: "secret"` in `astro.config.mjs:17-22`, read via `astro:env/server`, set as Worker + GitHub secrets, `.dev.vars` locally (AGENTS.md hard rule; `infrastructure.md:82`).
- Runtime is Cloudflare **workerd**: data access must stay over HTTP/PostgREST (no raw `pg` TCP) — the existing client already complies.
- `App.Locals` (`src/env.d.ts`) holds only `user`. No app tables, no generated DB types, no typed client wrapper exist.
- No `docs/` directory exists yet.

## Desired End State

After this plan:

- `supabase/migrations/` exists and contains a single timestamped migration creating a clearly-named reference table that is **not** a product entity, with RLS enabled and per-command policies scoped by `auth.uid() = user_id`.
- `npm run db:*` scripts wrap the Supabase CLI so migration/reset/verify steps are one command each, consistent with the existing `dev`/`deploy` script style.
- Running the local stack, applying migrations, and querying the example table as **two different authenticated users** demonstrably returns only each user's own row — proving "own data only" works, not just that policies exist.
- A reference doc captures the migration workflow and the RLS convention (owner column, default, cascade, policy style) as the copyable pattern for S-01/S-02/S-05, with README + AGENTS.md pointers.

**Verification of end state:** `npm run db:reset` applies the migration cleanly on the local stack; the two-user isolation check passes; `npm run lint` and `npm run build` are unaffected.

### Key Discoveries:

- Anon-key + cookie-JWT client (`src/lib/supabase.ts:9`) means RLS is enforced per-user with **zero client changes** — the foundation is purely schema + tooling + docs.
- `supabase init` already done (`supabase/config.toml`) — this change adds the missing `migrations/` dir and the workflow around it, not a re-init.
- workerd forbids raw Postgres TCP — the HTTP/PostgREST path is the only supported access and is already in place.
- Owner convention `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()` is the standard Supabase idiom; `default auth.uid()` makes inserts safe and `on delete cascade` cleans up on user deletion.

## What We're NOT Doing

- **No product tables** — viewer profiles (S-01), movie-night sessions/preferences (S-02), and watched-dedup (S-05) each ship with their consuming slice. The only table created here is a clearly-labeled reference/example.
- **No generated DB types or typed client wrapper** — deferred to S-01, which introduces `supabase gen types` against the first real table.
- **No remote push** — migrations are created and verified against the **local** stack only; the `supabase link` + `supabase db push` steps are documented for later/human-gated execution, not run here. The example table is never pushed to the hosted project.
- **No auth, middleware, or session changes** — auth is present in the baseline and is untouched.
- **No changes to secret handling** — `astro:env` server-only declarations stay exactly as-is.

## Implementation Approach

Three thin phases: (1) make the migration loop real and scripted, with the canonical example migration as the pattern carrier; (2) prove isolation with a repeatable two-user check on the local stack; (3) write the convention down so slices copy it instead of reinventing FR-001 enforcement per table. The example table is intentionally non-product so no slice inherits a schema decision it should own.

## Critical Implementation Details

- **`default auth.uid()` + `WITH CHECK`**: the insert policy and the column default must agree — `default auth.uid()` lets clients insert without supplying `user_id`, and the insert policy's `WITH CHECK (auth.uid() = user_id)` prevents a client from inserting rows owned by someone else. Both are required; the default alone is not a security control.
- **RLS is deny-by-default once enabled**: `alter table ... enable row level security` with no policy blocks all access (including the table owner via PostgREST). Policies must be created in the same migration or access breaks.
- **Local stack needs Docker**: `supabase start` / `db reset` require Docker running; the verification phase depends on it.

## Phase 1: Migration workflow + npm scripts

### Overview

Create the missing migration directory via the first (canonical example) migration, and expose the Supabase CLI through `db:*` npm scripts.

### Changes Required:

#### 1. Canonical example migration

**File**: `supabase/migrations/<timestamp>_rls_convention_example.sql` (new)

**Intent**: Create one small, clearly non-product table that demonstrates the owner-scoped RLS pattern every future table copies. This is the load-bearing artifact of the change — the executable template.

**Contract**: Table named to read as a reference (e.g. `rls_example`), with:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()`
- a trivial payload column (e.g. `note text`) and `created_at timestamptz not null default now()`
- `alter table ... enable row level security`
- four per-command policies (`select`, `insert`, `update`, `delete`) scoped by `auth.uid() = user_id` (insert uses `with check`, select/update/delete use `using`; update also `with check`).

```sql
alter table public.rls_example enable row level security;

create policy "rls_example_select_own" on public.rls_example
  for select using (auth.uid() = user_id);
create policy "rls_example_insert_own" on public.rls_example
  for insert with check (auth.uid() = user_id);
-- update: both using + with check; delete: using. (full set in the migration)
```

#### 2. DB npm scripts

**File**: `package.json`

**Intent**: Make the migration/verify loop one-command and discoverable, matching the existing scripted-command convention.

**Contract**: Add scripts wrapping the local-first Supabase CLI:
- `db:start` → `supabase start`
- `db:stop` → `supabase stop`
- `db:new` → `supabase migration new` (scaffold a new migration)
- `db:reset` → `supabase db reset` (re-apply all migrations to local stack)
- `db:verify` → runs the isolation check from Phase 2 (wired in Phase 2)

Do not add a remote `db push` script (out of scope; documented only).

#### 3. Satisfy the seed config

**File**: `supabase/seed.sql` (new) — or edit `supabase/config.toml`.

**Intent**: `config.toml` has `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]`, but `supabase/seed.sql` does not exist, so `db reset` may warn or error on the missing path and undercut SC 1.2 ("applies cleanly").

**Contract**: Add an empty (or comment-only) `supabase/seed.sql`, or set `[db.seed] enabled = false`. Prefer the empty file so the seed slot stays available for future slices.

### Success Criteria:

#### Automated Verification:

- `supabase/migrations/` exists with the example migration present
- Migration applies cleanly on the local stack: `npm run db:reset`
- Linting passes: `npm run lint`
- Build is unaffected: `npm run build`

#### Manual Verification:

- The example table is clearly named/commented as a reference pattern, not a product entity
- `db:*` scripts run as expected from a clean checkout (with Docker up)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Verify own-data isolation

### Overview

Prove RLS actually isolates data (not just that policies exist) by querying the example table as two different authenticated users on the local stack, and capture the check as a repeatable script.

### Changes Required:

#### 1. Two-user isolation check

**File**: `supabase/tests/rls_example_isolation.sql` (new) — a **pgTAP** test run via `supabase test db`.

**Intent**: A repeatable check that creates two users, inserts one row each, and asserts each user reads exactly their own row (and cannot update/delete the other's). Wired to `npm run db:verify`.

**Contract**: A pgTAP fixture executed against the local stack via `supabase test db` that impersonates two users and asserts row visibility is partitioned by `user_id`. Fails loudly (raised exception / failed plan) if either user can see the other's row.

**Mechanism (mandatory, not optional)**: The default `postgres`/superuser role and the table owner **bypass RLS**, so a fixture run as the default role proves nothing. Each assertion block must impersonate the user before querying:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<user-A-uuid>","role":"authenticated"}';
-- ...assert user A sees only their own row, then reset and repeat for user B
reset role;
```

Use `set local` inside a transaction so context resets cleanly between users.

**auth.users FK dependency**: `user_id` references `auth.users(id)`, so the two `sub` UUIDs must correspond to real `auth.users` rows or the inserts fail the FK. The fixture must first create two users — either `insert into auth.users` with the minimal required columns (verify the column set against the pinned local image; the GoTrue schema is version-sensitive) or via the local Auth admin API. Wrap setup + assertions in a transaction (or have the fixture clean up its own users at the end) so `db:verify` is **idempotent** and can re-run without a `db:reset` between runs.

#### 2. Wire `db:verify`

**File**: `package.json`

**Intent**: Expose the isolation check as one command.

**Contract**: `db:verify` → `supabase test db` (runs the pgTAP fixture against the running local stack; assumes `db:start`/`db:reset` already applied).

### Success Criteria:

#### Automated Verification:

- `npm run db:verify` passes: each user sees only their own row
- The check fails as expected when a policy is removed (sanity-confirm the test has teeth — verify once, then restore)

#### Manual Verification:

- Cross-user `update`/`delete` attempts are rejected by RLS, confirmed manually via SQL editor or REST with two JWTs

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Document the convention

### Overview

Write the migration workflow and RLS convention down as the canonical, copyable pattern so future slices follow it instead of re-deriving FR-001 enforcement.

### Changes Required:

#### 1. Convention reference doc

**File**: `docs/reference/persistence-conventions.md` (new)

**Intent**: Single source for "how we do tables here" — the owner column convention, policy style, the local-first migration workflow, and the human-gated remote push procedure.

**Contract**: Sections for (a) owner column rule (`user_id uuid → auth.users, on delete cascade, default auth.uid()`), (b) RLS policy template (the four per-command policies), (c) workflow commands (`db:new`/`db:reset`/`db:verify`), (d) deferred remote steps (`supabase link`, `supabase db push`) flagged as human-gated, (e) a copy-paste new-table checklist.

#### 2. README DB section

**File**: `README.md`

**Intent**: Point contributors at the migration workflow and the convention doc from the place they already read for setup.

**Contract**: Add/extend a short "Database & migrations" section linking to `docs/reference/persistence-conventions.md` and listing the `db:*` scripts. Do not duplicate the full convention.

#### 3. AGENTS.md pointer

**File**: `AGENTS.md`

**Intent**: Make the convention discoverable to coding agents at the data layer without bloating the rules file.

**Contract**: One concise line under an appropriate section pointing to `docs/reference/persistence-conventions.md` as the source of truth for tables + RLS. No rule duplication.

### Success Criteria:

#### Automated Verification:

- Prettier passes on changed `*.md`: `npm run lint` (lint-staged formats `*.md`) / build unaffected
- Internal doc links resolve (paths exist)

#### Manual Verification:

- A reader can create a new owner-scoped table end-to-end using only the reference doc
- README and AGENTS.md pointers are accurate and non-duplicative

**Implementation Note**: Final phase — confirm the convention reads clearly before closing the change.

---

## Testing Strategy

### Unit Tests:

- No application unit tests (no app code changes). Verification is at the DB layer.

### Integration Tests:

- The Phase 2 isolation fixture (`npm run db:verify`) is the integration test: two users, partitioned visibility, rejected cross-user writes.

### Manual Testing Steps:

1. `npm run db:start && npm run db:reset` — stack up, migration applied.
2. `npm run db:verify` — isolation check passes.
3. Temporarily drop one policy, re-run `db:verify`, confirm it fails; restore.
4. Follow `docs/reference/persistence-conventions.md` to hand-create a second owner-scoped table and confirm the checklist is sufficient.

## Performance Considerations

None — single tiny reference table; no app-path queries. RLS policies on `auth.uid() = user_id` are index-friendly (future tables should index `user_id`, noted in the convention doc).

## Migration Notes

- Local-first only. Remote application (`supabase link` + `supabase db push`) is documented and human-gated per `infrastructure.md:84` (schema-destructive remote ops are human-only). The example table must not be pushed to the hosted project.
- The example table is a reference artifact; a later change may drop it once a real table demonstrates the pattern, but that is out of scope here.

## References

- Change identity: `context/changes/persistence-baseline-rls/change.md`
- Roadmap F-02: `context/foundation/roadmap.md:75-86`
- FR-001: `context/foundation/prd.md:64-65`
- Existing RLS-ready client: `src/lib/supabase.ts:5-24`
- Secret/runtime constraints: `context/foundation/infrastructure.md:82-99`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration workflow + npm scripts

#### Automated

- [ ] 1.1 `supabase/migrations/` exists with the example migration present
- [ ] 1.2 Migration applies cleanly on the local stack: `npm run db:reset`
- [ ] 1.3 Linting passes: `npm run lint`
- [ ] 1.4 Build is unaffected: `npm run build`

#### Manual

- [ ] 1.5 Example table clearly named/commented as a reference pattern, not a product entity
- [ ] 1.6 `db:*` scripts run as expected from a clean checkout (Docker up)

### Phase 2: Verify own-data isolation

#### Automated

- [ ] 2.1 `npm run db:verify` passes: each user sees only their own row
- [ ] 2.2 Check fails as expected when a policy is removed (has-teeth sanity), then restored

#### Manual

- [ ] 2.3 Cross-user update/delete rejected by RLS, confirmed via SQL editor or REST with two JWTs

### Phase 3: Document the convention

#### Automated

- [ ] 3.1 Prettier/lint passes on changed `*.md`; build unaffected
- [ ] 3.2 Internal doc links resolve (paths exist)

#### Manual

- [ ] 3.3 A reader can create a new owner-scoped table end-to-end using only the reference doc
- [ ] 3.4 README and AGENTS.md pointers are accurate and non-duplicative
