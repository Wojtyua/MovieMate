# "Always Three Picks" Core — Test Phase 1 — Plan Brief

> Full plan: `context/changes/testing-always-three-picks-core/plan.md`
> Research: `context/changes/testing-always-three-picks-core/research.md`

## What & Why

Stand up Vitest and write the test-plan §3 **Phase 1** suite defending **Risk #1**
(the recommendation pipeline drains below three picks with healthy dependencies)
and **Risk #5** (a malformed pick set on the solo↔duo branch). These are the
top-likelihood logic risks in the product, and there is currently zero test
tooling in the repo.

## Starting Point

No Vitest, no config, no tests exist. The "always three" guarantee already lives
in two layers of shipped code: pure `recommend()` (roles.ts) owns pick *shape*,
and the relaxation ladder in `recommendRun` (recommend-run.ts) owns pool
*supply*. The oracle for both is fully resolved in `research.md` — no open
behavioral questions.

## Desired End State

`npm run test` runs a green two-layer suite: unit tests prove `recommend()`
produces ≤3 distinct, correctly-role-labeled picks (solo never `compromise`,
wild card genre ≠ safe, `min(N,3)` with no fabrication); an integration test
proves `recommendRun` returns exactly three persisted picks from a healthy pool,
dedups across discover pages, and excludes watched films — with only the network
edge stubbed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Thin-universe boundary | Assert `min(N,3)`, document no-fabrication | Matches the PRD oracle ("three when supply allows") and the code's actual contract; the alternative would assert behavior nothing promises | Plan |
| Supply-layer seam | `fetch` + env-token stub + fake `SupabaseClient` | `recommendRun` builds its own TMDB client and calls Supabase directly, so there is no stub-arg seam; stub the network edge, never internal modules | Plan |
| Stryker mutation gate | Ad hoc, documented in §6.6, not run in-phase | CLAUDE.md frames mutation testing as a selective post-phase gate, not a CI/in-phase gate | Plan |
| Vitest bootstrap depth | Config + scripts, node env, no CI/hooks | A runnable local suite now; CI/hook wiring belongs to test-plan §3 Phase 5 | Plan |
| Unit-suite shape | Parameterized per-invariant + focused edges | Each test catches a distinct R5 regression; avoids the redundant-copies anti-pattern | Plan |

## Scope

**In scope:** Vitest bootstrap; pure-layer unit suite on `recommend()` (R5 +
shape-half of R1); supply-layer integration suite on `recommendRun` no-note path
(supply-half of R1); test-plan §6 cookbook update.

**Out of scope:** Multi-rung relaxation progression (needs the note/AI path →
Phase 2); `AiClient`/`parseNote`/MSW (Phase 2); partial-failure persistence
(hermetic, later); CI/coverage/husky wiring (Phase 5); pgTAP DB assertions; exact
float-score assertions (§7); running Stryker in-phase.

## Architecture / Approach

Two test layers in cost order. **Unit** (Phase 2): pure `recommend()` with
hand-built `TmdbMovie[]` fixtures, ordered so the intended candidate wins by
construction (oracle-by-construction, not float assertions) — zero infra, no
`astro:*` deps. **Integration** (Phase 3): drive `recommendRun` with
`vi.stubGlobal("fetch")` keyed on the `page` query param, an `astro:env/server`
token shim (load-bearing — `createTmdbClient()` reads the token from that virtual
module), and a hand-rolled fake `SupabaseClient`. No internal module is mocked.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bootstrap Vitest | Runnable `npm run test`, node env, `@/*` alias | Vite 7 / Vitest 3.x interop; alias resolution |
| 2. Unit suite (`recommend()`) | Pick-shape + role + `min(N,3)` invariants | Oracle drift — must assert from PRD, not roles.ts |
| 3. Integration suite (`recommendRun`) | Supply + dedup + watched-exclusion | `astro:env/server` resolution; fetch stub keyed on page |
| 4. Cookbook + sync | §6.1/§6.2 patterns + §6.6 Stryker pointer | None — documentation |

**Prerequisites:** None beyond the repo as-is (Vite 7 pinned, `@/*` alias in
tsconfig).
**Estimated effort:** ~1–2 sessions across 4 phases (Phase 1 trivial, Phase 3
the heaviest).

## Open Risks & Assumptions

- `astro:env/server` must be made resolvable in Vitest for the integration layer;
  the mechanism (alias vs `vi.mock`) is chosen in Phase 1 and reused. If it
  cannot be cleanly shimmed, the integration test falls back to asserting the
  "TMDB not configured" short-circuit only — a much weaker signal.
- Multi-rung "no over-relax" progression is deliberately deferred to Phase 2; if a
  reviewer expects it here, that expectation is out of Phase-1 scope by design.

## Success Criteria (Summary)

- `npm run test` is green; a healthy pool yields exactly three well-shaped,
  correctly-role-labeled picks at both layers.
- Watched films never appear in persisted picks; movies repeated across pages are
  deduped.
- The cookbook (§6.1/§6.2/§6.6) lets the next phase reuse these patterns.
