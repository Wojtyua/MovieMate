---
project: MovieMate
version: 1
status: draft
created: 2026-05-30
updated: 2026-06-02
prd_version: 2
main_goal: low-complexity
top_blocker: none
---

# Roadmap: MovieMate

> Derived from `context/foundation/prd.md` (v2) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

MovieMate fights decision paralysis on a shared movie night: a single logged-in operator captures two people's tastes plus the evening's constraints, and the app returns three justified recommendations instead of another long catalog. The core hypothesis (the one claim that, if false, makes the product pointless) is that filtering TMDB candidates, scoring them against both profiles, and labeling three distinct roles produces a genuinely useful decision set — not three near-identical films.

## North star

**S-03: user can submit session preferences and receive three scored, role-labeled recommendations** — this is the validation milestone, the smallest end-to-end flow whose success proves the core hypothesis; everything else (profiles, AI justification, watched-dedup) only matters if this engine produces a good three-pick set. It is placed as early as its data and external-API prerequisites allow.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | provision-external-apis | (foundation) external TMDB + AI access provisioned and verified | — | FR-005, FR-010 | done |
| F-02 | persistence-baseline-rls | (foundation) migration tooling + "own data only" RLS convention | — | FR-001 | done |
| S-01 | viewer-profiles | create and edit two viewer profiles, seeing only own data | F-02 | FR-001, FR-002 | proposed |
| S-02 | movie-night-session-prefs | start a movie-night session and save its preferences | F-02 | FR-003, FR-004 | proposed |
| S-03 | scored-recommendations | get three scored, role-labeled recommendations | F-01, S-01, S-02 | US-01, FR-005, FR-006, FR-007, FR-008, FR-009 | proposed |
| S-04 | ai-justifications | read an AI justification for each recommendation | S-03, F-01 | FR-010 | proposed |
| S-05 | select-and-mark-watched | select one recommendation and mark it watched | S-03, F-02 | US-01, FR-011, FR-012 | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Recommendation engine | `F-01` → `S-03` → `S-04` / `S-05` | North-star path; `S-03` also consumes data from Stream B (`S-01`, `S-02`); gated by external API keys (`F-01`). |
| B | Data: profiles & session | `F-02` → `S-01` / `S-02` | Independent data entities, plannable in parallel; both feed `S-03` in Stream A. |

## Baseline

What's already in place in the codebase as of `2026-05-30` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React + Tailwind v4, file-based routing, shadcn configured (`astro.config.mjs:10-16`).
- **Backend / API:** partial — only four auth `APIRoute` handlers (signin/signup/signout/callback); no domain endpoints (`src/pages/api/auth/signin.ts`).
- **Data:** partial — Supabase SSR client for auth only; no app tables, no `supabase/migrations/` (`src/lib/supabase.ts:5-24`).
- **Auth:** present — Supabase email/password, middleware guards `/dashboard`, signin/signup/callback wired (`src/middleware.ts:14-28`).
- **Deploy / infra:** present — Cloudflare Workers; first deploy live, CI lints+builds; auto-deploy-on-merge pending a one-time dashboard gate (`context/deployment/deploy-plan.md`).
- **Observability:** partial — Wrangler platform observability enabled; no app-level logging or error tracking (`wrangler.jsonc:12-14`).

## Foundations

### F-01: Provision external API integrations

- **Outcome:** (foundation) TMDB and AI-provider access is provisioned and verified — keys declared via `astro:env`, set as Worker secrets, and a thin end-to-end call to each returns successfully from the workerd runtime.
- **Change ID:** provision-external-apis
- **PRD refs:** FR-005, FR-010, NFR (recommendations within 10s)
- **Unlocks:** S-03 (candidate retrieval + scoring), S-04 (AI justification); reduces the blocking unknown "which AI provider/model and cost ceiling"; establishes the `<10s` NFR verification path.
- **Prerequisites:** — (deploy baseline already present)
- **Parallel with:** F-02
- **Blockers:** — (resolved 2026-06-02: both keys obtained; secrets set on the `moviemate` Worker + GitHub repo; `.dev.vars` populated for local workerd).
- **Unknowns:**
  - ~~Which AI provider/model and cost ceiling, and does the SDK run on workerd (Web-standard `fetch`, no Node streams)?~~ — Resolved 2026-06-02: OpenRouter (OpenAI-compatible) called over raw `fetch` (no SDK → no Node-streams risk); cheap, env-configurable model (`AI_MODEL`). See `context/changes/provision-external-apis/plan.md`.
- **Risk:** External + runtime risk is concentrated here (`infrastructure.md` risk register: workerd ≠ Node, subrequest/CPU caps, `<10s` NFR). Sequenced first because the entire north-star path is dead without verified external access; a thin verified call de-risks before the engine is built.
- **Status:** done

### F-02: Persistence baseline with row-level access

- **Outcome:** (foundation) Supabase migration tooling is wired and a row-level-security convention enforces "own data only", so the first data-bearing slice can add its table and trust FR-001 at the data layer.
- **Change ID:** persistence-baseline-rls
- **PRD refs:** FR-001
- **Unlocks:** S-01 (viewer profiles), S-02 (session + preferences), S-05 (watched-dedup table).
- **Prerequisites:** — (auth already present in baseline)
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Minimal enabler only — establishes migrations plus the RLS pattern, not all tables (each entity ships with its consuming slice). Sequenced before the data slices so FR-001 enforcement isn't reinvented per table.
- **Status:** done

## Slices

### S-01: Create and edit two viewer profiles

