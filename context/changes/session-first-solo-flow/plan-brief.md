# Session-First Solo Flow (S-02) — Plan Brief

> Full plan: `context/changes/session-first-solo-flow/plan.md`
> Frame brief: `context/changes/session-first-flow/frame.md` (upstream reshape frame)

## What & Why

Deliver the roadmap's north-star slice: start a movie-night session from home, stay solo, and get three role-labeled picks. Per the upstream frame, the actual problem is that the flow makes the user re-enter and upfront-configure the stable part of taste — the same genre dimensions captured and scored twice — while rigidly assuming exactly two viewers, so there is no solo path and no clean separation between "stable taste core" and "tonight's mood." This slice fixes the solo path, the double-scoring, and the entry flow in one end-to-end vertical.

## Starting Point

S-01 just landed: one remembered taste core per user, edited at `/profiles`, fed to the unchanged two-viewer engine via a throwaway `recommend([core, core], …)` shim. Home is still generic starter content ("Test test test"), the session form starts blank, the engine hard-requires a `[Profile, Profile]` pair, and the pick-role CHECK admits only `safe/compromise/wild_card`.

## Desired End State

A user lands on a real MovieMate home, clicks "Start a movie night," signs in straight into the session form — tonight's genres already pre-filled from their core (with a "tonight only" hint) — sets mood/runtime/intensity, and gets three picks labeled **Safe pick / Crowd-pleaser / Wild card**, persisted and returned in well under 10 s. No `/profiles` gate anywhere; no core saved still yields three picks.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Solo middle role | `crowd_pleaser` — argmax of quality + popularity (minus excluded-genre penalty) | PRD's own example seed; structurally distinct from safe (personal fit) and wild card (genre stretch) using signals already in scoring | Plan |
| Taste at scoring time | Tonight's session genres only; core is pre-fill-only | Eliminates the double-scoring root cause (frame D2) — one taste, entered once, scored once | Frame → Plan |
| No-core first run | Proceed with empty taste + soft nudge; hard `/profiles` gate deleted | FR-003's resolution: the home entry point replaces the precondition gate | Plan |
| Engine shape | Generalize to `[Taste] \| [Taste, Taste]` now; duo branch intact but unreachable | PRD mandates "extended, not replaced"; S-03 becomes pure input wiring | Plan |
| Entry flow | Home hero + CTA → `/sessions`; sign-in and email-confirm redirect to `/sessions` | "Home → login → start session" becomes literal with zero new pages | Plan |
| Pre-fill UX | Seed pickers + one hint line ("edits apply to tonight only") | PRD warns silent pre-fill hides editability; one prop + one string | Plan |
| Testing | Existing gates (lint/check/build/pgTAP) + manual; no vitest | Test infra is owned by the upcoming `/10x-test-plan` rollout — don't preempt it | Plan |

## Scope

**In scope:** engine generalization to 1–2 tastes + solo role set; `crowd_pleaser` CHECK migration + pgTAP update; recommendations read path rewrite (shim + core gate deleted); MovieMate home + auth redirects; session-form pre-fill + hint + no-core nudge.

**Out of scope:** second-viewer/duo UI (S-03), AI note parsing (S-04), select/mark-watched (S-05), "save tonight's genres as my core" (OQ-3), vitest/e2e infra, table/URL renames, dashboard redesign.

## Architecture / Approach

The remembered core's only runtime job becomes seeding the new-session form; the session row's genre fields become the single taste the engine scores (deleting the parallel `W_SPREF/W_SEXCL` weight block). `recommend()` takes a 1–2 taste tuple union and branches the middle role on cardinality: duo keeps `compromise` (min-affinity balance), solo introduces `crowd_pleaser` (quality+popularity). Safe and the genre-disjoint wild card are shared across both branches. `recommendations.ts` no longer reads `viewer_profiles` at all.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Engine generalization (pure lib) | 1–2-taste engine + solo roles + display maps; prod still on shim | Interim: session genres briefly unscored until Phase 2 (documented) |
| 2. Role migration + solo read path | `crowd_pleaser` in the CHECK; shim + core gate deleted; solo E2E works | Migration must precede the first crowd_pleaser insert (same phase, ordered) |
| 3. Entry flow + pre-fill UX | MovieMate home, auth → `/sessions`, pre-filled form + hint + nudge | Copy/UX polish; pre-fill must stay new-session-only |

**Prerequisites:** S-01 archived (done); local Supabase for `db:reset`/`db:verify`.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- The interim state between Phases 1–2 changes scoring semantics (session genres unscored); acceptable on dev-only data, demo after Phase 2.
- `W_CROWD = 3` is a suggested starting weight — tunable in the WEIGHTS block if the crowd-pleaser slot feels too mainstream/too safe.
- Assumes the inline CHECK's auto-generated name `recommendation_picks_role_check`; the implementer should confirm before the drop.

## Success Criteria (Summary)

- From home, a signed-in user reaches a pre-filled session form and gets three Safe / Crowd-pleaser / Wild card picks persisted in < 10 s — with or without a saved core.
- Tonight's genre edits never change the `/profiles` core; the core never double-scores.
- All gates green: `npm run lint`, `npx astro check`, `npm run build`, `npm run db:verify`.
