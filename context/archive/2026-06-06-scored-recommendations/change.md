---
change_id: scored-recommendations
title: Get three scored, role-labeled movie recommendations
status: archived
created: 2026-06-06
updated: 2026-06-06
archived_at: 2026-06-06T15:27:25Z
---

## Notes

Roadmap slice S-03 (north-star validation milestone). Outcome: user submits session
preferences and receives three meaningfully distinct recommendations — labeled safe pick,
compromise pick, and wild card — drawn from TMDB candidates scored against both viewer
profiles and the session constraints. PRD refs: US-01, FR-005..FR-009. Prereqs F-01
(TMDB + AI access), S-01 (viewer profiles), S-02 (session prefs) are all done. Open
question to resolve in /10x-plan: scoring weights + diversity threshold guaranteeing the
wild card differs from the safe pick in genre/tone. Must cohere into one output within
the <10s NFR.
