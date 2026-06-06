# Remembered Taste Core (S-01) — Plan Brief

> Full plan: `context/changes/remembered-taste-core/plan.md`
> Upstream frame: `context/changes/session-first-flow/frame.md`

## What & Why

Collapse MovieMate's mandatory two-slot `viewer_profiles` model into **one remembered taste core per user** (stable preferred + excluded genres). This ends the double-entry of stable taste and is the load-bearing model change every later reshape slice (S-02–S-05) assumes (PRD FR-001, FR-002; roadmap S-01, the first slice).

## Starting Point

Today `viewer_profiles` structurally enforces exactly two profiles (`slot in (1,2)` + `unique(user_id, slot)`), with `display_name`, `note`, and genre arrays. `/profiles` renders two cards; `/api/recommendations` hard-requires two profiles and feeds them to a fixed-pair scoring engine (`recommend([Profile, Profile])`). S-03 (scored recommendations) is already shipped on this two-viewer assumption.

## Desired End State

`viewer_profiles` holds at most one row per user (genres only). The operator visits `/profiles`, sets preferred + avoid genres on a single "remembered taste core" card, and it persists. The shipped recommendations flow still returns three role-labeled picks — kept alive by a small throwaway adapter — with the scoring engine untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Recommendations gap (engine deferred to S-02) | Feed core as degenerate duo `recommend([core, core], …)` | Keeps the shipped flow green with ~5 lines and zero engine change; duplicating one taste scales all candidates uniformly so ranking is unaffected | Plan |
| Schema shape | Alter `viewer_profiles` in place (drop slot/CHECK/unique, add `unique(user_id)`) | Smallest diff; RLS policies + owner index untouched | Plan |
| Edit surface (PRD OQ-3) | Repurpose `/profiles` into a single-core editor | Reuses page, form, middleware, dashboard link; S-01 stays independently usable | Plan |
| Existing dev data | Wipe and re-enter | Zero migration logic; dev-only data, asymmetric single-operator model | Plan |
| Columns | Genres only — drop `display_name` + `note` | Matches FR-002; name is vestigial for one operator, note lives on the session | Plan |

## Scope

**In scope:** the schema migration; single-core editor (`/api/profiles.ts`, `profiles.astro`, `ProfileForm`); a throwaway recommendations adapter to keep the flow green.

**Out of scope (deferred to S-02):** generalizing the scoring engine to one-or-two viewers; the session-first home + genre pre-fill flow; the solo role set / widening the role CHECK; the "save tonight's genres as my core" affordance; renaming the `viewer_profiles` table or `/profiles` URL.

## Architecture / Approach

Three phases in dependency order: (1) a forward migration reshapes `viewer_profiles` to one core per user; (2) the read/write surface is rewritten for a single core; (3) `/api/recommendations` loads the single core and feeds the unchanged engine a degenerate duo. The Phase-3 shim is explicitly throwaway — S-02 deletes it when it properly generalizes the engine.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema migration + pgTAP rewrite | One-core-per-user `viewer_profiles` (`unique(user_id)`); rewritten isolation test | Must also rewrite `viewer_profiles_isolation.sql` or `db:verify` goes red; wipe rows before adding `unique(user_id)` |
| 2. Single-core editor | `/profiles` edits one taste core; persists | Subtractive refactor of form/page/API — stray `slot`/`display_name` refs |
| 3. Recs stopgap | Flow still returns 3 picks from the core | Forgetting it's throwaway; the `< 2`-profile gate must become a `core == null` gate |

**Prerequisites:** none (S-01 is the first slice). Local/dev Supabase to apply the migration.
**Estimated effort:** ~1 session across 3 phases (small, single-model change on dev data).

## Open Risks & Assumptions

- Assumes existing two-slot rows can be wiped (confirmed — dev-only data, no backfill).
- The degenerate-duo shim assumes ranking invariance under duplicated taste (true: uniform scaling across candidates).
- Forward-only migration; no down-migration resurrects two slots.

## Success Criteria (Summary)

- Operator maintains exactly one taste core via `/profiles`; selection persists across reloads.
- Own-data isolation and the four RLS policies remain intact after the migration.
- The recommendations flow still returns three role-labeled picks from the single core, within budget.
