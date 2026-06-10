---
change_id: one-shot-recommend
title: One-shot recommend — set preferences → see picks in a single action
status: implementing
created: 2026-06-10
updated: 2026-06-10
---

## Notes

Post-ship correction to the Session-First Flow Reshape (`context/foundation/roadmap.md`). Proposed roadmap slice **S-07**. Builds on S-02 / S-03 (both done). Sibling of `navigation-cleanup` (S-06).

- **Outcome:** submitting tonight's preferences yields three picks in a single user action — no separate "save session" step, no second "Get recommendations" click. A short interstitial (loading) state may cover the work.
- **Observation (user):** "two clicks to get recommendations — should be one button"; on narrowing, also bothered that "save a session" is surfaced as its own concept.
- **Risk / shape:** touches the recommendations pipeline = **Risk #1** in `context/foundation/test-plan.md` ("fewer than three picks"). Server-side, the session row must still be persisted before a run (FK `recommendations.session_id NOT NULL`), so this is an orchestration change (persist-then-recommend in one action), **not** a schema change. The "save session" concept is hidden from the user, not removed from the data model.
- **Framed in:** `frame.md` (this folder).