- **Outcome:** user can log in and create/edit exactly two viewer profiles holding each person's taste, seeing only their own data.
- **Change ID:** viewer-profiles
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** F-02
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:**
  - What taste fields a viewer profile captures (preferred genres, keywords, etc.) that the S-03 scoring rule will consume — Owner: user/team. Block: no.
- **Risk:** Profile shape must align with what S-03 scoring consumes; deciding the fields now avoids rework, but it's a design choice, not a blocker.
- **Status:** proposed

### S-02: Start a movie-night session and save preferences

- **Outcome:** user can start a movie-night session and save its preferences — mood, preferred genres, excluded genres, runtime limit, intensity, and an extra note.
- **Change ID:** movie-night-session-prefs
- **PRD refs:** FR-003, FR-004
- **Prerequisites:** F-02
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** These preference fields are the input contract for S-03; keep them aligned with TMDB hard-filter capabilities (genre, runtime, rating, year) so candidate retrieval stays feasible.
- **Status:** proposed

### S-03: Get three scored, role-labeled recommendations

- **Outcome:** user can submit session preferences and receive three meaningfully distinct recommendations — labeled safe pick, compromise pick, and wild card — drawn from TMDB candidates scored against both viewer profiles and the session constraints.
- **Change ID:** scored-recommendations
- **PRD refs:** US-01, FR-005, FR-006, FR-007, FR-008, FR-009
- **Prerequisites:** F-01, S-01, S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Scoring weights and the diversity threshold that guarantees the wild card differs from the safe pick in genre or tone — Owner: user/team. Block: no (tunable during `/10x-plan`).
- **Risk:** The validation milestone and the densest slice: TMDB retrieval + hard-filter + dual-profile scoring + role diversity must cohere into one output within `<10s`. Likely to spawn more than one change in `/10x-plan`. Sequenced immediately after its data and external prerequisites.
- **Status:** proposed

### S-04: Read an AI justification for each recommendation

- **Outcome:** user can read a short, understandable AI-generated justification explaining why each of the three recommendations fits the session.
- **Change ID:** ai-justifications
- **PRD refs:** FR-010
- **Prerequisites:** S-03, F-01
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Secondary success criterion and the only AI-dependent slice; AI is feature-flagged (`infrastructure.md`), so it must degrade gracefully if the upstream is slow or down, protecting the `<10s` NFR. Layered after deterministic scoring so the engine is verifiable without AI.
- **Status:** proposed

### S-05: Select a recommendation and mark it watched

- **Outcome:** user can select one recommendation to close the decision, mark it watched, and have watched films excluded from future candidate retrieval for the account.
- **Change ID:** select-and-mark-watched
- **PRD refs:** US-01, FR-011, FR-012
- **Prerequisites:** S-03, F-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Closes the decision flow; watched acts only as a dedup filter on retrieval (not a scoring signal), which keeps it small. Depends on recommendations existing and on the persistence baseline for the watched table.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | provision-external-apis | Provision and verify TMDB + AI provider access | done | Archived 2026-06-02 → `context/archive/2026-06-02-provision-external-apis/` |
| F-02 | persistence-baseline-rls | Wire Supabase migrations + own-data RLS convention | yes | Run `/10x-plan persistence-baseline-rls` |
| S-01 | viewer-profiles | Create and edit two viewer profiles | no | Ready once F-02 lands |
| S-02 | movie-night-session-prefs | Start movie-night session and save preferences | no | Ready once F-02 lands |
| S-03 | scored-recommendations | Generate three scored, role-labeled recommendations | no | Ready once F-01, S-01, S-02 land |
| S-04 | ai-justifications | Add AI justification per recommendation | no | Ready once S-03 and F-01 land |
| S-05 | select-and-mark-watched | Select a recommendation and mark it watched | no | Ready once S-03 and F-02 land |

## Open Roadmap Questions

1. ~~**Which AI provider/model and cost ceiling, and does the SDK run on workerd?**~~ — Resolved 2026-06-02 (OpenRouter via raw `fetch`, cheap env-configurable `AI_MODEL`). No longer blocking F-01 / S-04.

## Parked

- **OAuth / social login** — Why parked: PRD §Non-Goals; email-and-password only for a single pair on one device. May return later.
- **Watch history as a scoring signal or browsable list** — Why parked: PRD §Non-Goals; "watched" exists only to exclude already-seen films from future candidates.
- **Second-person login / invitation links / shared account / realtime voting** — Why parked: PRD §Non-Goals; one operator captures both tastes as two profiles.
- **Full film platform (reviews, comments, social features, complete movie DB)** — Why parked: PRD §Non-Goals.
- **Full ML recommendation system trained on user history** — Why parked: PRD §Non-Goals; MVP uses explicit preferences + transparent scoring.
- **Streaming-service / where-to-watch integration** — Why parked: PRD §Non-Goals; may return later as a lightweight informational feature only.

## Done

- **F-02: (foundation) Supabase migration tooling is wired and a row-level-security convention enforces "own data only", so the first data-bearing slice can add its table and trust FR-001 at the data layer.** — Archived 2026-05-30 → `context/archive/2026-05-30-persistence-baseline-rls/`. Lesson: —.
- **F-01: (foundation) TMDB and AI-provider access is provisioned and verified — keys declared via `astro:env`, set as Worker secrets, and a thin end-to-end call to each returns successfully from the workerd runtime.** — Archived 2026-06-02 → `context/archive/2026-06-02-provision-external-apis/`. Lesson: —.
