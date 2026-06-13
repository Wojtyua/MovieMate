# Quality-Gates Wiring — Plan Brief

> Full plan: `context/changes/quality-gates-wiring/plan.md`

## What & Why

Implement test-plan §3 Phase 5 — turn the §5 quality gates into automatic local
checks at the cheapest layer that still gives signal, in front of CI (Module 3
Lesson 3, hooks). The payoff: a per-edit hook hands failures back to the agent
mid-session so it self-corrects, and a pre-push net catches what bypassed it.

## Starting Point

Pre-commit (Husky 9.1.7 + `lint-staged`) already lints/formats staged files and
stays as-is. There are no Claude Code hooks yet (no project `.claude/settings.json`),
`astro check` is installed but not wired or scripted, and Vitest 3.2.6 with three
suites supports scoped `vitest related --run`. CI runs lint + build only.

## Desired End State

Editing a §2 risk-area file via the agent formats + lints it and runs its scoped
suite, blocking on failure; non-risk edits lint only. `npm run typecheck` exists,
and `git push` runs typecheck + the full suite locally before code leaves the
machine. The test-plan reflects these gates as wired.

## Key Decisions Made

| Decision              | Choice                                | Why (1 sentence)                                            | Source |
| --------------------- | ------------------------------------- | ----------------------------------------------------------- | ------ |
| Per-edit hook scope   | Lint/format + risk-gated scoped tests | §5 recommends scoped tests; only layer that feeds the agent | Plan   |
| Typecheck layer       | Pre-push (not pre-commit)             | Whole-project check; keeps commits fast                     | Plan   |
| Full test suite layer | Pre-push full `vitest run`            | Single safety net for edits that bypassed the agent hook    | Plan   |
| Risk-area gate        | Path-prefix match on §2 risk dirs     | Deterministic, matches "don't test every helper" rule       | Plan   |
| Hook failure signal   | Block (exit 2) + stderr to agent      | Core Lesson 3 payoff — agent self-corrects trivial errors   | Plan   |
| Git hook tool         | Keep Husky, add pre-push              | Husky works; lesson forbids needless Lefthook migration     | Plan   |
| Test-plan record      | Flip §5 status + fill §6.5/§6.6       | Keep the doc from lying after gates ship                    | Plan   |

## Scope

**In scope:** per-edit `PostToolUse` hook (`.claude/settings.json` + script),
`typecheck` npm script, `.husky/pre-push`, test-plan §5/§6.5/§6.6 + §3 status.

**Out of scope:** Husky→Lefthook migration, pre-commit/lint-staged changes, CI
typecheck (deferred), new tests, E2E/Playwright, §5 gate definitions or §2 risk
strategy.

## Architecture / Approach

Three cheapest-first local layers in front of CI: **per-edit** (Claude Code
`PostToolUse` `Write|Edit` → format+lint the file, scoped `vitest related` when
under a §2 risk dir, exit 2 to block) → **pre-commit** (existing Husky lint-staged,
untouched) → **pre-push** (Husky hook: `astro sync && astro check` + full
`vitest run`). The per-edit script parses `.tool_input.file_path` from stdin JSON.

## Phases at a Glance

| Phase                       | What it delivers                                                           | Key risk                                                        |
| --------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Per-edit agent hook      | `.claude/settings.json` + script: lint/format + scoped tests, exit-2 block | Exit-code/stderr block contract must match Claude Code behavior |
| 2. Pre-push safety net      | `typecheck` script + `.husky/pre-push` (typecheck + full suite)            | `astro check` staleness — script must `astro sync` first        |
| 3. Test-plan reconciliation | §5 status, §6.5 cookbook, §6.6 note, §3 status                             | Touch only status/records, not gate definitions (Lesson 1)      |

**Prerequisites:** Husky installed (yes), Vitest suites present (yes), risk dirs exist (yes).
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- Claude Code `PostToolUse` blocks on exit 2 and surfaces stderr to the agent —
  verify in a live session (Phase 1 manual step) since it's the load-bearing contract.
- `vitest related` on a risk file resolves its suite via `tsconfigPaths`; a file
  with no related suite no-ops harmlessly.
- `astro check` runtime stays within a few seconds at pre-push.

## Success Criteria (Summary)

- Agent editing a risk file with an error is blocked mid-session and fixes it next turn.
- `git push` aborts on a failing test or type error before reaching remote.
- §5/§6.5 of the test-plan accurately describe the wired gates and how to run them.
