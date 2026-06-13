# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-12

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   operator is worried about X, and the failure would surface somewhere in
   `<area>`" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding docs,
archive, build output, fixtures).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                       | Impact      | Likelihood  | Source (evidence — not anchor)                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Operator submits a session and receives **fewer than three picks (or zero)** even with healthy dependencies — internal pipeline (filters / relaxation / dedup / scoring) drains the pool      | High        | High        | interview Q1; PRD Guardrails "at most / always three picks"; hot-spot dir `src/pages/api` (15 commits/30d), `src/lib/recommend` (7)           |
| 2   | **TMDB or OpenRouter fails or times out** and, instead of degrading to genre-only retrieval (still three picks within < 10 s), the request errors out                                         | High        | Medium-High | interview Q2; PRD Guardrails "graceful degradation"; PRD FR-006, FR-007                                                                       |
| 3   | **Regression in the multi-step journey** home → login → session → preferences → (optional second viewer) → three picks breaks the end-to-end flow                                             | High        | High        | interview Q3; PRD US-01; hot-spot dir `src/pages/sessions` + `src/components/sessions` (5), files `sessions.astro` (4), `SessionForm.tsx` (3) |
| 4   | **Own-data leak (IDOR)**: a logged-in user A reaches user B's sessions / recommendations / taste core by swapping an identifier                                                               | High        | Medium      | PRD FR-001 + Guardrail "own-data isolation preserved"; abuse lens; hot-spot dir `src/pages/api` (15), file `src/middleware.ts` (4)            |
| 5   | **Scoring engine returns a malformed pick set** on the solo↔duo branch: wrong role (CHECK rejects, or solo gets "compromise"), duplicate picks, or wild card not differing in genre from safe | Medium-High | Medium      | PRD FR-008, FR-009 + roadmap S-03 duo branch + Open Question "solo role labels"; hot-spot dir `src/lib/recommend` (7)                         |

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row.

| Rating | Impact                                                          | Likelihood                                               |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| High   | user loses access, data, or money; failure is publicly visible  | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs          |
| Low    | cosmetic, easily reverted, no data effect                       | stable code, rarely touched                              |

**Abuse / security lens.** The product has email/password auth and accepts
user input (session form, free-text note), so the map carries one mandatory
abuse row — R4 (IDOR / ownership check). The happy path excludes the
attacker, so this rarely surfaces from the interview. The `< 10 s` budget
breach is deliberately **not** a test row: it is a High-impact ×
Low-likelihood / observability concern, and it only sits on the critical
path once S-04 (note analysis before retrieval) lands — handle it with
timing/alerting, not a unit test.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                              | Must challenge                                                              | Context `/10x-research` must ground                         | Likely cheapest layer                                 | Anti-pattern to avoid                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| #1   | With healthy mocked dependencies the pipeline **always returns exactly three** picks across typical and boundary inputs (thin pool, all-excluded genres) | "the pool can never drop below three" — verify the relaxation / dedup logic | endpoint entry, retrieval boundary, dedup + relaxation rule | integration (endpoint / pipeline)                     | happy-path-only; mocking internal modules                                    |
| #2   | A failing / timing-out dependency yields a **clean fallback to genre-only** retrieval, still three picks, no 500                                         | "200 means success" — the fallback may silently return < 3                  | network edge (TMDB / OpenRouter), timeout + error path      | integration + network-edge mock (MSW)                 | over-mocking; never exercising the error path itself                         |
| #3   | A real journey renders **three picks on screen**, not just an HTTP 200 / a URL change                                                                    | "green e2e means the flow works"                                            | page entry points, auth / session shape, SSR on workerd     | e2e (Playwright) — no cheaper layer covers cross-page | asserting only status / URL; brittle selectors                               |
| #4   | User B **cannot see** user A's data (403 / empty), not merely "is authenticated"                                                                         | "logged in means authorized"                                                | RLS / owner-scope shape, id passed in URL / endpoint        | integration (two users)                               | testing only the happy path of one's own data                                |
| #5   | Roles branch on taste cardinality; **wild card genre ≠ safe genre**; ≤ 3; solo omits "compromise"                                                        | the oracle comes from PRD rules, **not** from the implementation            | role rules, `role` CHECK values, scoring input shape        | unit (deterministic)                                  | **oracle problem** — asserting exact float score values (negative space, §7) |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                | Goal (one line)                                                     | Risks covered | Test types                       | Status      | Change folder                                               |
| --- | ----------------------------------------- | ------------------------------------------------------------------- | ------------- | -------------------------------- | ----------- | ----------------------------------------------------------- |
| 1   | Bootstrap + "always three picks" core     | Stand up Vitest; defend R1 + R5 at the cheapest layer               | #1, #5        | unit + integration               | complete    | context/archive/2026-06-12-testing-always-three-picks-core/ |
| 2   | Graceful degradation at the external edge | TMDB / OpenRouter failure → genre-only fallback, still three picks  | #2            | integration + network mock (MSW) | not started | —                                                           |
| 3   | Own-data isolation                        | User B cannot reach user A's data (IDOR / RLS)                      | #4            | integration (two users)          | not started | —                                                           |
| 4   | E2E critical path                         | home → three picks end-to-end                                       | #3            | e2e (Playwright)                 | not started | —                                                           |
| 5   | Quality-gates wiring                      | Lock the floor: lint + typecheck + scoped-test hooks and pre-commit | cross-cutting | gates / hooks                    | complete    | context/archive/2026-06-12-quality-gates-wiring/            |

