# Quality-Gates Wiring Implementation Plan

## Overview

Implement **test-plan §3 Phase 5 — Quality-gates wiring**: lock the floor by
turning the §5 quality gates into automatic local checks at the cheapest layer
that still gives signal, in front of CI. This is the Module 3 Lesson 3 (hooks)
work. We wire two new layers — a **per-edit agent hook** (the only layer that
feeds the agent mid-session) and a **pre-push safety net** — then reconcile the
test-plan record so it stops claiming these gates are still `planned`.

The existing pre-commit layer (Husky + `lint-staged`) already works and is left
untouched, per the lesson rule "if Husky already works, don't migrate."

## Current State Analysis

- **Pre-commit already wired.** `.husky/pre-commit` runs `npx lint-staged`;
  `package.json` `lint-staged` runs `eslint --fix` on `*.{ts,tsx,astro}` and
  `prettier --write` on `*.{json,css,md}`. Husky 9.1.7 is installed. This is the
  middle layer and needs no change.
- **No Claude Code hooks yet.** There is no project `.claude/settings.json` —
  only `.claude/settings.local.json` (permissions, git-ignored, local-only). The
  per-edit `PostToolUse` hook is greenfield. `.claude/hooks/` does not exist.
- **Typecheck exists but is not a gate.** `@astrojs/check` is installed; there is
  no `typecheck` npm script and `astro check` is not wired anywhere. CI runs
  `npx astro sync` before `npm run build`, so stale Astro types are a known
  failure mode that `astro check` shares — the script must `astro sync` first.
- **Scoped tests are feasible.** Vitest 3.2.6; suites at
  `src/lib/recommend-run.test.ts`, `src/lib/recommend/roles.test.ts`,
  `src/lib/recommend/affinity.test.ts`. `vitest related "<file>" --run` is the
  scoped, non-watch mode. `vitest.config.ts` uses `node` env + `tsconfigPaths`.
- **All five §2 risk areas exist on disk:** `src/lib/recommend`,
  `src/pages/api`, `src/pages/sessions`, `src/components/sessions`,
  `src/middleware.ts`.
- **CI** (`.github/workflows/ci.yml`) runs `lint` + `build` only. Authoring CI
  is out of scope for this lesson (Module 1/2 Lesson 5), so the "+ CI" half of
  any §5 gate is deferred; we wire the local half here.

## Desired End State

After this plan:

- Editing a file under a §2 risk area via the agent triggers, in the same turn,
  a format + lint pass on that file and a scoped `vitest related --run`; a
  failure **blocks** (exit 2) and the diagnostic is surfaced to the agent so it
  self-corrects next turn. Editing a non-risk file runs format + lint only.
- `npm run typecheck` exists and runs a clean whole-project Astro type check.
- `git push` runs typecheck + the full Vitest suite locally; either failing
  aborts the push before code leaves the machine.
- `test-plan.md` §5 shows the typecheck and post-edit-hook gates as wired, §6.5
  documents how to add/run a quality-gate hook, and §6.6 carries a Phase-5 note.

Verify: trigger each layer (edit a risk file with a deliberate lint error;
`npm run typecheck` on a clean tree; `git push` with a failing test on a
throwaway branch) and confirm each blocks with a readable message.

### Key Discoveries:

- Pre-commit is already the lint/format gate (`.husky/pre-commit:1`,
  `package.json:70-77`) — do **not** rebuild it; extend only via the new layers.
- `recommendRun` and the recommend suite live under `src/lib/` — `vitest related`
  resolves related suites through `tsconfigPaths` (`vitest.config.ts`).
- The risk-area list is fixed and small (`test-plan.md` §2 table) — a path-prefix
  match in the hook script is the §5/CLAUDE.md-prescribed gate.
