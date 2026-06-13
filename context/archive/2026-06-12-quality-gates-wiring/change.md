---
change_id: quality-gates-wiring
title: Quality gates wiring
status: archived
created: 2026-06-12
updated: 2026-06-13
archived_at: 2026-06-13T10:21:49Z
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
- **1.9 met after optimization.** Initially ~2.3s (over the sub-2s target): the
  cost was three sequential `npx` binary resolutions, not the checks (vitest 3ms).
  Fixed by calling the project-local bins directly
  (`node_modules/.bin/{prettier,eslint,vitest}`, `npx` fallback for fresh clones):
  risk-file loop now ~1.93s, non-risk ~1.5s. Residual cost is ESLint's type-aware
  program load (~1s), inherent to the lint config — not the hook.