**Status vocabulary** (fixed — parser literals):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress section has at least one `[x]` and at least one `[ ]`.     |
| `complete`      | Progress section is fully `[x]`.                                    |

Module-3 lesson mapping: Phases 1–3 are Lesson 2 (unit/integration with an
agent); Phase 4 is Lesson 4 (e2e / Playwright + MCP); Phase 5 is Lesson 3
(hooks and triggers). Lesson 5 (debugging from a stack trace) is a workflow
triggered by a real bug, not a rollout phase.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer              | Tool              | Version                   | Notes                                                                                                  |
| ------------------ | ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| unit + integration | Vitest            | 3.2.6                     | Vite 7 pinned (`overrides`); bootstrapped in Phase 1 (`vitest.config.ts`, `npm run test` / `test:run`) |
| API mocking        | MSW               | none yet — see §3 Phase 2 | Mock only the network edge (TMDB / OpenRouter)                                                         |
| e2e                | Playwright        | none yet — see §3 Phase 4 | App runs on Cloudflare workerd; `astro dev` is real workerd locally                                    |
| database           | pgTAP (Supabase)  | present                   | `supabase/tests/`, run via `npm run db:verify` — existing RLS-level coverage                           |
| lint / format      | ESLint + Prettier | present                   | `npm run lint`; husky pre-commit runs lint-staged (Husky activated via `prepare` script, Phase 5)      |
| typecheck          | `astro check`     | present                   | `npm run typecheck` (`astro sync && astro check`); wired as a pre-push gate (Phase 5)                  |

**Stack grounding tools (current session):**

- Docs: none — Context7 / framework docs MCP not available in current session; checked: 2026-06-08
- Search: WebSearch — available, not yet used; will ground Vitest/MSW/Playwright setup versions during the relevant rollout phase; checked: 2026-06-08
- Runtime/browser: none — Playwright MCP not in current session; arrives with §3 Phase 4 (Lesson 4); checked: 2026-06-08
- Provider/platform: none — Supabase / Cloudflare MCP not in current session; relevant later for log inspection and CI gates; checked: 2026-06-08

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                          | Where                | Required?                           | Catches                                              |
| ----------------------------- | -------------------- | ----------------------------------- | ---------------------------------------------------- |
| lint                          | local + CI           | required (wired)                    | syntactic drift, stray `console.*`                   |
| typecheck (`astro check`)     | local + CI           | wired local (pre-push); CI deferred | type drift                                           |
| pre-commit (lint-staged)      | local (husky)        | required (wired)                    | unformatted / unlinted staged files                  |
| unit + integration            | local + CI           | required after §3 Phase 1           | logic regressions, lost fallback, malformed pick set |
| pgTAP RLS tests               | local + CI           | required (wired)                    | broken owner-scoped policies at the DB layer         |
| e2e on critical flow          | CI on PR             | required after §3 Phase 4           | broken home → three-picks journey                    |
| post-edit hook (scoped tests) | local (agent loop)   | wired (local agent loop)            | regressions at edit time                             |
| pre-prod smoke                | between merge + prod | optional                            | workerd-specific failures                            |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

