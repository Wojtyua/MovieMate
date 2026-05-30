# Persistence Baseline with Row-Level Access — Plan Brief

> Full plan: `context/changes/persistence-baseline-rls/plan.md`

## What & Why

Wire Supabase migration tooling into the repo and establish a reusable "own data only" RLS convention, so the first data-bearing slice can add its table and trust FR-001 (users access only their own data) at the data layer — instead of re-deriving per-user isolation per table. Roadmap F-02, Stream B foundation.

## Starting Point

`supabase init` is already done (`supabase/config.toml`), the Supabase CLI v2 is installed, and the auth client (`src/lib/supabase.ts`) already runs PostgREST queries **as the authenticated user** (anon key + cookie JWT) — so `auth.uid()` RLS will be enforced the instant tables exist. What's missing: a `supabase/migrations/` directory, a scripted migration loop, a verified RLS pattern, and the convention written down.

## Desired End State

A scripted local migration workflow (`npm run db:*`), one canonical owner-scoped **example** table whose RLS policies are proven to isolate data across two users on the local stack, and a reference doc that future slices copy. No product tables and no typed client layer are introduced.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Embody the convention | Ship one canonical example table (kept) | Proves the full migration + RLS loop now and gives slices a concrete copyable template | Plan |
| Typed DB layer | Defer to S-01 | Honors the "minimal enabler" scope; types would only reflect a throwaway table | Plan |
| Verification | Local stack + two-user SQL/REST check | Proves data isolation, not just that policies exist; repeatable | Plan |
| Remote project | Local-only; document push | Keeps a foundation step free of remote side effects; example table never hits production | Plan |
| Owner column | `user_id uuid → auth.users, on delete cascade, default auth.uid()` | Standard Supabase idiom; safe inserts + cascade cleanup | Plan |
| Command ergonomics | Add `db:*` npm scripts | Discoverable, matches existing `dev`/`deploy` script convention | Plan |

## Scope

**In scope:** migration directory + scripted workflow; one canonical RLS example table; two-user isolation verification; convention reference doc + README/AGENTS pointers.

**Out of scope:** product tables (S-01/S-02/S-05), generated DB types / typed client (S-01), remote push of the example table, any auth/middleware/secret changes.

## Architecture / Approach

Purely schema + tooling + docs — no application code changes, because the existing client already enforces RLS per-user. A single non-product migration carries the pattern (owner column + four per-command `auth.uid() = user_id` policies); a repeatable local-stack fixture proves isolation; a reference doc makes the pattern copyable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migration workflow + npm scripts | `migrations/` dir, canonical example migration, `db:*` scripts | RLS deny-by-default breaks access if policies omitted |
| 2. Verify own-data isolation | Repeatable two-user `db:verify` check | Test without teeth (passes even if RLS is off) |
| 3. Document the convention | `docs/reference/persistence-conventions.md` + README/AGENTS pointers | Doc drifts from the actual migration pattern |

**Prerequisites:** Docker running for the local Supabase stack; Supabase CLI (already in devDeps).
**Estimated effort:** ~1 session across 3 thin phases.

## Open Risks & Assumptions

- Assumes the local Supabase stack (Docker) is available in the implement/verify environment.
- The example table is a reference artifact; a later change may drop it once a real table demonstrates the pattern.
- Remote application stays human-gated (schema-destructive remote ops per `infrastructure.md`).

## Success Criteria (Summary)

- A new owner-scoped table can be created end-to-end by following the reference doc.
- Two users querying the example table each see only their own row; cross-user writes are rejected.
- `npm run db:reset` + `npm run db:verify` pass on the local stack; lint/build unaffected.
