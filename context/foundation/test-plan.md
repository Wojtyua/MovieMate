# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-08

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   operator is worried about X, and the failure would surface somewhere in
   `<area>`" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding docs,
archive, build output, fixtures).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|-------------------------|--------|------------|--------------------------------|
| 1 | Operator submits a session and receives **fewer than three picks (or zero)** even with healthy dependencies — internal pipeline (filters / relaxation / dedup / scoring) drains the pool | High | High | interview Q1; PRD Guardrails "at most / always three picks"; hot-spot dir `src/pages/api` (15 commits/30d), `src/lib/recommend` (7) |
| 2 | **TMDB or OpenRouter fails or times out** and, instead of degrading to genre-only retrieval (still three picks within < 10 s), the request errors out | High | Medium-High | interview Q2; PRD Guardrails "graceful degradation"; PRD FR-006, FR-007 |
| 3 | **Regression in the multi-step journey** home → login → session → preferences → (optional second viewer) → three picks breaks the end-to-end flow | High | High | interview Q3; PRD US-01; hot-spot dir `src/pages/sessions` + `src/components/sessions` (5), files `sessions.astro` (4), `SessionForm.tsx` (3) |
| 4 | **Own-data leak (IDOR)**: a logged-in user A reaches user B's sessions / recommendations / taste core by swapping an identifier | High | Medium | PRD FR-001 + Guardrail "own-data isolation preserved"; abuse lens; hot-spot dir `src/pages/api` (15), file `src/middleware.ts` (4) |
| 5 | **Scoring engine returns a malformed pick set** on the solo↔duo branch: wrong role (CHECK rejects, or solo gets "compromise"), duplicate picks, or wild card not differing in genre from safe | Medium-High | Medium | PRD FR-008, FR-009 + roadmap S-03 duo branch + Open Question "solo role labels"; hot-spot dir `src/lib/recommend` (7) |

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row.

| Rating | Impact | Likelihood |
|--------|--------|------------|
| High   | user loses access, data, or money; failure is publicly visible | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs |
| Low    | cosmetic, easily reverted, no data effect | stable code, rarely touched |

**Abuse / security lens.** The product has email/password auth and accepts
user input (session form, free-text note), so the map carries one mandatory
abuse row — R4 (IDOR / ownership check). The happy path excludes the
attacker, so this rarely surfaces from the interview. The `< 10 s` budget
breach is deliberately **not** a test row: it is a High-impact ×
Low-likelihood / observability concern, and it only sits on the critical
path once S-04 (note analysis before retrieval) lands — handle it with
timing/alerting, not a unit test.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | With healthy mocked dependencies the pipeline **always returns exactly three** picks across typical and boundary inputs (thin pool, all-excluded genres) | "the pool can never drop below three" — verify the relaxation / dedup logic | endpoint entry, retrieval boundary, dedup + relaxation rule | integration (endpoint / pipeline) | happy-path-only; mocking internal modules |
| #2 | A failing / timing-out dependency yields a **clean fallback to genre-only** retrieval, still three picks, no 500 | "200 means success" — the fallback may silently return < 3 | network edge (TMDB / OpenRouter), timeout + error path | integration + network-edge mock (MSW) | over-mocking; never exercising the error path itself |
| #3 | A real journey renders **three picks on screen**, not just an HTTP 200 / a URL change | "green e2e means the flow works" | page entry points, auth / session shape, SSR on workerd | e2e (Playwright) — no cheaper layer covers cross-page | asserting only status / URL; brittle selectors |
| #4 | User B **cannot see** user A's data (403 / empty), not merely "is authenticated" | "logged in means authorized" | RLS / owner-scope shape, id passed in URL / endpoint | integration (two users) | testing only the happy path of one's own data |
| #5 | Roles branch on taste cardinality; **wild card genre ≠ safe genre**; ≤ 3; solo omits "compromise" | the oracle comes from PRD rules, **not** from the implementation | role rules, `role` CHECK values, scoring input shape | unit (deterministic) | **oracle problem** — asserting exact float score values (negative space, §7) |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Bootstrap + "always three picks" core | Stand up Vitest; defend R1 + R5 at the cheapest layer | #1, #5 | unit + integration | change opened | context/changes/testing-always-three-picks-core/ |
| 2 | Graceful degradation at the external edge | TMDB / OpenRouter failure → genre-only fallback, still three picks | #2 | integration + network mock (MSW) | not started | — |
| 3 | Own-data isolation | User B cannot reach user A's data (IDOR / RLS) | #4 | integration (two users) | not started | — |
| 4 | E2E critical path | home → three picks end-to-end | #3 | e2e (Playwright) | not started | — |
| 5 | Quality-gates wiring | Lock the floor: lint + typecheck + scoped-test hooks and pre-commit | cross-cutting | gates / hooks | not started | — |

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|-------|---------|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