- Claude Code `PostToolUse` blocking contract: **exit code 2** blocks and feeds
  **stderr** back to the agent; exit 0 continues. (The lesson's `additionalContext`
  is the JSON-stdout equivalent; exit-2-plus-stderr is the simpler, deterministic
  form used here.)

## What We're NOT Doing

- **Not** migrating Husky → Lefthook. Husky works; the lesson forbids needless
  migration. `lefthook.yml` is not created.
- **Not** changing the existing pre-commit hook or `lint-staged` config.
- **Not** adding typecheck/tests to CI (`.github/workflows/ci.yml`) — CI
  authoring is a different lesson; only the local half is wired here.
- **Not** writing new unit/integration/E2E tests — hooks only *run* the suites
  Phase 1 produced. No Playwright/MCP (Lesson 4).
- **Not** changing §5 gate *definitions* or the §2 risk strategy (Lesson 1).
  Only gate *status* and the §6.5/§6.6 cookbook records are touched.
- **Not** putting the whole-project typecheck or the full suite on the per-edit
  layer — both are too slow for the agent loop and belong at pre-push.

## Implementation Approach

Three layers, cheapest-first. The per-edit hook (Phase 1) is the highest-value,
most novel piece — it is the only layer that can hand feedback to the agent
mid-session. The pre-push hook (Phase 2) is the safety net for everything that
bypassed the agent (manual edits, teammate commits) and for the checks too slow
to run per-edit. Phase 3 makes the test-plan tell the truth about what is now
wired. Phases are independent and land in order.

## Critical Implementation Details

- **Hook stdin contract.** A Claude Code `PostToolUse` command hook receives the
  tool event as JSON on stdin; the edited path is `.tool_input.file_path`. Parse
  it with `jq -r '.tool_input.file_path // empty'` and exit 0 early if empty
  (e.g. a tool use with no path).
- **Block channel.** On failure, write the failing command's output to **stderr**
  and `exit 2` — that is what Claude Code surfaces to the agent. A `exit 0` (with
  optional stdout note) means "pass, continue." Any other non-zero is a
  non-blocking error (logged, does not interrupt).
- **Keep per-edit fast.** Lint/format on a single file is sub-second; scoped
  `vitest related --run` on a risk file is ~1-2s. The whole-project `astro check`
  and full `vitest run` are deliberately excluded from this layer — they live at
  pre-push.
