---
project: "MovieMate"
context_type: brownfield
created: 2026-06-06
updated: 2026-06-06
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  delivery_weeks: 2
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "change category"
      decision: "Flow/model reshape of an existing app: collapse the two-persistent-profile model, add optional second viewer + solo, make the note AI-actionable, and redirect AI from justifications to note parsing."
    - topic: "taste core home (PIVOT)"
      decision: "Asymmetric: ONLY the logged-in operator has a remembered taste core (stable genres). The second viewer is never persisted — captured inline in the session, ephemeral. No second person added = solo."
    - topic: "operator genres per session"
      decision: "Remembered core PRE-FILLS the session genres, editable for tonight; tonight's edit does NOT overwrite the stored core."
    - topic: "persona scope"
      decision: "One persona (the operator). Solo is an option of the same persona, not a new persona."
    - topic: "insight"
      decision: "The friction + duplication of a mandatory upfront second profile outweighs the value of persisting it; solo is a real case, not an edge case; AI is better spent improving the candidate set than explaining picks."
    - topic: "AI role"
      decision: "REPLACE. AI = note -> structured search params (genres, people/cast, keywords). Per-recommendation justifications removed. One AI call, before TMDB retrieval."
    - topic: "graceful degradation"
      decision: "Empty note or AI unavailable/slow -> fall back to deterministic genre retrieval (core + session). The note only enhances; the flow always returns three picks within the <10s budget."
    - topic: "role set under solo"
      decision: "Duo keeps safe/compromise/wild card. Solo drops 'compromise' (no second viewer to compromise between) and uses an adapted three-role set; exact solo labels deferred to /10x-plan (see Open Questions)."
  frs_drafted: 12
  quality_check_status: accepted
---

> Brownfield reshape opened from `context/changes/session-first-flow/frame.md`
> (frame confidence HIGH). The prior greenfield shape was archived to
> `context/foundation/archive/shape-notes-2026-06-06-1611.md`. This file feeds
> `/10x-prd` (brownfield, 11 sections) -> `/10x-roadmap`.

## Current System Overview

**Purpose** (one sentence): MovieMate fights movie-night decision paralysis by
returning three scored, role-labeled film picks for a specific evening instead of
another long catalog.

**Architecture**: Astro 6 SSR running serverless on Cloudflare Workers (workerd).

**Tech stack**: Astro 6 + React + Tailwind v4; shadcn UI; Supabase (email/password
auth + Postgres with an owner-scoped RLS convention "own data only"); TMDB discover
for candidate retrieval; OpenRouter (OpenAI-compatible, raw `fetch`, cheap
env-configurable `AI_MODEL`) for AI.

**Current user base**: a single logged-in operator (small scale, low QPS).