Module-3 lesson mapping: Phases 1–3 are Lesson 2 (unit/integration with an
agent); Phase 4 is Lesson 4 (e2e / Playwright + MCP); Phase 5 is Lesson 3
(hooks and triggers). Lesson 5 (debugging from a stack trace) is a workflow
triggered by a real bug, not a rollout phase.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | none yet — see §3 Phase 1 | Vite 7 is already pinned (`overrides`), so Vitest 3.x fits; bootstrapped in Phase 1 |
| API mocking | MSW | none yet — see §3 Phase 2 | Mock only the network edge (TMDB / OpenRouter) |
| e2e | Playwright | none yet — see §3 Phase 4 | App runs on Cloudflare workerd; `astro dev` is real workerd locally |
| database | pgTAP (Supabase) | present | `supabase/tests/`, run via `npm run db:verify` — existing RLS-level coverage |
| lint / format | ESLint + Prettier | present | `npm run lint`; husky pre-commit runs lint-staged |
| typecheck | `astro check` | present | `@astrojs/check` installed; not yet a standalone gate |

**Stack grounding tools (current session):**
- Docs: none — Context7 / framework docs MCP not available in current session; checked: 2026-06-08
- Search: WebSearch — available, not yet used; will ground Vitest/MSW/Playwright setup versions during the relevant rollout phase; checked: 2026-06-08
- Runtime/browser: none — Playwright MCP not in current session; arrives with §3 Phase 4 (Lesson 4); checked: 2026-06-08
- Provider/platform: none — Supabase / Cloudflare MCP not in current session; relevant later for log inspection and CI gates; checked: 2026-06-08

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint | local + CI | required (wired) | syntactic drift, stray `console.*` |
| typecheck (`astro check`) | local + CI | required after §3 Phase 5 | type drift |
| pre-commit (lint-staged) | local (husky) | required (wired) | unformatted / unlinted staged files |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions, lost fallback, malformed pick set |
| pgTAP RLS tests | local + CI | required (wired) | broken owner-scoped policies at the DB layer |
| e2e on critical flow | CI on PR | required after §3 Phase 4 | broken home → three-picks journey |
| post-edit hook (scoped tests) | local (agent loop) | recommended after §3 Phase 5 | regressions at edit time |
| pre-prod smoke | between merge + prod | optional | workerd-specific failures |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (deterministic scoring / role-assignment rules: cardinality branch, wild-card genre ≠ safe, ≤ 3; oracle from PRD, never from the implementation).

### 6.2 Adding an integration test (recommendations pipeline)

- TBD — see §3 Phase 1 ("always three picks" with healthy mocks) and §3 Phase 2 (graceful degradation; mock only the network edge with MSW, never internal modules).

### 6.3 Adding an own-data / authorization test

- TBD — see §3 Phase 3 (two-user IDOR check: user B must not reach user A's sessions / recommendations / taste core).

### 6.4 Adding an e2e test

- TBD — see §3 Phase 4 (home → three picks; assert three picks render, not just status / URL; app on workerd).

### 6.5 Adding / running a quality-gate hook

- TBD — see §3 Phase 5 (lint + typecheck + scoped-test hooks; pre-commit).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Exact scoring values to two decimal places** — what matters is pick
  ordering and role assignment, not the precise floats; asserting exact
  score numbers reproduces the implementation (oracle problem) and locks in
  current bugs. Test relative ordering, role correctness, and the ≤ 3 /
  wild-card-genre invariants instead. Re-evaluate if scoring becomes a
  user-visible number. (Source: Phase 2 interview Q5.)
- **shadcn `src/components/ui` primitives** — vendored library code, not our
  logic; re-evaluate only if we fork a component's behavior. (Source: scope
  discipline; confirm at first UI-test phase.)
- **Static / marketing page snapshots** — brittle, low signal. (Source:
  scope discipline.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-08
- Stack versions last verified: 2026-06-08
- AI-native tool references last verified: 2026-06-08

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (e.g. S-04 puts note
  analysis and the < 10 s budget on the critical path, or S-05 adds the
  watched-dedup filter),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
