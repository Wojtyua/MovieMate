# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Reconcile the roadmap Backlog Handoff table after archiving

- **Context**: After any `/10x-archive` run, when `context/foundation/roadmap.md` has a Backlog Handoff table referencing the archived change-id.
- **Problem**: `/10x-archive` updates only the At-a-glance Status, the item-body Status, and the Done section — it leaves the Backlog Handoff table row stale (still "in progress", outdated notes), so the roadmap shows contradictory states for the same item after archiving.
- **Rule**: After archiving a change, also reconcile the roadmap's Backlog Handoff table row for that change-id: set the "Ready for /10x-plan" column to `done` and update Notes to point at the archived path.
- **Applies to**: archive, implement
