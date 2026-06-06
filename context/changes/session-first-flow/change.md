---
change_id: session-first-flow
title: Session-first flow — remembered taste core + per-night mood + solo/duo
status: preparing
created: 2026-06-06
updated: 2026-06-06
archived_at: null
---

## Notes

Reframe of the MovieMate user flow, opened from a `/10x-frame` pass (see `frame.md`).
The user is unhappy with the current flow: persistent two-profile CRUD in account
settings, while the session form re-collects the same genre taste, and the engine
hard-requires exactly two viewers (no solo). This change reverses the FR-002
"persistent two-profile" decision in spirit and adds an optional second viewer
(solo mode), but — per the frame — keeps a *remembered stable taste core* rather
than deleting it. Touches already-shipped S-01 (viewer-profiles) and S-03
(scored-recommendations). Next step after the frame is PRD/roadmap reshaping, not
a direct /10x-plan, because it changes FR-001/FR-002, US-01, persona, and Non-Goals.
