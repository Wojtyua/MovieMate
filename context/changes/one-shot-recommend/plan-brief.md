# One-Shot Recommend — Plan Brief

> Full plan: `context/changes/one-shot-recommend/plan.md`
> Frame brief: `context/changes/one-shot-recommend/frame.md`

## What & Why

The flow exposes "save a movie-night session" as a distinct user step (its own button, its own copy, its own reload) that sits between the user and their picks — when the user's intent is a single act: *set tonight's preferences → see three picks*. This change collapses the two clicks into one submit and retires the "save session / saved session" language, while keeping the session row persisted invisibly (the `recommendations.session_id NOT NULL` FK) and the pipeline guarantees intact.

## Starting Point

Today getting picks takes two clicks: `SessionForm` POSTs `/api/sessions` (persists + reloads `/sessions?saved=<id>`), then a separate "Your saved session" block POSTs `/api/recommendations` (reloads the session, retrieves TMDB, scores, persists the run, redirects to the picks page). Two forms, two endpoints, two buttons.

## Desired End State

`/sessions` shows one form (preferences + optional second viewer). One submit shows a full-screen interstitial, then lands on `/sessions/<id>/recommendations` with three picks. No "save session" step, no "saved session" block, no second button. `/api/sessions` is gone; a single endpoint persists the session and runs the pipeline; the pipeline itself lives in a reusable, testable `src/lib/recommend-run.ts`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Unit of work | Collapse the action **and** retire the "session" mental model | The root is the leaked session-as-object, not just the extra click | Frame |
| Orchestration | One endpoint + extracted pipeline helper | True single action; isolates the always-three-picks logic for test-plan Phase 1 | Plan |
| Picks view | Redirect to the existing SSR picks page | Matches POST-redirect-GET; reuses the working page; survives reload/back | Plan |
| Edit / re-run | Drop user-facing edit mode — always a fresh one-shot | Fully retires the "managed session" model the frame targets | Plan |
| Interstitial | Full-screen overlay via `useFormStatus().pending` | Covers the wait, reuses the existing pending pattern, guards double-submit | Plan |
| Error recovery | Re-fill the form from the just-saved session + show error | Tonight's inputs survive a transient pipeline failure | Plan |

## Scope

**In scope:** Extract retrieve+score+persist into `recommend-run.ts`; consolidate validate + session-insert + pipeline into one endpoint; rewrite `SessionForm` (one-shot, embedded `SecondViewer`, interstitial, no edit mode); rewrite `sessions.astro` (no saved-session block, core-seed normally / session-seed on error, retire copy); delete `/api/sessions`.

**Out of scope:** Scoring engine / role rules / weights; DB schema, FK, RLS; the picks page; AI note understanding (S-04); inline picks rendering; "edit/update an existing session"; automated tests.

## Architecture / Approach

One full-page POST does persist-then-recommend: the consolidated `/api/recommendations` validates the form, inserts a new `movie_night_sessions` row, then calls the `recommend-run.ts` helper (TMDB retrieve → `recommend()` score → persist run + picks) and redirects to `/sessions/<id>/recommendations`. On failure it redirects to `/sessions?error=…`; the page then seeds the form from the just-saved session so inputs survive. The interstitial is a client component inside the form keyed off `useFormStatus`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract pipeline helper | `recommend-run.ts`; endpoint delegates; **no behavior change** | Silently dropping one of the pipeline's error/redirect cases during extraction |
| 2. One-shot flip | Single endpoint + rewritten form/page + interstitial; `/api/sessions` deleted | Touches Risk #1 pipeline; the persist-before-recommend ordering and error-refill must be exact |

**Prerequisites:** S-02 / S-03 (done). Navigation-cleanup (S-06) already shipped the shared `Layout` shell this page renders through.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- **Test-plan sequencing.** The frame recommends sequencing with/after test-plan Phase 1 (`testing-always-three-picks-core`), which is not yet implemented — so the always-three-picks guarantee is currently defended only by manual checks. Phase 1's extraction is structured to make that future test trivial, but the safety net isn't in place yet.
- Assumes each one-shot submit inserting a new session row is acceptable (same as "Start session" today); rows accumulate.
- Assumes a full-page POST + overlay is an acceptable interstitial (no client-fetch SPA submission).

## Success Criteria (Summary)

- One submit on `/sessions` → interstitial → three picks; solo and duo both work.
- A pipeline failure returns the user to a pre-filled form with an error, not a blank one.
- No "save/saved session" concept, second button, or `/api/sessions` endpoint remains; pipeline behavior is unchanged from today.
