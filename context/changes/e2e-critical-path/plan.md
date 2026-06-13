# E2E Critical Path — Three Picks Render End-to-End — Implementation Plan

## Overview

Stand up the project's first Playwright E2E layer and use it to cover **test-plan
Phase 4 / Risk #3**: the multi-step journey (auth → `/sessions` preferences →
submit → SSR-rendered picks) must render **three picks on screen**, not just return
an HTTP 200 or change the URL. Two phases: (1) bootstrap Playwright + auth
`storageState` + the two quality levers (seed test + E2E rules), driven by
`/10x-implement`; (2) generate and harden the one critical-path test, driven by
`/10x-e2e`.

## Current State Analysis

- The journey is **fully built** and browser-level (auth + routing + API + DB +
  SSR-on-workerd). See `research.md` for source-verified locators and flow.
- **No Playwright** exists (no `playwright.config.*`, no specs, not in
  `package.json`). `/10x-e2e` _assumes_ Playwright is installed and **stops** if
  absent — so bootstrap is prerequisite work (Phase 1), not part of `/10x-e2e`.
- Auth: `src/middleware.ts:25-29` redirects `/sessions` → `/auth/signin` when
  unauthenticated; `POST /api/auth/signup` with local `enable_confirmations = false`
  (`supabase/config.toml:209`) returns a live session and redirects to `/` already
  logged in → an auth-setup project mints a fresh user and saves the cookie jar.
- Determinism: a **note-less** submit collapses the relaxation ladder
  (`recommend-run.ts:125-147,214`) to a single genre-only TMDB query; a common
  preferred genre yields ≥3 candidates → exactly 3 picks. Real TMDB is sound here.
- No `data-testid` anywhere — role/label locators are the right default.

## Desired End State

`npm run test:e2e` brings up `astro dev` (:4321), the `setup` project signs up a
unique user and saves `playwright/.auth/user.json`, and the `chromium` project runs
`tests/e2e/critical-path-three-picks.spec.ts` green: starting authenticated at
`/sessions`, selecting one preferred genre, leaving the note empty, submitting, and
asserting **three `<article>` picks** render on `/sessions/[id]/recommendations`.
The test goes **red** when the protected behavior is deliberately broken, and the
suite passes twice in a row (isolation). Verify: `npm run test:e2e` green ×2;
`research.md`-grounded deliberate break confirmed red then reverted.

### Key Discoveries

