# Frame Brief: Session-first flow for MovieMate

> Framing step before any PRD/roadmap surgery or /10x-plan. This document captures
> what is *actually* at issue, separated from what was initially assumed.

## Reported Observation

The current flow feels heavier and more redundant than the product warrants. The
user maintains two persistent "viewer profiles" in account settings (a separate
CRUD), yet re-picks taste in the session form every evening anyway. The decision
flow does not match the product's own promise of a "short decision flow for a
specific session." There is also no way to find a film for one person watching
alone.

## Initial Framing (preserved)

- **User's stated cause or approach**: The persistent account-level "viewer
  profile" is the *wrong place* for taste; taste should be captured fresh inside
  the session form, with the second person added inline and optional (solo allowed).
- **User's proposed direction**: home → login (1 user) → button to start a session
  → session form with optional inline second person → 3 scored recs → pick one →
  saved as watched, never recommended again.
- **Pre-dispatch narrowing** (the user's own answers about what they *see/want*):
  - Leading friction = **"powtarzanie gustu"** (re-entering the stable taste), not
    primarily too many clicks/gates.
  - Solo output expectation = **"3 picks, but 'compromise' loses meaning"** — the
    user already recognizes the two-viewer role taxonomy breaks for one person.
  - Taste stability = **"stable core + mood"**: a fixed core (favorite/excluded
    genres) that the evening's mood modifies. Profile = core, session = mood.

## Dimension Map

The "friction/redundancy" observation could originate at any of these dimensions:

1. **Taste storage location** — taste lives in a persistent `viewer_profiles`
   table edited via a `/profiles` CRUD. *(This is where the user's framing lands.)*
2. **Taste capture redundancy** — the session form re-collects the *same* genre
   dimensions the profile already holds. `SessionForm.tsx:149-150` renders
   "Preferred genres" + "Avoid genres" pickers; `20260603115857_viewer_profiles.sql:22-23`
   stores `preferred_genre_ids` + `excluded_genre_ids`; the scorer carries parallel
   weights `W_PREF/W_EXCL` (profile) vs `W_SPREF/W_SEXCL` (session) in
   `scoring.ts:13-32`. The same field is entered, and scored, twice.
3. **Viewer cardinality** — "exactly two, always" is structural, not incidental:
   DB `slot in (1,2)` + `unique(user_id, slot)`; the endpoint redirects when
   `rawProfiles.length < 2` (`recommendations.ts:71-73`); the engine signature is
   `[Profile, Profile]` (`roles.ts:87`, `scoring.ts:107`). Solo is impossible.
4. **Entry-flow gating** — `/profiles` is a hard precondition: with <2 profiles the
   recommendations endpoint bounces to `/profiles` (`recommendations.ts:71-73`).
   There is no "home → start a session" path; profile setup is an upfront gate.
5. **Role-taxonomy basis** — safe/compromise/wild assumes two tastes:
   `combined = A_A + A_B` (safe), `balance = min(A_A+shared, A_B+shared)`
   (compromise = best for the worse-off of the *two*) in `scoring.ts:120-121`.
   "Compromise" has no referent with one viewer.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **D1 — Storage location is wrong** (delete persistent profiles, capture all taste inline) | Contradicted by the user's own Q3: taste has a **stable core** worth remembering. Inline-every-night would force re-typing the stable core nightly — *worsening* the very friction in Q1. Persistent storage is the right home for a stable core. | **WEAK / contradicted** |
| **D2 — Capture redundancy** (same taste entered in profile *and* session) | `SessionForm.tsx:149-150` ↔ `viewer_profiles` cols `:22-23`; double-scored via `W_PREF/W_EXCL` vs `W_SPREF/W_SEXCL` (`scoring.ts:13-32`). Q1 = "powtarzanie gustu". Direct code + user signal. | **STRONG** |
| **D3 — Rigid two-viewer cardinality blocks solo** | DB slot CHECK + unique; `length < 2` redirect (`recommendations.ts:71-73`); `[Profile,Profile]` tuple. Q2 wants solo. | **STRONG** |
| **D4 — Upfront `/profiles` gate** | Endpoint forces `/profiles` before any rec (`recommendations.ts:71-73`); no home→start path. Real, but Q1 ranked it *below* redundancy. | **MEDIUM** |
| **D5 — Role taxonomy assumes two tastes** | `combined = A+B`, `balance = min(...)` (`scoring.ts:120-121`); "compromise" undefined solo. Q2 confirms. | **STRONG** (for solo) |

## Narrowing Signals

Decisive observations that narrowed the space:

- **Q3 "stable core + mood"** ruled *out* D1 (the user's own framing): the problem
  is not *where* taste is stored but that the *stable* part is re-collected and
  scored as if it were per-session data.
- **Q1 "powtarzanie gustu"** ruled D2 *in* as the leading root, above D4 (gating).
- **Q2 "compromise loses meaning solo"** ruled D3 + D5 *in* as a real, separate,
  user-wanted scope change with a known conceptual snag (the role set must branch
  for one viewer).

## Cross-System Convention

The PRD already weighed and *rejected* the one-off framing: FR-002's Socrates note
keeps two profiles "because the core product value is combining preferences from
two people," and Non-Goals bars "second-person login / shared account." The
reframe stays inside that convention — it does **not** add a second login; it keeps
a remembered taste core and only changes *how* that core enters the per-night
decision and lets the second viewer be optional. The remembered-core + per-session-
override shape is the conventional way to reconcile "stable preference" with
"this-session intent" without double entry.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the flow makes the user *re-enter and
> upfront-configure the stable part of taste* — the same genre dimensions are
> captured (and scored) twice, once as a mandatory account-level profile and again
> in the session — while rigidly assuming exactly two viewers, so there is no solo
> path and no clean separation between "stable taste core" and "tonight's mood."

The user's surface framing ("persistent profiles are the wrong place; capture taste
inline each night") is **partly wrong by their own account**: Q3 says taste has a
stable core, which is precisely what a persistent store is *for*. Deleting profiles
and capturing everything inline would force re-typing the stable core nightly — the
opposite of the goal. The real fixes are: (a) eliminate the profile↔session
duplication so the stable core is entered once and the session only adds the
evening's mood/constraints, (b) drop the rigid two-viewer assumption so a session
can be solo or duo, and (c) move taste out of a mandatory upfront `/profiles` gate
into the natural session-first flow. Whether the remembered core stays a separate
two-slot entity, becomes an editable default that pre-fills the session, or is
toggled per-session is a *solution* decision for the reshape/plan step, not for the
frame.

## Confidence

**HIGH** — D2/D3/D5 each have direct file:line evidence and a matching user signal;
D1 (the original framing) is contradicted by the user's own Q3. The root cause and
the refutation of the surface fix are both well-supported. The one open item is
purely a downstream *design* choice (the exact home/shape of the remembered core),
correctly deferred.

## What Changes for Planning

This is a **PRD-level** reframe, not a single scoped code change — it touches
FR-001/FR-002 (profiles), US-01 + FR-007/FR-009 (always-two-viewers, role
taxonomy), the persona, and Non-Goals. The honest next step is reshaping the
foundation docs (`/10x-shape` → `/10x-prd` → `/10x-roadmap`) so the rollout chain
(S-01, S-03 especially, plus S-04/S-05) is re-derived coherently — **not** a direct
`/10x-plan`, which presumes a single locked change against an unchanged PRD. The
reshape must decide: (1) the home of the remembered taste core and how it enters
the session without duplication; (2) the solo/duo cardinality and what the role set
becomes for one viewer; (3) the home→login→start entry flow.

## References

- Source files:
  - `src/components/sessions/SessionForm.tsx:149-150` (duplicate genre pickers)
  - `supabase/migrations/20260603115857_viewer_profiles.sql:18-30` (persistent two-slot store)
  - `supabase/migrations/20260606085900_movie_night_sessions.sql:26-36` (session genre cols)
  - `src/lib/recommend/scoring.ts:13-32,107-124` (parallel profile/session weights; A+B coupling)
  - `src/lib/recommend/roles.ts:87-151` ([Profile,Profile] tuple; compromise role)
  - `src/pages/api/recommendations.ts:65-133` (two-profile precondition + load + score)
- Prior decisions: `context/foundation/prd.md` FR-001/FR-002 Socrates notes; §Non-Goals
- Related research: none yet (no `research.md` in this change folder)
- Investigation tasks: none registered — small, fully-read surface; investigated inline
