# Frame Brief: One-shot recommend (set preferences → see picks in one action)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Getting recommendations takes two clicks: first "Start session" (which saves
the session and reloads `/sessions?saved=<id>`), then a second "Get
recommendations" button in a separate block.

## Initial Framing (preserved)

- **User's stated cause or approach**: it should be one button, with maybe a short animation in between.
- **User's proposed direction**: a single submit that starts the pick process and shows the picks immediately.
- **Pre-dispatch narrowing**: asked what bothers them about "two clicks" — user picked **"also the separate 'save session' concept"**, not only the extra click. The user does not want "save a session" surfaced as its own step at all.

## Dimension Map

The observation could originate at any of these dimensions:

1. **UI: two forms, two buttons** — `SessionForm` POSTs `/api/sessions`; a *separate* form below POSTs `/api/recommendations` with its own button (`sessions.astro:121-147`). ← initial framing lands here.
2. **Server: two endpoints, sequential** — `/api/sessions` persists the session and redirects back; `/api/recommendations` then *re-loads* that session from the DB by `session_id` (`recommendations.ts:67-76`) before retrieving + scoring. The save must complete and round-trip before recommend can run.
3. **Data model: session is a first-class persisted row** — `recommendations.session_id` is `NOT NULL references movie_night_sessions(id)` (`migration 20260606115345_recommendations.sql:24`). A session row must exist before any run is persisted; the "save" is not removable, only hide-able.
4. **Mental model: "session" is exposed as a user-facing object** — the UI presents "Start session" / "Your saved session" / "save any changes above first" (`sessions.astro:124-127`) as a thing the user manages, rather than an invisible byproduct of asking for picks.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D1: surface UI splits the action in two | two `<form>`s, two submit buttons on `/sessions` (`sessions.astro` SessionForm + lines 121-147) | STRONG |
| D2: server flow is two sequential endpoints | `/api/sessions` save → redirect; `/api/recommendations` reloads session then recommends (`recommendations.ts:48-76`) | STRONG |
| D3: data model forces a persisted session first | FK `recommendations.session_id NOT NULL` (`20260606115345_recommendations.sql:24`); picks → `recommendation_id` → run → session | STRONG (but a constraint, not the problem) |
| D4: "session" is leaked into the user's mental model | copy: "Start session", "Your saved session", "save any changes above first" (`sessions.astro:124-127, 198`) | STRONG — matches the user's narrowing answer |

The surface was read in full; no sub-agent dispatch was needed (guardrail #6).
D3 is a real constraint that *shapes* the solution but is not itself the
problem — the session row can be persisted invisibly within a single action.

## Narrowing Signals

- User's narrowing answer ("also the separate 'save session' concept") rules
  **out** the thin reading "just merge two buttons" and rules **in** the
  deeper one: the user-facing notion of saving/managing a session should
  disappear. This promotes D4 above D1.
- D3 (FK constraint) rules out "stop persisting the session." The reframe must
  *keep* the session row but stop presenting its creation as a step.

## Cross-System Convention

The codebase already passes ephemeral, per-request data inline through the
recommendations POST without a prior save: the second viewer's taste is
captured on-device and POSTed as repeated fields on the same request, never
persisted (`recommendations.ts:94-109`, `SecondViewer.tsx`). That is direct
precedent for "submit the form's data straight into a recommend action."
Astro/workerd POST-redirect-GET is the established pattern here; the redirect
target after a run is already `/sessions/<id>/recommendations`
(`recommendations.ts:179`). A single action can persist-then-recommend
server-side and redirect once.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the flow exposes "save a movie-night
> session" as a distinct user step (its own button, its own copy, its own
> reload) that sits between the user and their picks — when the user's intent
> is a single act: *set tonight's preferences → see three picks*.

This is a reframe, not a rejection. "One button" (D1) is the surface; the root
(D4) is that the session is leaked into the user's mental model as an object to
manage. The plan should collapse the two-step UI into one submit **and** retire
the "save session / saved session" language, while keeping the session row as
an invisible server-side byproduct (D3). Because this runs on the
recommendations pipeline, it sits squarely on **Risk #1** of
`context/foundation/test-plan.md` ("fewer than three picks") — the merge must
not weaken the always-three-picks / graceful-degradation guarantees.

## Confidence

- **HIGH** — every dimension is file:line-anchored; the FK constraint and the
  second-viewer precedent together make the persist-then-recommend orchestration
  concrete and convention-aligned; the user's narrowing answer decisively
  promoted the root (D4) over the surface (D1).

## What Changes for /10x-plan

Plan a single "submit preferences → get picks" action that, server-side,
persists (or updates) the session and runs retrieval+scoring in one flow, then
redirects to the picks — with an interstitial/pending state covering the work.
Retire the user-facing "save session" / "saved session" framing. Treat the
recommendations pipeline as load-bearing: the plan must preserve the
always-three-picks and external-edge fallback guarantees (test-plan Risk #1/#2)
and is best sequenced with — or after — test-plan Phase 1. Open questions for
/10x-plan: whether to chain `/api/sessions` → recommend or fold into one
endpoint; whether picks render inline or via the existing redirect; how the
"edit an existing session" path (`?saved=` edit mode) folds into one-shot.

## References

- Source files: `src/pages/sessions.astro:121-147` (two-form block), `src/components/sessions/SessionForm.tsx:197-199` (save button), `src/pages/api/sessions.ts`, `src/pages/api/recommendations.ts:48-76,94-109,179`, `supabase/migrations/20260606115345_recommendations.sql:24`, `src/components/sessions/SecondViewer.tsx`
- Related: `context/foundation/test-plan.md` §2 Risk #1 / #2 (pipeline guarantees)
- Investigation tasks: none dispatched — surface small and fully read (guardrail #6)
