---
change_id: quality-gates-wiring
title: Quality gates wiring
status: implemented
created: 2026-06-12
updated: 2026-06-13
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Manual verification (2026-06-13)

8 of 9 manual gates pass; one finding and one plan-mismatch fix:

- **Plan mismatch — Husky was inert (fixed, 3d59a3e).** The plan's Current-State
  assumed "Husky already works." It did not in this checkout: no `prepare`
  script, `core.hooksPath` unset, `.git/hooks/` held only samples, so `.husky/`
  was ignored — neither the new pre-push nor the pre-existing pre-commit fired
  (a push with a failing test was NOT aborted; it reached origin until deleted).
  Adapted per user approval: added `"prepare": "husky"` and ran it once; both
  hooks now fire. Re-verified 2.6/2.7/2.8 green afterward.
- **1.9 NOT met — per-edit loop ~2.3s, over the sub-2s target.** The checks
  themselves are sub-second (vitest 3ms); the cost is three sequential `npx`
  binary resolutions (even the lint-only non-risk path is ~1.77s). Open
  follow-up: call the local bins directly (`node_modules/.bin/{prettier,eslint,vitest}`)
  instead of `npx` to cut most of the overhead. Left unchecked in plan.md.