Worked example: `src/lib/recommend/roles.test.ts` + `src/lib/recommend/__fixtures__/movies.ts` (Phase 1).

- **Build fixtures with a `makeMovie(partial)` factory** that returns a fully-populated `TmdbMovie` with neutral defaults, overriding only the fields the test cares about (`genre_ids`, `vote_average`, `vote_count`, `popularity`). Keep each named pool a small function returning a fresh array.
- **Force the outcome by construction, never by asserting a float score** (§7). Order the pool so the intended winner is unambiguous: give the safe candidate the strongest preferred-genre match + top quality/popularity, the middle candidate the next popularity, and the wild card a genre-disjoint set. Zero out the session signal where it would muddy reasoning (`mood: null`, `intensity: "medium"`). Assert role labels, distinct ids, ≤ 3, and wild-card-genre-disjointness — never `pick.score`.
- **Parameterize per invariant, not per case.** Use `it.each` over `{solo, duo}` for each shape invariant (≤ 3, distinct ids, role vocabulary, wild-card genre ≠ safe) so one test pins one property across both cardinalities; reserve discrete tests for the named edges (solo-never-`compromise`, Jaccard fallback, `min(N,3)` for 2/1/0, dedup). A `requirePick` helper that throws keeps assertions free of non-null `!` (lint forbids it).
- **Oracle from the PRD/research, never from the implementation.** The expected role-by-cardinality and "wild card differs in genre" come from FR-009 / research.md, not from reading `roles.ts`.

### 6.2 Adding an integration test (recommendations pipeline)

Worked example: `src/lib/recommend-run.test.ts` + `src/lib/__fixtures__/recommend-run-doubles.ts` (Phase 1, "always three picks" with healthy doubles). Graceful-degradation + MSW recipes still pending — see §3 Phase 2.

- **Stub the network EDGE, never an internal module.** `recommendRun` builds its own TMDB client (`createTmdbClient()`) and makes its own Supabase calls — it does not take a stub arg for them. So the honest seam is global `fetch` + the env token + a fake `SupabaseClient`. Do not mock `@/lib/recommend*`.
- **`fetch` stub keyed on the `page` query param.** `vi.stubGlobal("fetch", fn)` where `fn` parses the request URL, reads `page`, and returns an `ok: true` Response whose `.json()` yields `{ results }` varying per page — that makes dedup-across-pages meaningful. The raw items only need the fields `normalizeMovie` reads (id, title, genre_ids, vote_average, vote_count, popularity). `vi.unstubAllGlobals()` in `afterEach`.
- **`astro:env/server` token shim, scoped to the file.** `vi.mock("astro:env/server", () => ({ TMDB_READ_ACCESS_TOKEN: "test-token", … }))` at the top (hoisted). Without a truthy token `createTmdbClient()` returns `null` and `recommendRun` short-circuits before the ladder. Export the other names that module owns too (ai.ts reads `OPENROUTER_API_KEY`/`AI_MODEL` at load). Keep this in the integration file only so the unit suite stays infra-free.
- **Hand-rolled fake `SupabaseClient`** covering exactly the three calls: `from("watched").select(…).eq(…)` → `{ data }`; `from("recommendations").insert(…).select("id").single()` → `{ data: { id } }`; `from("recommendation_picks").insert(rows)` → `{ error }` (capture `rows` for assertions). Cast with `as unknown as Parameters<typeof recommendRun>[0]`.
- **Assert supply, not scores:** persisted pick count + distinct `tmdb_movie_id` + valid roles, watched-id absence, and the two faces of R1 (2 films → `ok:true` 2 picks; 0 → `ok:false`).

### 6.3 Adding an own-data / authorization test