- Core assertion: `expect(page.getByRole('article')).toHaveCount(3)` — picks are
  `<article>` cards (`PicksGrid.tsx:85`); the page shows an empty state when
  `picks.length === 0` (`recommendations.astro:43-58`), so the count genuinely
  fails if the pool drains (Risk #3's failure mode).
- Locator wrinkle: genre buttons (`GenrePicker.tsx:25-39`) are named by genre and
  appear in **two** pickers → `getByRole('button', { name: 'Action' })` is
  ambiguous. Scope to the "Preferred genres" group.
- Submit button name is exactly `Get tonight's picks`; redirect target is
  `/sessions/${id}/recommendations` (`recommend-run.ts:198`).

## What We're NOT Doing

- **No CI wiring** this change (deferred — test-plan §5 "required after Phase 4" is
  acknowledged; CI authoring + a CI-side Supabase/TMDB strategy is a separate
  lesson). Tracked as a follow-up, not a Progress phase.
- **No external-edge mocking** (TMDB/OpenRouter). That's Risk #2 / Phase 2 at the
  integration layer (MSW). Here boundaries are real by design.
- **No second E2E scenario** (e.g. auth-redirect guard) — protect the named risk,
  not surface area. The auth boundary is exercised by the setup project.
- **No teardown project** — fresh-user + unique data makes re-runs collision-free.
- **No `data-testid` added** to app components — semantic locators suffice.

## Implementation Approach

Phase 1 is plain infra/setup (`/10x-implement` — the `/10x-e2e` gate would redirect
it as non-browser work). Phase 2 is the browser-level test (`/10x-e2e`). The two
share this plan's `## Progress`, exactly the lesson's interleave
(`/10x-implement phase 1` then `/10x-e2e phase 2`). Seed test + E2E rules are the
two quality levers created once in Phase 1; the seed shapes what the generator
produces in Phase 2 ("what you show is what you get").

## Critical Implementation Details

- **storageState lands in the browser context.** The auth-setup must perform the
  signup in the same browser context it saves (`page.context().storageState({ path })`)
  so the Supabase `@supabase/ssr` cookies are captured. A unique email
  (`e2e-${Date.now()}@example.com`) avoids "user already registered" on re-runs.
- **Note must stay empty and a preferred genre must be selected.** Empty preferred
  ⇒ no discover hint (non-deterministic/empty pool); a note ⇒ the OpenRouter/AI
  path (non-deterministic, out of scope). Both would make the test flaky.
- **Local Supabase must be running** (`npm run db:start`, Docker) and `.dev.vars`
  populated, or signup/TMDB fail. This is an environment precondition for both
  phases' automated verification.

## Phase 1: Playwright bootstrap + auth + quality levers

### Overview

Install Playwright, configure it for this app (webServer + storageState), create the
auth-setup project, and lay down the seed test and E2E rules levers.

### Changes Required:

#### 1. Dependencies & scripts

**File**: `package.json`

**Intent**: Add Playwright as a dev dependency and a single entry point to run the
e2e suite (and a single spec for the skill's VERIFY step).

**Contract**: `devDependencies` gains `@playwright/test`; `scripts` gains
`"test:e2e": "playwright test"`. Browser binary via `npx playwright install chromium`.
Optionally add `@playwright/cli` for the browser-driven PLAN step. Pre-push/lint
config unchanged.

#### 2. Playwright config

**File**: `playwright.config.ts` (new)

**Intent**: Point Playwright at the local app, auto-start it, and make every test
project start authenticated via saved session state.

**Contract**: `testDir: 'tests/e2e'`; `use.baseURL: 'http://localhost:4321'`;
`webServer: { command: 'npm run dev', url: 'http://localhost:4321', reuseExistingServer: !process.env.CI }`;
`projects`: a `setup` project (`testMatch: /auth\.setup\.ts/`) and a `chromium`
project with `use: { storageState: 'playwright/.auth/user.json' }` and
`dependencies: ['setup']`.

#### 3. Auth setup project

**File**: `tests/e2e/auth.setup.ts` (new)

**Intent**: Mint a fresh logged-in user once and persist the session so all tests
skip the login UI (login is not a per-test dependency).

**Contract**: A `setup('authenticate', …)` that signs up `e2e-${Date.now()}@example.com`
via the signup form (or `page.request.post('/api/auth/signup', …)`), waits for the
post-signup logged-in state (redirect to `/`), then
`page.context().storageState({ path: 'playwright/.auth/user.json' })`.

#### 4. Ignore auth artifacts & reports

**File**: `.gitignore`

**Intent**: Keep the session file and Playwright outputs out of git.

**Contract**: add `playwright/.auth/`, `test-results/`, `playwright-report/`.

#### 5. Seed test lever

**File**: `tests/e2e/seed.spec.ts` (new)

**Intent**: The exemplar every generated test is modeled on, demonstrating the four
patterns on a real flow from this app.

**Contract**: One `test('…')` with a risk-tied name, using `getByRole`/`getByLabel`
locators, waiting on state (`page.waitForURL('**/recommendations')` /
`toBeVisible()`), unique data (`Date.now()`), and the solo `/sessions`→picks flow.
Source pattern: `.claude/skills/10x-e2e/references/seed-test-pattern.md`, adapted to
real routes/roles (Mood/Intensity labels, Preferred-genre button, `Get tonight's
picks`, `getByRole('article')`).

#### 6. E2E rules lever

**File**: `tests/e2e/e2e-quality-rules.md` (new)

**Intent**: The rules file `/10x-e2e` reads before generating, encoding locator
hierarchy, no `waitForTimeout`, isolation, storageState auth, and data isolation.

**Contract**: Created from `.claude/skills/10x-e2e/references/e2e-quality-rules.md`,
tuned to this project's conventions (test dir, role/label-first since no testids).

### Success Criteria:

#### Automated Verification:

- `npx playwright install chromium` completes and `npx playwright --version` works.
- `npm run test:e2e -- seed.spec.ts` runs the `setup` + seed green (local Supabase up).
- Running the seed twice consecutively stays green (no collision).
- `npm run typecheck` and `npm run lint` pass with the new TS files.

#### Manual Verification:

- `playwright/.auth/user.json` is created and a fresh `chromium` project run starts
  already authenticated (reaches `/sessions` without the signin redirect).
- `.gitignore` keeps `playwright/.auth/` and reports untracked (`git status` clean of them).

**Implementation Note**: After Phase 1 automated verification passes, pause for human
confirmation before Phase 2.

---

## Phase 2: Critical-path E2E test for Risk #3

### Overview

Generate and harden the single browser-level test proving three picks render
end-to-end, then verify it fails when the protected behavior is broken.

### Changes Required:

#### 1. Critical-path spec

**File**: `tests/e2e/critical-path-three-picks.spec.ts` (new)

**Intent**: Drive the real journey authenticated and assert three picks render — the
risk-tied proof a unit/integration test can't give.

**Contract**: `test('three picks render end-to-end for a solo session', …)`:
start authenticated (storageState) → `page.goto('/sessions')` → select **one**
preferred genre (scoped to the "Preferred genres" group) → leave **Note** empty →
click `Get tonight's picks` → `page.waitForURL('**/sessions/*/recommendations')` →
`await expect(page.getByRole('article')).toHaveCount(3)` plus role-badge visibility
(`Safe pick`, one of `Compromise|Crowd-pleaser`, `Wild card`) and three level-2
headings. Unique data; no `waitForTimeout`; reviewed against the five anti-patterns.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e -- critical-path-three-picks.spec.ts` passes against the running app.
- **Deliberate break**: temporarily weaken the protected behavior (e.g. `PicksGrid`
  renders `sorted.slice(0, 1)`, or cap `result.picks` in `recommend-run.ts`) → the
  test goes **red**; revert immediately (never committed).
- Full e2e suite runs **twice** consecutively, all green (isolation).

#### Manual Verification:

- The recommendations page visibly shows three distinct picks with role badges.
- The deliberate-break red was observed and reverted before any commit.

**Implementation Note**: Commit only on green, after the deliberate break is reverted.

---

## Testing Strategy

### Manual Testing Steps:

1. `npm run db:start`; ensure `.dev.vars` has Supabase + TMDB values.
2. `npm run test:e2e` → setup + critical-path spec green.
3. Re-run immediately → still green (isolation).
4. Apply the deliberate break, re-run the single spec, confirm red, revert.

## References

- Research: `context/changes/e2e-critical-path/research.md`
- Lesson + skill: `docs/10x/quality_maintenance/testy-e2e-playwright-mcp-i-multimodalne-scenariusze.md`,
  `.claude/skills/10x-e2e/` (`references/seed-test-pattern.md`,
  `references/e2e-quality-rules.md`, `references/e2e-anti-patterns.md`).
- Test plan: `context/foundation/test-plan.md` §2 R3, §3 Phase 4, §6.4.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Playwright bootstrap + auth + quality levers

#### Automated

- [x] 1.1 Playwright installed; `npx playwright --version` works
- [x] 1.2 `npm run test:e2e -- seed.spec.ts` runs setup + seed green
- [x] 1.3 Seed runs twice consecutively, still green
- [x] 1.4 `npm run typecheck` and `npm run lint` pass with new files

#### Manual

- [x] 1.5 `playwright/.auth/user.json` created; chromium project starts authenticated
- [x] 1.6 `.gitignore` keeps auth state + reports untracked

### Phase 2: Critical-path E2E test for Risk #3

#### Automated

- [ ] 2.1 `critical-path-three-picks.spec.ts` passes against the running app
- [ ] 2.2 Deliberate break makes the test red; reverted, never committed
- [ ] 2.3 Full e2e suite runs twice consecutively, all green

#### Manual

- [ ] 2.4 Recommendations page visibly shows three picks with role badges
- [ ] 2.5 Deliberate-break red observed and reverted before commit
