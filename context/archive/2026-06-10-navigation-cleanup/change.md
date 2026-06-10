---
change_id: navigation-cleanup
title: Navigation cleanup — remove dashboard, global navbar, home as entry
status: archived
created: 2026-06-10
updated: 2026-06-10
archived_at: 2026-06-10T18:08:01Z
---

## Notes

Post-ship correction to the Session-First Flow Reshape (`context/foundation/roadmap.md`). Proposed roadmap slice **S-06**. Builds on S-02 / S-03 (both done). Sibling of `one-shot-recommend` (S-07).

- **Outcome:** the authenticated entry point and global navigation are coherent — the redundant `/dashboard` dead-end is gone, every authenticated page carries the navbar, and the home page is the canonical start of a movie night.
- **Observation (user):** "dashboard is pointless, remove it"; "the preferences view has no navbar."
- **Risk / shape:** pure UI/IA change, no recommendations-pipeline touch. The one coupling: today the navbar's *only* nav target is `/dashboard`, so removing the page forces a navbar redesign (re-home its links) — the two observations are one problem. Also touches `PROTECTED_ROUTES` (`middleware.ts`) and the `← Dashboard` back-links in `sessions.astro` + `profiles.astro`.
- **Framed in:** `frame.md` (this folder).
