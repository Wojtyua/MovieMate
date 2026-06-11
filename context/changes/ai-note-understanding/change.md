---
change_id: ai-note-understanding
title: Parse the free-text note into search parameters to sharpen retrieval
status: implementing
created: 2026-06-11
updated: 2026-06-11
archived_at: null
---

## Notes

Roadmap slice S-04 (PRD FR-006, FR-007). The user's free-text note ("something
dumb, maybe with Adam Sandler") is parsed into structured search parameters
(genres, people/cast, keywords) that improve the candidate set, with graceful
fallback to genre-only retrieval.

Goal of this change's research phase: determine the **optimal way to introduce
AI** into this use case — model choice, structured-output mechanism (JSON mode
vs. tool/function calling), prompt design, where parsing sits relative to TMDB
retrieval, the `< 10 s` budget, the workerd subrequest budget for person/keyword
resolution, and graceful degradation when the note is empty/unparseable or AI is
slow/unavailable.

Constraints/known facts:
- Repurposes the existing unused OpenRouter client `src/lib/ai.ts` (default
  `openai/gpt-4o-mini`, `AI_MODEL` env override — comment flags "S-04 retune").
- AI now sits on the critical path before retrieval (test-plan §2 note on the
  `< 10 s` budget); must degrade to genre-only and still return three picks.
- Open question OQ-2 (roadmap): the order in which AI-derived filters
  (cast + keyword + genre alongside the runtime hard filter) are relaxed when
  the candidate pool falls below three picks — tunable in /10x-plan.
