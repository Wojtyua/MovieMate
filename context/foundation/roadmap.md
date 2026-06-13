---
project: MovieMate
version: 1
status: draft
created: 2026-06-06
updated: 2026-06-13
prd_version: 1
main_goal: low-complexity
top_blocker: none (S-08 closed 2026-06-12 — no reproducible defect; see Done)
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

| ID   | Change ID                     | Outcome (user can …)                                                                           | Prerequisites | PRD refs                                        | Status           |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------- | ---------------- |
| S-01 | remembered-taste-core         | maintain one remembered taste core (replaces two profiles)                                     | —             | FR-001, FR-002                                  | done             |
| S-02 | session-first-solo-flow       | start a session from home, solo, and get three role-labeled picks                              | S-01          | US-01, FR-003, FR-004, FR-008, FR-009           | done             |
| S-03 | optional-inline-second-viewer | add a second viewer's taste inline and get duo picks                                           | S-02          | US-01, FR-005, FR-008, FR-009                   | done             |
| S-04 | ai-note-understanding         | have a free-text note sharpen the candidate set                                                | S-02          | FR-006, FR-007                                  | done             |
| S-05 | select-and-mark-watched       | select one pick and mark it watched (excluded from future picks)                               | S-02          | US-01, FR-011, FR-012                           | done             |
| S-06 | navigation-cleanup            | reach every page through one coherent navbar; no dashboard detour                              | S-02          | US-01 (UX/IA correction — no new FR)            | done             |
| S-07 | one-shot-recommend            | set tonight's preferences and get three picks in a single action                               | S-02, S-03    | US-01, FR-003, FR-004                           | done             |
| S-08 | concurrent-user-isolation     | use the app concurrently with other logged-in users without sessions colliding or data leaking | —             | US-01 (correctness/security defect — no new FR) | done (no defect) |
| S-09 | page-transition-flash         | navigate between pages (or re-render) without a brief white-background flash                   | —             | US-01 (UX/rendering defect — no new FR)         | done             |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                          | Chain                    | Note                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Model & solo flow              | `S-01` → `S-02`          | The reshape backbone and the north-star path; everything else hangs off `S-02`.                                                                                                                                                                                        |
| B      | Flow extensions                | `S-03` / `S-04` / `S-05` | Three independent extensions, all join Stream A at `S-02`; plannable in parallel.                                                                                                                                                                                      |
| C      | Flow polish (post-ship)        | `S-06` / `S-07`          | Corrections to the shipped flow, framed in `context/changes/<id>/frame.md`. `S-06` is independent UI/IA; `S-07` touches the recommendations pipeline (test-plan Risk #1) — sequence with/after test-plan Phase 1.                                                      |
| D      | Reliability (post-deploy)      | `S-08`                   | Investigated post-deploy report of concurrent-user breakage. `/10x-research` + live Supabase diagnostics found the code per-request-correct and isolation sound; the symptom did not reproduce. **Closed 2026-06-12 as no reproducible defect** (no longer a blocker). |
| E      | Rendering polish (post-deploy) | `S-09`                   | Post-deploy UX defect: brief white-background flash on page change / re-render. Independent of the reshape chain; confirm the repaint cause via `/10x-frame` + `/10x-research` before planning (S-08 discipline — don't assume the fix).                               |

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
- **Status:** done

### S-05: Select a pick and mark it watched

- **Outcome:** user can select one recommendation to close the decision, mark it watched, and have watched films excluded from future candidate retrieval for the account.
- **Change ID:** select-and-mark-watched
- **PRD refs:** US-01, FR-011, FR-012
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Closes the decision flow (preserved scope, never built). Needs a new watched table; "watched" acts only as a dedup filter on retrieval (not a scoring signal, not a browsable list), which keeps it small. Depends on the reshaped flow producing picks.
- **Status:** done

### S-06: Navigation cleanup — one coherent navbar, no dashboard detour

- **Outcome:** user reaches every page through a single, coherent navbar carried by the shared layout; the redundant `/dashboard` dead-end is gone and the home page is the canonical place to start a movie night.
- **Change ID:** navigation-cleanup
- **PRD refs:** US-01 (UX/IA correction — no new FR)
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - The exact navbar link set and active-state treatment once `/dashboard` is gone (home / movie night / taste core) — Owner: user/team. Block: no (resolve in `/10x-plan`).
- **Risk:** Pure UI/IA change — no recommendations-pipeline touch. The one coupling: today the navbar's _only_ nav target is `/dashboard`, so removing the page forces a navbar redesign; "add a navbar to inner pages" and "remove the dashboard" are one unit of work. Also touches `PROTECTED_ROUTES` and the `← Dashboard` back-links in `sessions` + `profiles`. Framed in `context/changes/navigation-cleanup/frame.md` (Confidence HIGH).
- **Status:** done

### S-07: One-shot recommend — preferences → picks in a single action

- **Outcome:** user submits tonight's preferences and receives three picks in one action — no separate "save session" step, no second "Get recommendations" click — with a short interstitial covering the work.
- **Change ID:** one-shot-recommend
- **PRD refs:** US-01, FR-003, FR-004
- **Prerequisites:** S-02, S-03
- **Parallel with:** S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Chain `/api/sessions` → recommend vs. fold into one endpoint; picks inline vs. the existing redirect; how the "edit an existing session" path folds into one-shot — Owner: user/team. Block: no (resolve in `/10x-plan`).
- **Risk:** Runs on the recommendations pipeline = **Risk #1** in `context/foundation/test-plan.md` ("fewer than three picks"). The reframe: the root is not the extra click but that "save a session" is leaked into the user's mental model as a step — collapse to one action _and_ retire the save-session language, keeping the session row as an invisible server-side byproduct (FK `recommendations.session_id NOT NULL` forces persistence). **Sequence with or after test-plan Phase 1** so the merge lands against the always-three-picks safety net. Framed in `context/changes/one-shot-recommend/frame.md` (Confidence HIGH).
- **Status:** done

### S-08: Concurrent logged-in users don't collide (multi-user isolation)

- **Outcome:** two or more users logged in at the same time can each run their own movie-night flow independently — one user creating a session and choosing tonight's preferences never breaks, hijacks, or leaks into another user's session, and a second person logging in mid-flow does not disrupt the first. Each request is served strictly in its own user's context.
- **Change ID:** concurrent-user-isolation
- **PRD refs:** US-01 (correctness/security defect surfaced post-deploy — no new FR; reinforces the owner-scoped data convention behind FR-008/FR-009)
- **Prerequisites:** — (a fix on the already-shipped flow; not gated by any reshape slice)
- **Parallel with:** — (sits outside the reshape chain)
- **Blockers:** — (was the top blocker pre-investigation; closed 2026-06-12 as no defect — see Resolution below)
- **Unknowns:**
  - Root cause is not yet confirmed and must be established by `/10x-research`, not assumed here. The leading hypothesis is shared mutable server-side auth/session state across concurrent requests on the SSR runtime (e.g. a module-level or otherwise non-per-request Supabase/auth client whose identity is overwritten when a second user authenticates), so one request ends up serving another user's identity. Alternatives to rule out: cookie/session handling that isn't request-scoped, and any in-memory state holding the "current user." — Owner: user/team. Block: no (resolve in `/10x-research`).
  - Whether the failure is purely a crash/disruption or also a cross-account **data exposure** (one user seeing another's taste core, session, or picks). If exposure is possible this is a security incident, not just a reliability bug, and prioritization rises accordingly. — Owner: user/team. Block: no.
  - How to reproduce deterministically (two concurrent authenticated sessions, second login during the first user's preference step) — needed before and after the fix to prove it. — Owner: user/team. Block: no.
- **Risk:** Production-impacting and likely a security concern: if server-side identity is shared across concurrent requests, the app is effectively single-user despite per-user data and the owner-scoped RLS convention — and may leak data between accounts. This is the highest-severity open item because it breaks the core promise that each account sees only its own data (the same isolation guarantee S-01–S-05 were built on). The fix is expected to live at the request/auth boundary rather than in any feature slice, so it is intentionally kept independent of the reshape chain. Pair with a concurrency-focused regression test (two simultaneous authenticated flows) — coordinate with `context/foundation/test-plan.md` so the isolation guarantee lands against a lasting safety net.
- **Resolution (2026-06-12):** Closed as **no reproducible defect**. `/10x-research` refuted the leading hypothesis — the Supabase client is a per-request factory (`src/lib/supabase.ts`), there is no shared mutable per-user state, identity uses the secure `getUser()`, and RLS is enabled + correct on every table (verified live via Supabase advisors + `list_tables`; DB-layer isolation already proven by `supabase/tests/*_isolation.sql`). The operator confirmed concurrent use works in practice. Likely original symptom: a transient (shared external rate limit, or two accounts in the same browser cookie jar). The "harden + repro" plan (optional defense-in-depth owner filters) was **not** implemented; it stays on the shelf in the archived folder as the starting point should the symptom ever return under real concurrent load. The unknowns above are resolved in `context/archive/2026-06-12-concurrent-user-isolation/research.md` (Outcome section).
- **Status:** done (no defect — closed without code change)

### S-09: No white flash on navigation / re-render

- **Outcome:** a user navigating between pages — or on a re-render — never sees a brief white-background flash; the app's background paints consistently from the first frame of each full-page load, so transitions feel seamless rather than blinking through white.
- **Change ID:** page-transition-flash
- **PRD refs:** US-01 (UX/rendering defect surfaced post-deploy — no new FR)
- **Prerequisites:** — (a fix on the already-shipped UI; not gated by any reshape slice)
- **Parallel with:** — (sits outside the reshape chain)
- **Blockers:** —
- **Unknowns:**
  - Root cause must be confirmed by `/10x-research`, not assumed here. Leading hypothesis: because Astro ships a multi-page app (a full document load per navigation), each navigation paints the browser-default white before the app/theme background CSS applies (a FOUC-style unstyled-background flash) — likely because the dark surface lives on an element _below_ `html`/`:root` and that root frame is white for one paint. Alternatives to rule out: no background color set on `html`/`:root`, stylesheet load/order timing (render-blocking vs. deferred), and a React hydration/re-mount that briefly clears styled content. — Owner: user/team. Block: no.
  - Scope of the fix differs by cause: a static background on the root document (cheapest, kills the white frame) vs. adopting Astro View Transitions (broader — animates page-to-page and avoids the full repaint). These are different units of work. — Owner: user/team. Block: no (resolve in `/10x-frame` or `/10x-plan`).
- **Risk:** Pure rendering/UX polish — no recommendations-pipeline or data touch, so low blast radius. The S-08 discipline applies: confirm the actual repaint cause (and which element carries the background) before committing, since "add a root background" and "adopt View Transitions" are very different scopes. Best run through `context/changes/page-transition-flash/frame.md` before planning.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                     | Suggested issue title                                                     | Ready for `/10x-plan` | Notes                                                                                                               |
| ---------- | ----------------------------- | ------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| S-01       | remembered-taste-core         | Collapse two profiles into one remembered taste core                      | done                  | Archived → `context/archive/2026-06-06-remembered-taste-core/`                                                      |
| S-02       | session-first-solo-flow       | Session-first solo flow with pre-filled core genres                       | done                  | Archived → `context/archive/2026-06-06-session-first-solo-flow/`                                                    |
| S-03       | optional-inline-second-viewer | Add optional inline second viewer (duo path)                              | done                  | Archived → `context/archive/2026-06-08-optional-inline-second-viewer/`                                              |
| S-04       | ai-note-understanding         | Parse the note into search params to sharpen retrieval                    | done                  | Archived → `context/archive/2026-06-11-ai-note-understanding/`                                                      |
| S-05       | select-and-mark-watched       | Select a pick and mark it watched (dedup filter)                          | done                  | Archived → `context/archive/2026-06-11-select-and-mark-watched/`                                                    |
| S-06       | navigation-cleanup            | Navigation cleanup — remove dashboard, global navbar                      | done                  | Archived → `context/archive/2026-06-10-navigation-cleanup/`                                                         |
| S-07       | one-shot-recommend            | One-shot recommend — preferences → picks in one action                    | done                  | Archived → `context/archive/2026-06-10-one-shot-recommend/`                                                         |
| S-08       | concurrent-user-isolation     | Fix concurrent logged-in users breaking each other (multi-user isolation) | done (no defect)      | Investigated + closed as no reproducible defect; archived → `context/archive/2026-06-12-concurrent-user-isolation/` |
| S-09       | page-transition-flash         | Eliminate brief white-background flash on page change / re-render         | done                  | Archived → `context/archive/2026-06-13-page-transition-flash/`                                                      |

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
- **S-06: user reaches every page through a single, coherent navbar carried by the shared layout; the redundant `/dashboard` dead-end is gone and the home page is the canonical place to start a movie night.** — Archived 2026-06-10 → `context/archive/2026-06-10-navigation-cleanup/`. Lesson: —.
- **S-07: user submits tonight's preferences and receives three picks in one action — no separate "save session" step, no second "Get recommendations" click — with a short interstitial covering the work.** — Archived 2026-06-10 → `context/archive/2026-06-10-one-shot-recommend/`. Lesson: —.
- **S-04: user can type a free-text note ("something dumb, maybe with Adam Sandler") and have it parsed into structured search parameters (genres, people/cast, keywords) that improve the candidate set, with graceful fallback to genre-only retrieval.** — Archived 2026-06-11 → `context/archive/2026-06-11-ai-note-understanding/`. Lesson: —.
- **S-05: user can select one recommendation to close the decision, mark it watched, and have watched films excluded from future candidate retrieval for the account.** — Archived 2026-06-11 → `context/archive/2026-06-11-select-and-mark-watched/`. Lesson: —.
- **S-08: concurrent logged-in users don't collide — investigated as a post-deploy report and closed as NO reproducible defect (no code change).** Research refuted the shared-state hypothesis (per-request client, no shared mutable state, RLS on + correct, DB isolation already pgTAP-proven); operator confirmed concurrent use works. — Archived 2026-06-12 → `context/archive/2026-06-12-concurrent-user-isolation/`. Lesson: a bug report's leading root-cause hypothesis must be reproduced/confirmed before planning a fix — here research + live diagnostics caught a non-defect before any code was written.
- **S-09: a user navigating between pages never sees a brief white-background flash; the document canvas paints dark from the first frame and client navigations swap without a full reload.** — Archived 2026-06-13 → `context/archive/2026-06-13-page-transition-flash/`. Lesson: —.
