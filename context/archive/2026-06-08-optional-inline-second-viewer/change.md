---
change_id: optional-inline-second-viewer
title: Optional inline second viewer
status: archived
created: 2026-06-08
updated: 2026-06-08
archived_at: 2026-06-08T09:30:35Z
---

## Notes

Roadmap slice **S-03** (`context/foundation/roadmap.md`). Stream B flow extension; prerequisite S-02 (done). Parallel with S-04, S-05.

- **Outcome:** user can optionally add a second viewer's taste (genres) inline for tonight (or stay solo) and receive duo picks labeled **safe / compromise / wild card**, scored against both present tastes.
- **PRD refs:** US-01, FR-005, FR-008, FR-009.
- **Risk / shape:** extends the solo engine to blend a second, *ephemeral* taste and restores the duo role set on the cardinality branch. The second viewer is captured **on-device, never persisted** (honors "no second-person login" Non-Goal; asymmetric model — no persistent storage of the second viewer's taste). Layered after the solo flow so the one-taste path is proven before the two-taste branch is added.
- **Schema delta:** the `recommendation_picks.role` CHECK already widened in S-02 for solo labels; duo path reuses safe/compromise/wild_card. No new tables expected.
- **Open roadmap Q-1:** solo role labels (duo keeps safe/compromise/wild card) — resolve in /10x-plan; does not block duo branch.
