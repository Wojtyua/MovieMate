---
project: MovieMate
version: 1
status: draft
created: 2026-06-06
updated: 2026-06-08
prd_version: 1
main_goal: low-complexity
top_blocker: none
---

# Roadmap: MovieMate — Session-First Flow Reshape

> Derived from `context/foundation/prd.md` (v1, brownfield) + auto-researched codebase baseline.
> Supersedes the pre-reshape roadmap archived at `context/foundation/archive/2026-06-06-roadmap.md`.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

MovieMate fights movie-night decision paralysis by returning three scored, role-labeled film picks for a specific evening instead of another long catalog. This reshape corrects the shipped flow along three lines: it collapses the mandatory two-profile model into **one remembered taste core** (ending the double-entry of stable taste), adds an **optional inline second viewer plus a real solo path**, and **redirects AI from cosmetic per-pick justifications to parsing the free-text note** into search parameters that sharpen the candidate set. The core hypothesis being corrected — the one claim that, if false, sinks the reshape — is that removing upfront double-entry and supporting solo makes the nightly flow lighter without losing pick quality.

## North star

**S-02: user can start a session from home, stay solo, and get three role-labeled picks** — this is the validation milestone, tied to the primary Success Criterion (complete the reshaped flow end to end). It proves the heart of the reshape: tonight's genres pre-fill from the remembered core (no double-entry) and the solo path works, using deterministic genre retrieval. Placed as early as its one prerequisite (S-01) allows.

> "North star" here means the smallest end-to-end slice whose successful delivery proves the core product hypothesis — placed as early as Prerequisites allow because everything else only matters if this works.

## At a glance

| ID   | Change ID                     | Outcome (user can …)                                             | Prerequisites | PRD refs                          | Status   |
| ---- | ----------------------------- | ---------------------------------------------------------------- | ------------- | --------------------------------- | -------- |
| S-01 | remembered-taste-core         | maintain one remembered taste core (replaces two profiles)       | —             | FR-001, FR-002                    | done     |
| S-02 | session-first-solo-flow       | start a session from home, solo, and get three role-labeled picks | S-01          | US-01, FR-003, FR-004, FR-008, FR-009 | done     |
| S-03 | optional-inline-second-viewer | add a second viewer's taste inline and get duo picks             | S-02          | US-01, FR-005, FR-008, FR-009     | done     |
| S-04 | ai-note-understanding         | have a free-text note sharpen the candidate set                  | S-02          | FR-006, FR-007                    | proposed |
| S-05 | select-and-mark-watched       | select one pick and mark it watched (excluded from future picks) | S-02          | US-01, FR-011, FR-012             | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                          | Note                                                                                  |
| ------ | ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| A      | Model & solo flow      | `S-01` → `S-02`                | The reshape backbone and the north-star path; everything else hangs off `S-02`.       |
| B      | Flow extensions        | `S-03` / `S-04` / `S-05`       | Three independent extensions, all join Stream A at `S-02`; plannable in parallel.      |

## Baseline

What's already in place in the codebase as of `2026-06-06` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React + Tailwind v4, shadcn; pages `index` (home), `dashboard`, `profiles`, `sessions`, `sessions/[id]/recommendations`.
- **Backend / API:** present — domain endpoints `src/pages/api/{profiles,sessions,recommendations}.ts` (+ `health/integrations`, auth routes).
- **Data:** present — migrations for `viewer_profiles` (two-slot: `slot in (1,2)` + `unique(user_id, slot)`), `movie_night_sessions` (incl. `note`), `recommendations` + `recommendation_picks` (`role` CHECK `'safe'/'compromise'/'wild_card'`); owner-scoped RLS convention. No watched table.
- **Auth:** present — Supabase email/password, middleware guards (per `tech-stack.md`).
- **Deploy / infra:** present — Cloudflare Workers; CI lint+build (per `tech-stack.md`).
- **Observability:** partial — Wrangler platform observability; no app-level logging/error tracking.

