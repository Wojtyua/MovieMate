# Optional Inline Second Viewer (Duo Path) — Plan Brief

> Full plan: `context/changes/optional-inline-second-viewer/plan.md`
> Research: `context/changes/optional-inline-second-viewer/research.md`

## What & Why

Roadmap slice **S-03**. Let the operator optionally add a *second viewer's* genre taste **inline for tonight** (or stay solo) and receive duo picks labeled **safe / compromise / wild card**, scored against both present tastes. The second taste is captured **on-device and never persisted** — honoring the PRD "no second-person login" Non-Goal.

## Starting Point

S-02 already generalized the deterministic engine to one-or-two tastes and left the duo branch **live but unreachable** in production. The engine, DB role domain (`compromise`), and results display all already handle duo — verified on `main`. Today, `/api/recommendations` is hardwired to build one taste from tonight's session genres and call `recommend([taste], …)`. The "Get recommendations" trigger is a plain Astro `<form>` carrying only `session_id`, separate from the React `SessionForm`.

## Desired End State

On `/sessions`, an "Add a second viewer" affordance reveals two genre pickers for a guest whose taste lives only in the browser. Getting recommendations with a populated second viewer yields **Safe / Compromise / Wild card** scored against both tastes; staying solo (or toggling off) yields the existing **Safe / Crowd-pleaser / Wild card**. The second viewer's genres are written to no table — they route only through `/api/recommendations`, which never touches the session row.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Capture-transport seam | Dedicated React island in the recommendations form | Co-locates capture with transport; nothing touches `/api/sessions`, so "never persisted" holds by construction | Research |
| GenrePicker sharing | Extract to shared module | Single source of truth keeps the two islands' styling/behavior in sync | Research |
| Add/remove UX | Toggle, clears on collapse | Solo stays default; clearing makes "stay solo" unambiguous and prevents stale picks riding along | Plan |
| Empty / overlapping 2nd taste | Empty→solo fallback, sanitize self-overlap | Never errors on an ephemeral input the user can't fix via a saved row; degrades gracefully | Plan |
| Discover-pool supply | Rely on existing path + manual check | OR-union strictly broadens the pool; existing "No matching films" redirect already guards empties | Plan |
| Solo middle label (OQ-1/2) | Keep "Crowd-pleaser" (solo) / "Compromise" (duo) | Both already ship and read naturally per cardinality; doc close-out, no code | Plan |

## Scope

**In scope:** Extract `GenrePicker`; branch `/api/recommendations` on an optional sanitized second taste + union the discover hint; second-viewer island wired into the recommendations form.

**Out of scope:** Engine changes, migrations, display changes, `/api/sessions` changes, second-person login/persistence, solo-label rename, discover-pool hardening.

## Architecture / Approach

The second taste flows **only** through the static recommendations `<form>`: a new React island (`SecondViewer`) emits hidden `second_preferred_genre_ids` / `second_excluded_genre_ids` inputs into that form. The API reads them as repeated fields (same pattern as session genres), builds `[taste, second]` when present, and unions both viewers' preferred genres into the TMDB discover hint. Cardinality drives everything downstream — `compromise` role, `balance` metric, and "Compromise" label — for free. The ephemeral guarantee is enforced by omission: the second taste never reaches `/api/sessions`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract GenrePicker | Shared `GenrePicker.tsx` imported by SessionForm + island | Refactor regression in SessionForm (low; pure move) |
| 2. API duo branch | `/api/recommendations` reads + sanitizes second taste, unions discover hint | Empty/overlap edge cases skewing picks (mitigated by empty→solo + sanitize) |
| 3. Second-viewer island | Toggle + pickers emitting hidden inputs into the recs form | Stale second taste after toggle-off (mitigated by clears-on-off) |

**Prerequisites:** S-02 done (engine + DB + display duo-ready — confirmed on `main`). TMDB configured locally.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- Discover-union saturation: unioning two viewers' preferred genres should still yield ≥3 distinct picks after the safe/wild-card disjointness filters — verified manually, not by an automated guard (OR-union only broadens, so low risk).
- Assumes the recommendations route's existing "No matching films" redirect adequately guards the rare empty-pool case.

## Success Criteria (Summary)

- A duo run produces a "Compromise" middle pick scored against both tastes; a solo run is unchanged.
- Toggling the second viewer off reverts to solo picks (clears-on-off proven).
- No second-viewer genres are persisted in any table.