- TBD — see §3 Phase 3 (two-user IDOR check: user B must not reach user A's sessions / recommendations / taste core).

### 6.4 Adding an e2e test

- TBD — see §3 Phase 4 (home → three picks; assert three picks render, not just status / URL; app on workerd).

### 6.5 Adding / running a quality-gate hook

Three local layers sit in front of CI, cheapest-first. Each gate runs at the
cheapest layer that still gives signal.

- **Per-edit agent hook** (`.claude/settings.json` → `PostToolUse` matcher
  `Write|Edit`, runs `.claude/hooks/post-edit-quality.sh`). The only layer that
  feeds the agent mid-session. For each agent file edit it runs
  `prettier --write` + `eslint --fix` on the edited file, and — only when the
  path is under a §2 risk area (`src/lib/recommend`, `src/pages/api`,
  `src/pages/sessions`, `src/components/sessions`, `src/middleware.ts`) and is a
  `.ts`/`.tsx` file — runs the scoped suite `npx vitest related "<file>" --run`.
  A non-risk edit lints/formats only. To extend: add a path-prefix arm in the
  script's risk-area `case`, or a new check before the final `exit 0`.
- **Pre-commit** (`.husky/pre-commit` → `npx lint-staged`, config in
  `package.json`). Unchanged — `eslint --fix` on `*.{ts,tsx,astro}`,
  `prettier --write` on `*.{json,css,md}` over staged files. Per the lesson rule
  we did **not** migrate to Lefthook. **Activation:** Husky 9 only fires its
  hooks once `core.hooksPath` points at `.husky/` — set by running `husky`. A
  `prepare` script (`"prepare": "husky"`) runs that automatically on every
  `npm install`, so a fresh clone gets working hooks; without it `.husky/` is
  inert and **no** hook (pre-commit or pre-push) runs.
- **Pre-push** (`.husky/pre-push`). The heavier checks too slow for per-edit:
  `npm run typecheck` (`astro sync && astro check`, whole project) then
  `npm run test:run` (full Vitest suite). Either failing aborts the push before
  code leaves the machine; typecheck runs first so the cheapest check fails fast.

**Block contract.** The per-edit hook signals via exit code: `0` = pass/skip
(continue), `2` = blocking failure with the failing command's output on **stderr**
— that is what Claude Code surfaces to the agent so it self-corrects next turn.
Any other non-zero is a non-blocking (logged) error. To run a layer manually:
pipe a `{"tool_input":{"file_path":"<abs path>"}}` JSON stub to the hook script,
run `npm run typecheck` / `npm run test:run`, or invoke `.husky/pre-push`
directly. CI (`.github/workflows/ci.yml`) stays the authoritative gate for shared
state; these local layers cut CI round-trips, not replace it. The "+ CI" half of
the typecheck / test gates is deferred (CI authoring is a separate lesson).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

**Phase 1 — bootstrap + "always three picks" core (R1 + R5).** "Always three" is
not one invariant: it splits into a pure _shape_ layer (`recommend()`: ≤3,
distinct, role-by-cardinality, wild-card genre ≠ safe, but `min(N,3)` — never
fabricates a third) and a retrieval _supply_ layer (the ladder widens the pool
toward ≥3). The two faces of R1 — a healthy ≥3 pool drained (defect) vs a
genuinely thin universe (physics) — are tested separately. The supply seam is
**`fetch` + env token + a fake Supabase**, not an injected stub, because
`recommendRun` builds its own TMDB client. Multi-rung relaxation _progression_
needs a note → the AI path → **deferred to Phase 2**; the no-note path collapses
the ladder to one genre-only rung. Selective mutation gate (ad hoc, not CI):
`npx stryker run --mutate "src/lib/recommend/roles.ts"` after this phase, then
kill only survived mutants that would hurt a user (per CLAUDE.md guidance).

**Phase 5 — quality-gates wiring (cross-cutting).** Shipped two new local layers
in front of CI: a per-edit Claude Code `PostToolUse` agent hook
(`.claude/hooks/post-edit-quality.sh`, format + lint + scoped `vitest related` on
§2 risk-area edits, exit-2/stderr block channel) and a `.husky/pre-push` net
(`npm run typecheck` = `astro sync && astro check`, then full `npm run test:run`).
Kept Husky pre-commit untouched — it already runs `lint-staged`, and the lesson
rule forbids a needless Lefthook migration. The "+ CI" half of the typecheck/test
gates is deferred: CI authoring is a different lesson, so only the local half is
wired here.

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