## Foundations

**None.** The baseline already provides every cross-cutting enabler this reshape needs: migration tooling and the owner-scoped RLS convention (F-02, archived), provisioned + verified external API access — TMDB + OpenRouter via raw `fetch` (F-01, archived), and a live deploy. The reshape's three small schema deltas (two-slot → single taste core; widen the `recommendation_picks.role` CHECK for solo labels; a new watched table) each ship **inside** their consuming slice (progressive disclosure), so no standalone foundation is justified. The unused `src/lib/ai.ts` OpenRouter client (scaffolded for the now-removed FR-010) is repurposed in S-04 rather than re-scaffolded.

## Slices

### S-01: One remembered taste core

- **Outcome:** user can maintain exactly **one** remembered taste core (stable preferred + excluded genres), replacing the two-profile model, seeing only their own data.
- **Change ID:** remembered-taste-core
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Where the operator edits the stored core — a slim settings screen vs. first-run vs. a "save tonight's genres as my core" affordance (PRD OQ-3) — Owner: user/team. Block: no.
- **Risk:** Touches the shipped `viewer_profiles` model — migrating two slots to a single core (and dropping the two-profile constraint) is the load-bearing model change every later slice assumes. Sequenced first because S-02's pre-fill reads this core. Dev-only data keeps migration risk low; migrations stay additive/reversible per convention.
- **Status:** done

### S-02: Session-first solo flow → three role-labeled picks

- **Outcome:** user can start a movie-night session from the home entry point, see tonight's genres pre-filled from their remembered core (editable for tonight without overwriting it), set mood/runtime/intensity, stay solo, and receive three role-labeled picks (adapted solo role set) from deterministic genre retrieval.
- **Change ID:** session-first-solo-flow
- **PRD refs:** US-01, FR-003, FR-004, FR-008, FR-009
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - The three solo role labels (duo keeps safe/compromise/wild card; solo drops "compromise") (PRD OQ-1, also tracked roadmap-wide as it widens the `recommendation_picks.role` CHECK) — Owner: user/team. Block: no.
- **Risk:** The north star and the densest reshape slice: home entry + pre-fill + tonight-only genre edits + generalizing the scoring engine from "exactly two profiles" to a single taste + a solo role set must cohere into one end-to-end flow within `<10s`. Likely to spawn more than one change in `/10x-plan`. Sequenced immediately after the taste core; deterministic-only (the AI note lands in S-04) so the engine is verifiable without AI.
- **Status:** done

### S-03: Optional inline second viewer (duo path)

- **Outcome:** user can optionally add a second viewer's taste (genres) inline for tonight (or stay solo) and receive duo picks labeled safe / compromise / wild card, scored against both present tastes.
- **Change ID:** optional-inline-second-viewer
- **PRD refs:** US-01, FR-005, FR-008, FR-009
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Extends the solo engine to blend a second, ephemeral taste and restores the duo role set (safe/compromise/wild card) on the cardinality branch. The second viewer is captured on-device and never persisted (honors "no second-person login"). Layered after the solo flow so the one-taste path is proven before the two-taste branch is added.
- **Status:** done

### S-04: AI note understanding sharpens the candidate set

- **Outcome:** user can type a free-text note ("something dumb, maybe with Adam Sandler") and have it parsed into structured search parameters (genres, people/cast, keywords) that improve the candidate set, with graceful fallback to genre-only retrieval.
- **Change ID:** ai-note-understanding
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-05
- **Blockers:** —
- **Unknowns:**
  - The order in which AI-derived filters (cast + keyword + genre alongside the runtime hard filter) are relaxed when the candidate pool falls below three picks (PRD OQ-2) — Owner: user/team. Block: no (tunable during `/10x-plan`).
- **Risk:** The secondary Success Criterion and the only AI-dependent slice; AI now sits on the critical path before retrieval, so it must fit `<10s` and degrade gracefully (empty/unparseable note or slow/unavailable AI → genre-only retrieval still returns three picks). Person/keyword resolution adds external lookups that must respect the runtime's request-count budget. Repurposes the existing unused `src/lib/ai.ts` client.
- **Status:** proposed

