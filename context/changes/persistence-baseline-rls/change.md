---
change_id: persistence-baseline-rls
title: Persistence baseline — wire Supabase migrations and own-data RLS convention
status: implementing
created: 2026-05-30
updated: 2026-05-30
archived_at: null
---

## Notes

Roadmap F-02 (`context/foundation/roadmap.md`), Stream B foundation.

- **Outcome:** Supabase migration tooling is wired and a row-level-security convention enforces "own data only", so the first data-bearing slice can add its table and trust FR-001 at the data layer.
- **PRD refs:** FR-001.
- **Unlocks:** S-01 (viewer profiles), S-02 (session + preferences), S-05 (watched-dedup table).
- **Prerequisites:** none — auth already present in baseline.
- **Scope guard:** Minimal enabler only — establishes migrations plus the RLS pattern, not all tables (each entity ships with its consuming slice).
- **Baseline:** no `supabase/migrations/` yet; Supabase SSR client used for auth only (`src/lib/supabase.ts`).
- **Status:** ready for `/10x-plan`.
