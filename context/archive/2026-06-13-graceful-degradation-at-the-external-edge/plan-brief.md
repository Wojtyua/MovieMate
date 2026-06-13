# Graceful Degradation at the External Edge — Plan Brief

> Full plan: `context/changes/graceful-degradation-at-the-external-edge/plan.md`
> Research: `context/changes/graceful-degradation-at-the-external-edge/research.md`

## What & Why

Test-plan Phase 2 / Risk #2: prove that when TMDB or OpenRouter fails or times
out, the recommendations pipeline **degrades gracefully** — an AI failure falls
back to genre-only retrieval and still returns three picks; a TMDB failure returns
a clean `ok:false` (no throw, no 500). Research found the behavior is _already
implemented and robust_, so this phase characterizes it and locks it against
regression with integration tests.

## Starting Point

`recommendRun` already degrades at every edge (failures return `null`/`[]`/
`{ok:false}`, never throw) with an 8s TMDB + 2.5s AI budget. Phase 1 left an
integration seam — global `fetch` stub + `astro:env/server` shim + fake Supabase
— but pins `OPENROUTER_API_KEY: ""`, so the AI path never fires there. MSW is not
installed.

## Desired End State

Two new integration test files at the `recommendRun` boundary assert Risk #2's two
asymmetric outcomes across the canonical failure matrix (non-ok / throw /
malformed / unconfigured), all green and fast. The shared test double gains a
URL-routing, failure-injecting `fetch` stub. The test plan is updated to reflect
that MSW was deliberately not adopted, with the fetch-stub recipe in the cookbook.

## Key Decisions Made

| Decision            | Choice                                 | Why (1 sentence)                                                                                                     | Source   |
| ------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| Network mock tool   | Extend the `fetch` stub (not MSW)      | Same signal at lower cost (cost×signal); MSW's multi-endpoint ergonomics aren't worth a new dep + global setup here  | Plan     |
| Timeout determinism | Simulate the consequence (stub throws) | A thrown error hits the identical catch/degrade branch a real abort does — deterministic and instant, no fake timers | Plan     |
| Failure matrix      | Canonical set, parameterized per edge  | Covers every real failure shape (they differ in code) without combinatorial bloat                                    | Plan     |
| Assertion surface   | `recommendRun` library boundary only   | The route just maps result→redirect; a 500 needs `recommendRun` to throw, which these tests disprove                 | Plan     |
| Test-plan deviation | Update §3/§4/§6.2 to drop MSW mandate  | Keeps the frozen strategy truthful — no dangling "MSW arrives in Phase 2" claim                                      | Plan     |
| File organization   | Two new files split by env shim        | `vi.mock("astro:env/server")` is static per file; AI-key-truthy and AI-key-empty worlds can't coexist                | Research |

## Scope

**In scope:**

- A URL-routing failure-injecting `fetch` stub + request-URL capture in the shared doubles module.
- `recommend-run.degradation.test.ts` (AI key truthy): TMDB-edge → `ok:false`; search-edge → genre-only+3; OpenRouter-edge → genre-only+3 with proof.
- `recommend-run.unconfigured.test.ts` (AI key `""`): unconfigured OpenRouter → genre-only+3.
- Reconciling `test-plan.md` §3/§4/§6.2/§6.6.

**Out of scope:**

- MSW; any production code change; HTTP/endpoint-level test; real-clock budget assertion; exact-score assertions; duo cross-product; TMDB-unconfigured guard.

## Architecture / Approach

One extended `fetch` stub routes by URL substring to the three edges (TMDB
discover, TMDB search, OpenRouter) and injects a per-edge failure mode while
recording requested URLs. Tests run at the `recommendRun` boundary with the
hand-rolled fake Supabase from Phase 1. The genre-only fallback is _proved_, not
inferred: on AI failure, no `/search` call fires and the discover query carries
`with_genres` but no `with_cast`/`with_keywords`.

## Phases at a Glance

| Phase                  | What it delivers                                                    | Key risk                                                                      |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Extend test double  | URL-routing failure-injecting `fetch` stub + request log            | Keeping `makeFetchStub` (Phase 1) untouched while adding the new builder      |
| 2. Degradation suite   | Two test files covering the full matrix; verify by deliberate break | Proving genre-only fallback (not just 3 picks) — needs query-shape assertions |
| 3. Reconcile test plan | §3/§4/§6.2/§6.6 updated; change stamped                             | Leaving a stale MSW reference behind                                          |

**Prerequisites:** None — research done, Phase 1 seam in place, no new deps.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The genre-only-signature assertions depend on `dedupeAttempts` collapsing the
  ladder when AI adds nothing — verified in `recommend-run.ts:126-131,214-227`.
- Throw-to-simulate-timeout assumes `fetchCandidates`/`extract` catch any error
  identically to an abort — verified (`tmdb-discover.ts:190`, `ai.ts:103`).

## Success Criteria (Summary)

- A TMDB-edge failure yields `ok:false` + nothing persisted; an OpenRouter/search
  failure yields genre-only retrieval + three picks — across the canonical matrix.
- Deliberately breaking a degrade branch turns a test red (catches the regression).
- The test plan no longer claims MSW; the cookbook carries the fetch-stub recipe.