### S-05: Select a pick and mark it watched

- **Outcome:** user can select one recommendation to close the decision, mark it watched, and have watched films excluded from future candidate retrieval for the account.
- **Change ID:** select-and-mark-watched
- **PRD refs:** US-01, FR-011, FR-012
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Closes the decision flow (preserved scope, never built). Needs a new watched table; "watched" acts only as a dedup filter on retrieval (not a scoring signal, not a browsable list), which keeps it small. Depends on the reshaped flow producing picks.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                     | Suggested issue title                                  | Ready for `/10x-plan` | Notes                                   |
| ---------- | ----------------------------- | ------------------------------------------------------ | --------------------- | --------------------------------------- |
| S-01       | remembered-taste-core         | Collapse two profiles into one remembered taste core   | done                  | Archived → `context/archive/2026-06-06-remembered-taste-core/` |
| S-02       | session-first-solo-flow       | Session-first solo flow with pre-filled core genres    | done                  | Archived → `context/archive/2026-06-06-session-first-solo-flow/` |
| S-03       | optional-inline-second-viewer | Add optional inline second viewer (duo path)           | done                  | Archived → `context/archive/2026-06-08-optional-inline-second-viewer/` |
| S-04       | ai-note-understanding         | Parse the note into search params to sharpen retrieval | no                    | Ready once S-02 lands                   |
| S-05       | select-and-mark-watched       | Select a pick and mark it watched (dedup filter)       | no                    | Ready once S-02 lands                   |

## Open Roadmap Questions

1. **What are the three solo role labels?** (Duo keeps safe / compromise / wild card; solo drops "compromise" — e.g. safe / crowd-pleaser / wild card.) — Owner: user/team. Block: gates `S-02` and `S-03` (and widens the shared `recommendation_picks.role` CHECK); non-blocking for planning, resolve in `/10x-plan`.

(Per-slice unknowns stay in their slice: the core-editing surface lives on `S-01`; the AI-filter relaxation order lives on `S-04`.)

## Parked

- **OAuth / social login** — Why parked: PRD §Non-Goals; email/password only (unchanged).
- **Second-person login / invitation link / shared account / realtime voting** — Why parked: PRD §Non-Goals; the second viewer is inline + ephemeral on the operator's device.
- **Persistent storage of the second viewer's taste** — Why parked: PRD §Non-Goals; captured per-session only (asymmetric model).
- **AI-generated per-recommendation justifications (old FR-010)** — Why parked: PRD §Non-Goals; AI is redirected to note parsing. The scaffolded-but-unused `src/lib/ai.ts` is repurposed, not deleted.
- **Watch history as a scoring signal or browsable list** — Why parked: PRD §Non-Goals; "watched" is a dedup filter only.
- **Full film platform / full ML recommender system / streaming integration** — Why parked: PRD §Non-Goals.

## Done

- **S-01: user can maintain exactly **one** remembered taste core (stable preferred + excluded genres), replacing the two-profile model, seeing only their own data.** — Archived 2026-06-06 → `context/archive/2026-06-06-remembered-taste-core/`. Lesson: —.
- **S-02: user can start a movie-night session from the home entry point, see tonight's genres pre-filled from their remembered core (editable for tonight without overwriting it), set mood/runtime/intensity, stay solo, and receive three role-labeled picks (adapted solo role set) from deterministic genre retrieval.** — Archived 2026-06-07 → `context/archive/2026-06-06-session-first-solo-flow/`. Lesson: —.
- **S-03: user can optionally add a second viewer's taste (genres) inline for tonight (or stay solo) and receive duo picks labeled safe / compromise / wild card, scored against both present tastes.** — Archived 2026-06-08 → `context/archive/2026-06-08-optional-inline-second-viewer/`. Lesson: —.