- **Astro types staleness.** `astro check` fails on stale generated types, so the
  `typecheck` script runs `astro sync` first (mirrors CI's sync-before-build).

## Phase 1: Per-edit agent quality hook

### Overview

Add a project Claude Code `PostToolUse` hook (matcher `Write|Edit`) that, for
each agent file edit, formats + lints the edited file and — only when the path
is under a §2 risk area — runs the scoped Vitest suite for that file, blocking
on failure so the agent self-corrects.

### Changes Required:

#### 1. Hook script

**File**: `.claude/hooks/post-edit-quality.sh` (new; `chmod +x`)

**Intent**: Read the edited file path from the hook's stdin JSON, run
`prettier --write` + `eslint --fix` on it when it is a lint target
(`*.{ts,tsx,astro}`), then run `npx vitest related "<file>" --run` when the path
is under a §2 risk area. On any check failure, print the output to stderr and
exit 2; otherwise exit 0. Skip cleanly (exit 0) when stdin has no file path or
the file no longer exists.

**Contract**: stdin = Claude Code `PostToolUse` JSON; reads
`.tool_input.file_path`. Risk-area gate = path-prefix match against the fixed
§2 list: `src/lib/recommend`, `src/pages/api`, `src/pages/sessions`,
`src/components/sessions`, `src/middleware.ts`. Scoped tests are gated to
`*.{ts,tsx}` under those prefixes (a `.astro` edit lints but has no related
Vitest suite). Exit codes: `0` pass/skip, `2` blocking failure (message on
stderr). The non-obvious core (stdin parse + risk gate + block channel):

```bash
#!/usr/bin/env bash
set -uo pipefail
FILE=$(jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] || [ ! -f "$FILE" ] && exit 0
REL=${FILE#"$PWD"/}

# format + lint only the lint targets
case "$REL" in
  *.ts|*.tsx|*.astro)
    if ! OUT=$(npx prettier --write "$REL" && npx eslint --fix "$REL" 2>&1); then
      echo "$OUT" >&2; exit 2
    fi ;;
esac

# scoped tests only for ts/tsx under a §2 risk area
case "$REL" in
  src/lib/recommend/*|src/pages/api/*|src/pages/sessions/*|src/components/sessions/*|src/middleware.ts)
    case "$REL" in
      *.ts|*.tsx)
        if ! OUT=$(npx vitest related "$REL" --run 2>&1); then
          echo "$OUT" >&2; exit 2
        fi ;;
    esac ;;
esac
exit 0
```

#### 2. Project hook configuration

**File**: `.claude/settings.json` (new — project-shared, committed; distinct
from the local-only `settings.local.json`)

**Intent**: Register the script as a `PostToolUse` hook matching the `Write` and
`Edit` tools so it fires once per agent file edit.

**Contract**: `hooks.PostToolUse[]` with `matcher: "Write|Edit"` and a single
`{ type: "command", command: ".claude/hooks/post-edit-quality.sh" }` entry. Do
not move permissions out of `settings.local.json`; this file holds hooks only.

### Success Criteria:

#### Automated Verification:

- Hook script is executable: `test -x .claude/hooks/post-edit-quality.sh`
- `settings.json` is valid JSON: `jq empty .claude/settings.json`
- Pass path: piping a JSON stub for a clean risk file
  (`echo '{"tool_input":{"file_path":"'"$PWD"'/src/lib/recommend/roles.ts"}}' | .claude/hooks/post-edit-quality.sh; echo $?`)
  exits `0`
- Block path: the same against a file with a deliberate lint error or failing
  related test exits `2` and prints the diagnostic to stderr
- Non-risk path: a JSON stub for a non-risk `*.ts` file runs lint only (no Vitest
  invocation) and exits `0`
- `npm run lint` still passes (new script files lint clean / are ignored)

#### Manual Verification:

- In a live agent session, editing a file under `src/lib/recommend/` with a
  deliberate type/lint error causes the hook to block and the agent to see and
  fix it on the next turn
- Editing a non-risk file (e.g. a doc or `src/lib/utils.ts`) does not trigger a
  Vitest run and does not perceptibly slow the loop
- The per-edit loop stays fast (sub-2s) on a normal risk-file edit

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation from the human before
proceeding to Phase 2.

---

## Phase 2: Pre-push safety net

### Overview

Add the heavier checks too slow for per-edit — whole-project typecheck and the
full test suite — at the pre-push boundary, so anything that bypassed the agent
hook (manual edits, teammate commits) or is too slow per-edit is caught before
code leaves the machine.

### Changes Required:

#### 1. Typecheck script

**File**: `package.json` (`scripts`)

**Intent**: Add a `typecheck` script that runs a clean whole-project Astro type
check, syncing generated types first so it does not fail on staleness.

**Contract**: `"typecheck": "astro sync && astro check"`. No other script
changes.

#### 2. Pre-push hook

**File**: `.husky/pre-push` (new; Husky 9 plain-script form, `chmod +x`)

**Intent**: Run typecheck then the full Vitest suite; a non-zero from either
aborts the push.

**Contract**: a Husky 9 hook script (no deprecated `husky.sh` sourcing) invoking
`npm run typecheck` then `npm run test:run`. Ordered so the fast-failing,
cheapest check (typecheck) runs first.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` exits `0` on the current clean tree
- `npm run test:run` exits `0` (existing suites pass)
- Pre-push hook is executable: `test -x .husky/pre-push`
- Running the hook directly on a clean tree exits `0`: `.husky/pre-push`
- Injecting a type error then running `.husky/pre-push` exits non-zero before the
  test step (then revert the injected error)

#### Manual Verification:

- `git push` on a throwaway branch with a deliberately failing test is aborted
  with a readable Vitest failure
- `git push` on a clean branch completes without the hook adding more than a few
  seconds
- A normal `git commit` is unaffected (pre-commit still only runs lint-staged)

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation from the human before
proceeding to Phase 3.

---

## Phase 3: Test-plan reconciliation

### Overview

Make `test-plan.md` reflect what is now wired: flip the §5 gate statuses, fill
the §6.5 cookbook entry, and append a §6.6 Phase-5 note. Status/cookbook records
only — gate *definitions* and the §2 risk strategy are unchanged (Lesson 1's
domain). Also flip §3 Phase 5 status toward `implementing`/`complete` per the
existing reconciliation lesson.

### Changes Required:

#### 1. §5 gate status

**File**: `context/foundation/test-plan.md` (§5 Quality Gates table)

**Intent**: Update the `Required?` column for the two Phase-5 gates to show they
are now wired locally, noting CI remains deferred.

**Contract**: `typecheck (astro check)` row → reflect "wired local (pre-push);
CI deferred"; `post-edit hook (scoped tests)` row → "wired (local agent loop)".
No other rows, columns, or gate definitions change.

#### 2. §6.5 cookbook

**File**: `context/foundation/test-plan.md` (§6.5 "Adding / running a
quality-gate hook")

**Intent**: Replace the "TBD — see §3 Phase 5" stub with a short cookbook: the
three local layers (per-edit agent hook, untouched pre-commit, pre-push), where
each is configured, the risk-area gate, and the exit-2/stderr block contract.

**Contract**: prose under the existing §6.5 heading; references the real paths
(`.claude/settings.json`, `.claude/hooks/post-edit-quality.sh`, `.husky/pre-push`,
`package.json` `typecheck`). No new headings outside §6.

#### 3. §6.6 phase note + §3 status

**File**: `context/foundation/test-plan.md` (§6.6 per-phase notes; §3 Rollout
table)

**Intent**: Append a 2-3 line Phase-5 note (what shipped, the keep-Husky
decision, CI-deferred boundary) and move the §3 Phase 5 row Status off
`not started`, pointing the Change folder column at this change.

**Contract**: §6.6 note appended in the existing format; §3 Phase 5 row Status →
`implementing` (or `complete` once archived) and Change folder →
`context/changes/quality-gates-wiring/`. Status vocabulary stays the §3 literals.

### Success Criteria:

#### Automated Verification:

- §6.5 no longer contains "TBD — see §3 Phase 5":
  `! grep -q "TBD — see §3 Phase 5" context/foundation/test-plan.md` after the
  §6.5 edit (other TBD subsections may remain)
- The §3 Phase 5 row no longer reads `not started`:
  `grep -n "Quality-gates wiring" context/foundation/test-plan.md` shows an
  updated Status and the change-folder path
- Doc still lints/formats clean: `npx prettier --check context/foundation/test-plan.md`
  (or it is auto-formatted by the pre-commit hook on commit)

#### Manual Verification:

- A reader of §5 + §6.5 can tell which gates are wired, at which layer, and how
  to run/extend them
- §6.6 Phase-5 note accurately reflects the keep-Husky and CI-deferred decisions
- No §5 gate *definition* or §2 risk wording was altered — only status/records

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation from the human. This is the
final phase.

---

## Testing Strategy

### Unit Tests:

- None added — this change wires runners, it does not add test code (Lesson
  boundary). Existing suites (`src/lib/recommend*`) are the payload the hooks run.

### Integration Tests:

- The hooks themselves are verified by direct invocation (piping a stdin JSON
  stub to the script; running `.husky/pre-push` directly) rather than new test
  files.

### Manual Testing Steps:

1. Edit `src/lib/recommend/roles.ts` to introduce a lint error → confirm the
   per-edit hook blocks (exit 2) and the agent is told.
2. Edit a non-risk file → confirm lint only, no Vitest run.
3. `npm run typecheck` on a clean tree → exit 0.
4. On a throwaway branch, break a test and `git push` → push aborts with the
   Vitest failure; revert.
5. `git commit` a doc change → confirm pre-commit still runs only lint-staged.

## Performance Considerations

- Per-edit hook must stay sub-2s; that is why only single-file lint/format and
  scoped `vitest related` run there, never the whole-project typecheck or full
  suite.
- Pre-push runs `astro sync && astro check` + full `vitest run` — a few seconds,
  paid once per push, acceptable before code leaves the machine.

## Migration Notes

- No data migration. The only behavioral change for contributors is a new
  pre-push step; document it in §6.5 so a failing push is self-explanatory.

## References

- Test plan (authoritative for gates + risk areas): `context/foundation/test-plan.md` §2, §3 Phase 5, §5, §6.5
- Lesson guidance (layers, exit codes, keep-Husky rule): `CLAUDE.md` (Module 3 Lesson 3)
- Existing pre-commit layer: `.husky/pre-commit`, `package.json:70-77`
- Reconciliation lesson: `context/foundation/lessons.md` ("Reconcile test-plan.md §3 …")
- CI (out of scope here): `.github/workflows/ci.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Per-edit agent quality hook

#### Automated

- [x] 1.1 Hook script is executable (`test -x .claude/hooks/post-edit-quality.sh`) — 97bdb10
- [x] 1.2 `settings.json` is valid JSON (`jq empty .claude/settings.json`) — 97bdb10
- [x] 1.3 Pass path: clean risk-file stdin stub exits 0 — 97bdb10
- [x] 1.4 Block path: lint-error / failing-test stub exits 2 with stderr diagnostic — 97bdb10
- [x] 1.5 Non-risk path: non-risk `*.ts` stub runs lint only, exits 0 — 97bdb10
- [x] 1.6 `npm run lint` still passes — 97bdb10

#### Manual

- [ ] 1.7 Live session: error in `src/lib/recommend/` blocks and agent self-corrects
- [ ] 1.8 Non-risk edit triggers no Vitest run, no perceptible slowdown
- [ ] 1.9 Per-edit loop stays sub-2s on a normal risk-file edit

### Phase 2: Pre-push safety net

#### Automated

- [x] 2.1 `npm run typecheck` exits 0 on clean tree — 550eab7
- [x] 2.2 `npm run test:run` exits 0 — 550eab7
- [x] 2.3 Pre-push hook is executable (`test -x .husky/pre-push`) — 550eab7
- [x] 2.4 `.husky/pre-push` on clean tree exits 0 — 550eab7
- [x] 2.5 Injected type error makes `.husky/pre-push` exit non-zero before tests (then reverted) — 550eab7

#### Manual

- [ ] 2.6 `git push` with a failing test on a throwaway branch is aborted with a readable failure
- [ ] 2.7 `git push` on a clean branch adds only a few seconds
- [ ] 2.8 Normal `git commit` unaffected (pre-commit still lint-staged only)

### Phase 3: Test-plan reconciliation

#### Automated

- [x] 3.1 §6.5 no longer contains "TBD — see §3 Phase 5" — 1c3091e
- [x] 3.2 §3 Phase 5 row no longer reads `not started`; Change folder repointed — 1c3091e
- [x] 3.3 `npx prettier --check context/foundation/test-plan.md` clean — 1c3091e

#### Manual

- [ ] 3.4 §5 + §6.5 make wired gates, layers, and how-to-run clear
- [ ] 3.5 §6.6 Phase-5 note reflects keep-Husky + CI-deferred decisions
- [ ] 3.6 No §5 gate definition or §2 risk wording altered — only status/records
