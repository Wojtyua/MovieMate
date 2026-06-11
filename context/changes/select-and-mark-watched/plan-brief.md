# Select and Mark Watched (S-05) — Plan Brief

> Full plan: `context/changes/select-and-mark-watched/plan.md`
> Research: `context/changes/select-and-mark-watched/research.md`

## What & Why

Let a logged-in operator select one of tonight's three picks to close the decision, mark it watched, and have every watched film excluded from all future candidate retrieval for the account (PRD FR-011, FR-012; US-01). "Watched" is a **dedup filter only** — not a scoring signal, not a browsable list.

## Starting Point

The retrieval seam already exists and is wired but unfed: `fetchCandidates` accepts `excludeMovieIds?: Set<number>` and applies it in the same pass as id-dedup (`src/lib/tmdb-discover.ts:185`), yet `recommend-run.ts` never passes it. The picks page (`recommendations.astro`) is pure server-rendered Astro with no React island and no actions. There is no `watched` table and no `fetch`-from-React mutation anywhere in the repo yet.

## Desired End State

The operator clicks "Mark watched" on a pick; that card highlights, the other two dim, the button becomes a disabled "Watched ✓", and the TMDB id is persisted to a per-account `watched` table (idempotent). On the next run, that film never reappears in any retrieval attempt. Watched data is partitioned per owner by RLS.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Watched data model | Own `watched` table keyed by `(user_id, tmdb_movie_id)` | Excludes across all future runs regardless of which run surfaced the film; matches the seam and the PRD. | Research |
| Select vs mark gesture | One gesture | A single "Mark watched" both closes the decision and records the dedup; PRD treats watched as dedup-only. | Plan |
| Post-mark UX | Highlight chosen + dim others, button → disabled "Watched ✓" | Strongest "you chose this" signal while keeping dedup recorded; no surprising navigation. | Plan |
| Undo / unwatch | Out of scope | PRD never asks for it; idempotent upsert prevents dupes. | Plan |
| Pool-shrink under heavy watch history | Exclusion never relaxes | A watched film must never be re-recommended; the existing relaxation ladder is the only lever. | Plan |
| Endpoint contract | JSON `{ ok: true }`, 401/400/500 on failure; client shows inline error | Mirrors the JSON endpoint style; `user_id` from JWT not body; no optimistic fire-and-forget that could silently lose a write. | Plan |

## Scope

**In scope:** new `watched` table (migration + RLS + index + pgTAP test); `POST /api/watched` JSON endpoint; retrieval wiring in `recommend-run.ts`; interactive picks-page island with mark-watched + highlight/dim.

**Out of scope:** unwatch/undo; browsable watch list or count; `watched_at` column on picks; exclusion relaxation; Vitest harness (test-plan Phase 1 owns it); remote DB apply.

## Architecture / Approach

Bottom-up across four layers: **table** (copy `viewer_profiles` owner-scoped shape, swap to `unique (user_id, tmdb_movie_id)`) → **endpoint** (JSON style of `health/integrations.ts`, upsert like `profiles.ts`) → **retrieval wiring** (one watched-set query feeding the pre-built `excludeMovieIds` seam) → **UI island** (the repo's first `fetch`-from-React mutation, reusing shadcn `Button`). Phases 1-3 are server-only; Phase 4 depends on Phase 2.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Persistence | `watched` table + 4 RLS policies + pgTAP isolation test | RLS misconfig leaking rows across owners |
| 2. Endpoint | `POST /api/watched` idempotent JSON upsert | Trusting body-supplied `user_id`; non-idempotent dupes |
| 3. Retrieval wiring | Watched set fed into `excludeMovieIds` on every ladder attempt | Pool shrink below three picks (test-plan Risk #1) |
| 4. UI island | Interactive picks grid with mark-watched + highlight/dim | First fetch-mutation; silent write failure |

**Prerequisites:** S-02 (shipped); local Supabase running (`npm run db:start`).
**Estimated effort:** ~1-2 sessions across 4 phases; each phase is a pattern-copy.

## Open Risks & Assumptions

- Pool-shrink: a heavy-watcher on a narrow genre could theoretically drop below three picks; documented as a known edge handled by the existing `< 3` failure path — no extra mitigation at dev scale.
- This slice introduces the repo's first `fetch`-from-React mutation — a small new convention, kept minimal.
- No generated Supabase types; the new table is referenced via untyped `.from("watched")` with local casts (house pattern).

## Success Criteria (Summary)

- A marked film is excluded from every future recommendation run for that account.
- Watched data is partitioned per owner (pgTAP isolation test green).
- Marking is idempotent, one-gesture, with clear highlight/dim feedback and no silent write failures.
