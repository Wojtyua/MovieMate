# Create and Edit Two Viewer Profiles (S-01) — Plan Brief

> Full plan: `context/changes/viewer-profiles/plan.md`

## What & Why

Add MovieMate's first product table and the screen to manage it: a logged-in user creates and edits **exactly two** viewer profiles, each capturing one person's movie taste, while seeing only their own data. This satisfies FR-001 (own-data isolation) and FR-002 (two profiles), and — critically — defines the taste-field contract that the S-03 recommendation engine will score against.

## Starting Point

The persistence baseline (F-02) shipped an owner-scoped RLS convention, a reference table (`rls_example`), and a pgTAP test harness, but no product tables exist yet. Auth is live: pages hydrate React islands, forms POST to `APIRoute` handlers that redirect with `?error=`, and `src/middleware.ts` guards routes by prefix. `viewer_profiles` is the first real table built on this foundation.

## Desired End State

A logged-in user opens `/profiles`, sees two editors (slot 1 / slot 2) pre-filled with any saved data, and can set each profile's name, preferred genres, excluded genres, and a free-text note. Saving persists scoped to their account; a third profile is structurally impossible; a second account sees only its own profiles.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Profile fields | Name + preferred genres + excluded genres + note | Directly feeds FR-007 dual-profile scoring without over-building | Plan |
| Genre storage | TMDB genre IDs (`int[]`) | TMDB discover filters by ID, so no translation needed in S-03 | Plan |
| Two-profile cap | Two fixed slots, `unique(user_id, slot)` + `check (slot in (1,2))` | Makes "exactly two" structural and race-free | Plan |
| Genre source | Static const (`src/lib/genres.ts`) | TMDB's ~19 genres are stable; avoids a runtime subrequest | Plan |
| Placement | Dedicated `/profiles` route | Clean separation; room for two side-by-side editors | Plan |
| Submit pattern | Form POST → `APIRoute` → redirect | Reuses the exact established auth pattern; works without JS | Plan |
| Validation | Name required; genres/note optional; slots independent | Low friction; lets each taste be saved separately | Plan |
| Delete | Edit-only (upsert, no delete) | Matches FR-002 wording exactly; no empty-state edge cases | Plan |
| Test scope | pgTAP: RLS isolation + slot-cap | Proves FR-001 + FR-002 at the data layer via the only harness that exists | Plan |

## Scope

**In scope:** `viewer_profiles` migration + RLS + pgTAP test; static genre reference; `/api/profiles` upsert endpoint; protected `/profiles` page with two editors; dashboard link.

**Out of scope:** Delete/clear a slot; runtime TMDB genre fetch; app-level test framework; sessions, scoring, recommendations (S-02/S-03); pushing the migration to the hosted DB (human-gated).

## Architecture / Approach

Data → API → UI, following the repo's new-table checklist. One owner-scoped table keyed by `(user_id, slot)`; the per-request cookie-JWT Supabase client gives RLS for free. A single `POST /api/profiles` upserts one slot (`on conflict (user_id, slot)`) and redirects. The page loads both slots server-side and renders two React-island editors built from the existing `auth/` form primitives, with genres sourced from a static const.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `viewer_profiles` table + RLS + pgTAP (isolation + slot cap) | pgTAP fixture must impersonate users or it proves nothing |
| 2. API + genre ref | Static genres, `/api/profiles` upsert, route protection | Upsert must target `(user_id, slot)` and satisfy insert+update policies |
| 3. UI | `/profiles` page, two slot editors, dashboard link | Two independent slots without cross-contaminating state |

**Prerequisites:** F-02 (persistence baseline) — done; auth — present. Docker running for `db:*`.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- The taste-field shape is an assumption about what S-03 scoring needs; genres-as-IDs + note is deliberately minimal and may need a follow-up field once scoring weights are tuned (acceptable — additive migration).
- Genre multi-select UX is built from scratch (no existing component); keep it simple (checkbox/list), not a heavy combobox.

## Success Criteria (Summary)

- A user creates and edits two profiles, and the data persists across reloads.
- A second account cannot see the first account's profiles (`db:verify` proves isolation).
- A third profile / duplicate slot is rejected at the data layer (`db:verify` proves the cap).