**Core functionality today** (what's shipped):
- Email/password auth with middleware-guarded routes (baseline).
- **S-01** — two **persistent** viewer profiles (account-level CRUD; DB enforces
  exactly two via `slot in (1,2)` + `unique(user_id, slot)`).
- **S-02** — start a movie-night session and save its preferences (mood, preferred
  genres, excluded genres, runtime limit, intensity, free-text note).
- **S-03** — three scored, role-labeled recommendations (safe/compromise/wild card)
  from TMDB candidates scored against **both** profiles + session prefs; persisted
  as a run + three snapshotted picks.
- **Not yet built**: S-04 (AI justifications) and S-05 (select + mark watched).

## Problem Statement & Motivation

**The gap.** The flow makes the operator re-enter and upfront-configure the *stable*
part of taste: the same genre dimensions are captured **and scored twice** — once as
a mandatory account-level profile, again in the session form (`SessionForm.tsx`
"Preferred/Avoid genres" ↔ `viewer_profiles.preferred/excluded_genre_ids`; scorer
weights `W_PREF/W_EXCL` vs `W_SPREF/W_SEXCL`). The engine rigidly assumes **exactly
two viewers** (`length < 2` redirect; `[Profile, Profile]`; `combined = A+B`), so
there is **no solo path**. Separately, the session **note does nothing** (stored,
never used), and AI is spent on **cosmetic justifications** rather than improving the
candidate set — the product's actual core.

**Why now.** S-03 just shipped; S-04/S-05 are not built yet. This is the cheapest
moment to correct the flow before more slices pile onto a model we're changing.

**Workaround cost today.** None viable — solo is impossible, and every session
re-collects the stable taste with no payoff.

## User & Persona

Primary (and only) persona: **the logged-in operator** choosing a film for tonight —
sometimes for a pair, sometimes alone. Example: Wojtek opens MovieMate, his remembered
taste core pre-fills tonight's genres; he tweaks the mood, optionally adds his
girlfriend's taste inline for this session (or not, when watching alone), types a
free-text note ("something dumb, maybe with Adam Sandler"), and gets three picks.

Solo is an **option of this persona**, not a separate persona.

## Success Criteria

### Primary

- A logged-in operator can complete the reshaped flow end to end: from a home entry
  point, start a session; tonight's genres are **pre-filled from their remembered
  taste core** (editable for tonight without overwriting the core); they set mood /
  runtime / intensity and optionally a free-text note; they **optionally add a second
  viewer's taste inline** (or stay solo); they receive **three scored, role-labeled
  picks** (the candidate set improved by AI-parsed note params when a note is
  present); they select one; and it is **saved as watched and never recommended
  again**.

### Secondary

- The free-text note is analyzed by AI into structured search parameters (genres,
  people/cast, keywords) that measurably improve candidate retrieval over the
  genre-only baseline.

### Guardrails

- At most **three** recommendations (never a catalog).
- Recommendations return within **<10s** even though AI now sits on the critical
  path before retrieval.
- **Graceful degradation**: empty note or AI unavailable/slow → deterministic genre
  retrieval; the flow still returns three picks within budget.
- **Own-data RLS preserved** — a user only ever sees their own data.
- **No second-person login** — the second viewer is captured on the operator's
  device, never authenticated, never persisted.
- The deterministic scoring core is **extended, not replaced**.

## User Stories

### US-01: Operator gets picks for tonight (solo or duo)

- **Given** a logged-in operator whose remembered taste core pre-fills tonight's genres
- **When** they start a session, set tonight's mood/runtime/intensity, optionally add
  a second viewer's taste inline, optionally type a free-text note, and request
  recommendations
- **Then** MovieMate returns at most three role-labeled picks — drawn from a TMDB
  candidate set improved by AI-extracted note params when present (deterministic
  genre retrieval otherwise) — and the operator can select one and mark it watched,
  excluding it from future candidates.

#### Acceptance Criteria

- Output contains no more than three films.
- **Duo** picks are labeled safe / compromise / wild card; **solo** picks use the
  adapted solo role set (no "compromise"); the wild card differs from the safe pick
  in genre.
- Adding no second viewer yields a valid solo result.
- A note like "something dumb, maybe with Adam Sandler" yields a candidate set
  reflecting Comedy + the resolved person (Adam Sandler) when those resolve; if the
  note is empty or AI/resolution fails, the genre-only candidate set is used and the
  result still contains three picks.
- The selected pick is recorded as watched and excluded from future candidate retrieval.

## Scope of Change

> FR-NNN lines with a `Change:` tag (`new` | `modified` | `removed` | `preserved`),
> mapping to the brownfield PRD `## Scope of Change` section. `> Socrates:` blockquotes
> capture counter-arguments resolved during this shaping dialogue.

### Account & remembered taste core

- FR-001: User can log in and access only their own data. Priority: must-have. Change: preserved
  > Socrates: Counter-argument: a single pair on one device makes data separation
  > low-value. Resolution: preserved — the account anchors the remembered taste core
  > and the watched-dedup set; RLS convention stays.
- FR-002: User maintains exactly **one** remembered taste core for themselves
  (stable preferred + excluded genres). Priority: must-have. Change: modified
  > Socrates: Counter-argument (the original PRD's choice): two persistent profiles
  > capture the pair's combined taste. Resolution: REVERSED — friction + double-entry
  > of a mandatory second profile outweighs its value; only the operator (who returns
  > every night) gets a persisted core. The second viewer is captured per-session.

### Session-first flow

- FR-003: User can start a movie-night session from a home entry point
  (home → login → start session). Priority: must-have. Change: modified
  > Socrates: Counter-argument: an extra home page adds a click. Resolution: kept —
  > the entry point replaces the `/profiles` precondition gate; net friction drops.
- FR-004: User can set tonight's preferences — genres **pre-filled from the remembered
  core and editable for tonight (without overwriting the core)**, plus mood, runtime
  limit, intensity, and a free-text note. Priority: must-have. Change: modified
  > Socrates: Counter-argument: pre-filling hides that genres are still editable.
  > Resolution: kept — pre-fill removes re-entry while tonight-only edits preserve
  > evening variance; the core is unchanged unless edited on its own screen.
- FR-005: User can **optionally** add a second viewer's taste (genres) **inline** in
  the session; with none added, the session is **solo**. Priority: must-have. Change: new
  > Socrates: Counter-argument: an optional second viewer doubles the form's states.
  > Resolution: accepted — solo vs duo is the central new capability; the second
  > viewer is ephemeral (not stored), honoring "no second-person login".

### AI note understanding & candidate retrieval

- FR-006: The free-text note is analyzed by AI to extract structured search params
  (genres, people/cast, keywords) used to improve candidate retrieval. Priority:
  must-have. Change: modified
  > Socrates: Counter-argument: free-text parsing can hallucinate entities.
  > Resolution: accepted with a hard fallback (FR-012) — AI output only *adds*
  > query signal; failures degrade to genre-only retrieval.
- FR-007: User can request candidates from TMDB discover using hard filters (runtime)
  plus AI-derived filters (genres, resolved people via `/search/person`, resolved
  keywords via `/search/keyword`), with AI-derived filters **relaxed when the pool is
  too thin to guarantee three picks**. Priority: must-have. Change: modified
  > Socrates: Counter-argument: cast + keyword + runtime filters can over-narrow to
  > <3 films. Resolution: relaxation/fallback strategy required so "always three
  > picks" survives (exact relaxation order is a /10x-plan tuning detail).
- FR-008: Candidates are scored against the **operator's tonight genres + the optional
  second viewer's genres + session mood/intensity + quality + popularity**; excluded
  genres strongly penalized. Priority: must-have. Change: modified
  > Socrates: Counter-argument: the current scorer assumes two viewers always.
  > Resolution: the deterministic core is generalized to 1-or-2 viewer tastes; the
  > tunable weight block is preserved.

### Recommendations

- FR-009: User sees at most three role-labeled picks; **duo** = safe / compromise /
  wild card, **solo** = adapted role set (no "compromise"); the wild card differs
  from the safe pick in genre. Priority: must-have. Change: modified
  > Socrates: Counter-argument: solo makes "compromise" meaningless (user's own Q2).
  > Resolution: roles branch on cardinality; solo labels finalized in /10x-plan.
- FR-010: AI-generated per-recommendation justification. Priority: — . Change: removed
  > Socrates: Counter-argument: justifications build trust in a pick. Resolution:
  > removed — AI is redirected to note parsing (higher product value); trust now
  > comes from a better candidate set, not post-hoc explanation.
- FR-011: User can select one recommendation to close the decision. Priority:
  must-have. Change: preserved (not yet built — was S-05)
  > Socrates: no counter-argument; selecting one pick closes the flow.
- FR-012: User can mark the selected recommendation as watched; watched films are
  excluded from future candidate retrieval. Priority: must-have. Change: preserved
  (not yet built — was S-05)
  > Socrates: Counter-argument: a watch history could feed scoring. Resolution: kept
  > as a dedup filter only (not a scoring signal, not a browsable list) — unchanged
  > from the original scope.

## Constraints & Compatibility

- **Data migration required.** `viewer_profiles` changes from a two-slot model to a
  single remembered taste core per user (repurpose or replace the table; drop the
  `slot`/`unique` two-profile constraints). `recommendation_picks.role` CHECK must
  admit the solo role set. Dev-only data → migration risk is low, but migrations must
  be additive/reversible per the existing convention.
- **Preserve**: the owner-scoped RLS convention; the deterministic scoring core
  (extend to 1-or-2 tastes, keep the tunable weight block); the snapshot-on-pick
  pattern in `recommendation_picks`; the ≤3-picks guardrail; the <10s NFR.
- **Touches already-shipped slices**: S-01 (viewer-profiles — model + UI), S-03
  (scoring engine, `/api/recommendations`, `SessionForm`). S-02's session table gains
  the AI-parsing path; the genre fields' role shifts (pre-filled, tonight-only).
- **External**: AI now on the critical path before TMDB → must fit the <10s budget
  and degrade. TMDB person/keyword resolution adds subrequests (workerd subrequest
  cap to respect, per `infrastructure.md`).

## Business Logic Changes

**Current rule**: MovieMate scores TMDB candidates against two persistent viewer
profiles plus session preferences and returns three role-labeled picks.

**New rule** (one sentence): MovieMate turns one operator's remembered taste core
(pre-filled and tonight-adjustable), the evening's mood, an AI-parsed free-text note,
and an *optional* second viewer's inline taste into an improved TMDB candidate set,
scores it against the present taste(s) and session constraints, and returns three
role-labeled picks — roles adapting to solo vs duo.

Inputs the rule consumes (user-facing): the operator's tonight genres (seeded from the
remembered core), mood, runtime limit, intensity, an optional free-text note, and an
optional second viewer's genres. The note is parsed into genres/people/keywords that
sharpen retrieval; when absent or unparseable, retrieval falls back to genres only.
Films already marked watched are excluded from retrieval (dedup, not a scoring signal).
Output: three role-labeled picks (duo: safe/compromise/wild card; solo: adapted set),
encountered immediately after submitting the session — no catalog, ever.

## Access Control Changes

No access-control changes — the email/password, flat single-user, own-data-RLS model
is preserved. The only shift is conceptual: an account now anchors **one** remembered
taste core (not two profiles) plus sessions and the watched set.

## Non-Goals

- **No OAuth / social login** — email/password only (unchanged).
- **No second-person login, invitation link, shared account, or realtime voting** —
  the second viewer is inline + ephemeral on the operator's device (reinforced).
- **No persistent storage of the second viewer's taste** — captured per-session only
  (new, follows from the asymmetric model).
- **No AI-generated per-recommendation justifications** — AI is redirected to note
  parsing (new; reverses old FR-010).
- **No watch history as a scoring signal or browsable list** — "watched" is a dedup
  filter only (unchanged).
- **No full film platform, no full ML recsys, no streaming integration** (unchanged).

## Open Questions

1. **Solo role labels.** Duo keeps safe / compromise / wild card. What are the three
   solo labels (e.g., safe / crowd-pleaser / wild card)? — Owner: user/team. Resolve
   in `/10x-plan`. Block: no (affects FR-009 copy + `recommendation_picks.role` CHECK).
2. **AI-derived filter relaxation order.** When cast+keyword+genre+runtime over-narrow
   the pool below three, in what order are AI-derived filters relaxed to preserve
   "always three picks"? — Owner: user/team. Resolve in `/10x-plan`. Block: no.
3. **Remembered-core editing surface.** Where does the operator edit the stored core
   (a slim settings screen vs. first-run vs. a "save tonight's genres as my core"
   affordance)? — Owner: user/team. Resolve in `/10x-plan`/roadmap. Block: no.

## Quality cross-check

- Access Control: present (no change — model preserved).
- Business Logic: present (one-sentence new rule).
- Project artifacts: present.
- Timeline-cost acknowledgment: present — 2-week after-hours change (≤3).
- Non-Goals: present.
- Preserved behavior: present (Constraints & Compatibility names what must not break).
