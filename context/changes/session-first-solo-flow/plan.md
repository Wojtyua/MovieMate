# Session-First Solo Flow (S-02) Implementation Plan

## Overview

Deliver the roadmap's north-star slice: a logged-in operator starts a movie-night session from the home entry point, sees tonight's genres pre-filled from their remembered taste core (editable for tonight without overwriting the core), sets mood/runtime/intensity, stays solo, and receives **three role-labeled picks** — solo role set `safe / crowd_pleaser / wild_card` — from the deterministic engine generalized to one-or-two tastes (PRD US-01, FR-003, FR-004, FR-008, FR-009; roadmap S-02).

Along the way this slice deletes two pieces of debt the reshape exists to remove: the S-01 **degenerate-duo shim** (`recommend([core, core], …)`) and the **double-scoring** of the same genre taste through parallel weight blocks (frame root cause D2).

## Current State Analysis

- **Home is starter content.** `src/components/Welcome.astro` renders "Test test test" + template feature cards; `src/pages/index.astro` just wraps it. Sign-in redirects to `/` (`src/pages/api/auth/signin.ts:19`); the email-confirm callback redirects to `/dashboard` (`src/pages/auth/callback.ts:26`). There is no "start a movie night" path from home.
- **The session form starts blank.** `src/pages/sessions.astro:67-78` renders `SessionForm` with empty genre props for a new session (edit mode seeds from the saved session row). Sessions persist their own genre columns (`src/pages/api/sessions.ts:82-90`), so seeding the form from the core cannot overwrite the core — "tonight-only edits" come free.
- **The engine is hard-paired.** `recommend(profiles: [Profile, Profile], …)` (`src/lib/recommend/roles.ts:87`); `scoreCandidate` computes `combined = A_A + A_B + shared` and `balance = min(A_A+shared, A_B+shared)` (`src/lib/recommend/scoring.ts:120-121`).
- **Genre taste is scored twice.** `WEIGHTS` carries `W_PREF/W_EXCL` (viewer) and `W_SPREF/W_SEXCL` (session) (`scoring.ts:13-32`); `sessionAlignment` scores the session's genre fields while `viewerAffinity` scores the core's — the same dimensions, double-counted once pre-fill makes them equal.
- **The S-01 shim is live.** `src/pages/api/recommendations.ts:66-77` loads the single core, hard-gates to `/profiles` when absent (line 70-71), and calls `recommend([core, core], …)` (line 130) with a comment marking it for S-02 removal. The TMDB discover hint ORs session + core preferred genres (`unionGenres`, line 113).
- **The role taxonomy is DB-enforced.** `recommendation_picks.role` CHECK admits `'safe'/'compromise'/'wild_card'` (`supabase/migrations/20260606115345_recommendations.sql:41`) plus `unique(recommendation_id, role)`. pgTAP suite `supabase/tests/recommendations_isolation.sql` (`plan(10)`) asserts the CHECK rejects an unknown role (line ~103). Display order/labels live in `src/pages/sessions/[id]/recommendations.astro:23-24` as exhaustive `Record<Role, …>` maps.
- **No unit-test runner exists.** Gates are `npm run lint`, `npx astro check`, `npm run build`, and pgTAP via `npm run db:verify`. Test infrastructure is owned by the upcoming `/10x-test-plan` work (decision: do not preempt it here).

## Desired End State

- Home pitches MovieMate and its primary CTA "Start a movie night" leads (via sign-in when logged out) to `/sessions`; sign-in and email-confirm land on `/sessions`.
- A new-session form arrives pre-filled with the remembered core's preferred/excluded genres and a hint that edits apply to tonight only; with no core saved, the form is blank with a soft nudge to set one — never a hard gate.
- Requesting recommendations on a solo session returns three picks labeled **Safe pick / Crowd-pleaser / Wild card**, scored from tonight's genres + mood/intensity + quality/popularity, persisted with `role = 'crowd_pleaser'` for the middle pick.
- The engine accepts one or two tastes; the duo branch (safe/compromise/wild_card) is preserved intact for S-03 but unreachable in production until S-03 wires the second-viewer input.
- `recommendations.ts` no longer reads `viewer_profiles` at all; the shim and the `/profiles` precondition gate are gone.
- All gates green: `npm run lint`, `npx astro check`, `npm run build`, `npm run db:verify`.

Verify by: applying the migration, signing in (landing on `/sessions`), confirming pre-fill + hint, submitting a session, requesting recommendations, and seeing three solo-labeled picks persist — then clearing the core and confirming the flow still returns three picks.

### Key Discoveries:

- Sessions already own their genre columns, so FR-004's "editable for tonight without overwriting the core" is purely a page-level seed (`sessions.astro` + `SessionForm` props) — no API change needed for pre-fill.
- The double-scoring (frame D2) dissolves structurally once tonight's session genres *become* the taste: `W_SPREF/W_SEXCL` are deleted, not retuned (decision: tonight's genres only; core is a pre-fill source, never a scoring input).
- The inline column CHECK on `role` is auto-named `recommendation_picks_role_check` — the widening migration can drop it by that name and re-add it explicitly named.
- `Record<Role, …>` maps in `recommendations.astro` are exhaustive, so widening the `Role` type forces the display update in the same phase as the type change (Phase 1) to keep typecheck green.
- The middle solo pick needs an excluded-genre guard: a "broadly loved" film in an avoided genre must not win `crowd_pleaser`, so the crowd ranking subtracts the standard excluded-genre penalty.

## What We're NOT Doing

Explicitly deferred (scope lock confirmed during planning):

- **Second-viewer input / duo UI** — S-03. The engine's duo branch ships generalized and intact but unreachable.
- **AI note parsing / `src/lib/ai.ts`** — S-04. The note field stays stored-but-unused.
- **Select a pick / mark watched / watched table** — S-05.
- **"Save tonight's genres as my core" affordance** (PRD OQ-3) — the only core edit surface remains `/profiles`.
- **Unit-test infrastructure (vitest)** — owned by the `/10x-test-plan` rollout; this slice verifies via existing gates + manual steps.
- **Renaming the `viewer_profiles` table or `/profiles` URL**, dashboard redesign, middleware changes, runtime/mood/intensity option changes.

## Implementation Approach

Three phases in dependency order: generalize the engine first (pure lib + type-forced display maps, production behavior still served by the shim), then land the role migration together with the solo read path (the migration must precede the first `crowd_pleaser` insert), then reshape the entry flow and pre-fill UX. Decisions from planning: solo middle role = `crowd_pleaser` (quality+popularity signal); taste at scoring time = tonight's session genres only; engine generalized to 1–2 tastes now; pre-fill with a hint line; no-core proceeds with an empty taste (gate removed); verification via existing gates + manual.

**Cross-phase note:** between Phase 1 and Phase 2 the deployed flow still returns three duo-labeled picks via the shim, but `SessionPrefs` loses its genre fields in Phase 1, so the session's genre edits are temporarily unscored (the core, fed twice by the shim, dominates). This intermediate is acceptable — each phase's gates pass — but the slice's end-to-end behavior should only be demoed after Phase 2.

## Critical Implementation Details

- **Migration-before-write ordering.** The CHECK widening must be applied before `recommendations.ts` can persist a `crowd_pleaser` pick — both land in Phase 2, migration first. Phase 1 must not make the API produce the new role.
- **Cardinality as a tuple union.** Type the engine input as `[Taste] | [Taste, Taste]` (not `Taste[]`): the interim shim call `[core, core]` and S-03's duo call stay compile-checked, and an empty-array call is unrepresentable.
- **Crowd-pleaser signal.** `crowd = W_QUALITY·Q + W_CROWD·P − W_EXCL·|G(c) ∩ excluded|` where `Q = vote_average/10`, `P` = pool-relative popularity, and `excluded` spans all present tastes. `W_CROWD` is a new weight in the tunable block (suggested 3 — heavier than `W_POP=1`, because popularity is the point of this role). Tie-break toward `combined`. The `usedIds` guard already keeps it a distinct movie from safe.
- **Pre-fill is new-session-only.** Seed from the core only when `editSession` is null in `sessions.astro`; edit mode keeps the session row's own saved values. Pre-fill must not write anything — the core changes only via `/profiles`.

## Phase 1: Engine generalization (pure lib)

### Overview

Generalize scoring + role assignment to one-or-two tastes with a cardinality branch, delete the session-genre weight block (double-scoring), widen the `Role` type, and update the type-forced display maps. Production still calls the duo shim — behavior stays "three duo-labeled picks"; all gates green.

### Changes Required:

#### 1. Scoring — tastes array, no session-genre weights, crowd signal

**File**: `src/lib/recommend/scoring.ts`

**Intent**: Make the taste list the only genre-taste input and add the deterministic crowd-pleaser ranking signal, eliminating the parallel session-genre weight block (frame D2).

**Contract**: Rename `Profile` → `Taste` (same shape: `preferred_genre_ids`, `excluded_genre_ids`). `SessionPrefs` drops `preferred_genre_ids`/`excluded_genre_ids`, keeping `{ mood, intensity }`; `sessionAlignment` keeps only the mood + intensity terms. `WEIGHTS`: delete `W_SPREF`/`W_SEXCL`, add `W_CROWD` (crowd-pleaser popularity reward, suggested 3). `scoreCandidate(candidate, tastes: [Taste] | [Taste, Taste], session, maxPopularity)` returns `CandidateScore` with: `combined` = sum of per-taste affinities + shared, `balance` = min over tastes of (affinity + shared), `crowd` = `W_QUALITY·Q + W_CROWD·P − W_EXCL·(excluded-genre overlap across all tastes)`, and `perTaste: number[]` (replacing `perViewer`). For one taste, `balance === combined` falls out naturally.

#### 2. Roles — cardinality branch + crowd_pleaser

**File**: `src/lib/recommend/roles.ts`

**Intent**: Branch the middle role on taste cardinality: duo keeps `compromise` (argmax `balance`), solo introduces `crowd_pleaser` (argmax `crowd`). Safe and wild-card logic are unchanged.

**Contract**: `Role` becomes `"safe" | "compromise" | "wild_card" | "crowd_pleaser"`. `recommend(tastes: [Taste] | [Taste, Taste], session, candidates)`: safe = argmax `combined` (unchanged); middle pick = `compromise`/argmax `balance` when `tastes.length === 2`, else `crowd_pleaser`/argmax `crowd` (tie-break `combined`); wild card = existing genre-disjoint-from-safe logic, unchanged. The doc comment gains the solo role-set rationale (FR-009).

#### 3. Barrel + call-site type rename

**File**: `src/lib/recommend/index.ts`, `src/pages/api/recommendations.ts`

**Intent**: Mechanical follow-through of the `Profile` → `Taste` rename and the slimmer `SessionPrefs` so the shim call still compiles; no behavior change at the API beyond `SessionPrefs` no longer carrying genre fields (the session row keeps loading them on `SessionRow` for the discover hint).

**Contract**: `index.ts` re-exports `Taste` (drop `Profile`). `recommendations.ts` renames the imported type and keeps `recommend([core, core], …)` (now matching `[Taste, Taste]`); `SessionRow` declares the genre fields it still loads, since `SessionPrefs` no longer provides them.

#### 4. Display maps for the widened Role type

**File**: `src/pages/sessions/[id]/recommendations.astro`

**Intent**: The exhaustive `Record<Role, …>` maps must cover `crowd_pleaser` for typecheck to pass; finalize its display copy and ordering now.

**Contract**: `ROLE_RANK`: `safe: 0`, `compromise: 1`, `crowd_pleaser: 1`, `wild_card: 2` (the middle slot, either taxonomy). `ROLE_LABEL`: add `crowd_pleaser: "Crowd-pleaser"`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Typecheck passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- Existing flow unchanged at the role level: saved core + saved session → "Get recommendations" still returns three picks labeled Safe pick / Compromise / Wild card (duo branch via the interim shim).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2. Phase blocks use plain bullets — checkbox state lives in `## Progress`.

---

## Phase 2: Role migration + solo read path

### Overview

Widen the pick-role CHECK to admit `crowd_pleaser`, then rewrite the recommendations read path: tonight's session genres become the single taste, the core load and `/profiles` gate are deleted, and the S-01 shim is removed. After this phase the solo north-star flow works end to end.

### Changes Required:

#### 1. Widen the role CHECK

**File**: `supabase/migrations/<timestamp>_solo_role_crowd_pleaser.sql` (new; `YYYYMMDDHHMMSS_` convention via `npm run db:new`)

**Intent**: Admit the solo middle role in storage while keeping `compromise` valid (the duo set returns in S-03).

**Contract**: `alter table public.recommendation_picks drop constraint recommendation_picks_role_check;` then re-add explicitly named: `check (role in ('safe', 'compromise', 'wild_card', 'crowd_pleaser'))`. The `unique (recommendation_id, role)` constraint and RLS are untouched. Additive and reversible per convention.

#### 2. pgTAP suite covers the widened domain

**File**: `supabase/tests/recommendations_isolation.sql`

**Intent**: Prove the widened CHECK accepts `crowd_pleaser` and still rejects unknown roles.

**Contract**: Add one `lives_ok` inserting an owner-scoped `crowd_pleaser` pick (alongside the existing fixtures); keep the existing unknown-role `throws_ok`. Bump `select plan(10)` to the new assertion count and refresh the header comment to mention the solo role set (FR-009).

#### 3. Solo read path — session genres are the taste

**File**: `src/pages/api/recommendations.ts`

**Intent**: Delete the S-01 shim and the core dependency entirely: build the one taste from the session row's genre fields and call the solo branch. Removes the `/profiles` precondition gate (decision: no-core proceeds with whatever tonight's form said — possibly empty genres).

**Contract**: Drop the `viewer_profiles` query, the `core` construction, and the no-core redirect (current steps 1, lines 65-77). Build `taste: Taste` from `session.preferred_genre_ids`/`session.excluded_genre_ids`. Discover hint becomes the session's preferred genres only (simplify/inline `unionGenres`). Call `recommend([taste], { mood: session.mood, intensity: session.intensity }, candidates)`. Persistence (steps 6-7) unchanged — the middle pick now persists as `role = 'crowd_pleaser'`. Update the step comments (the FR references shift: taste/scoring per FR-008, roles per FR-009).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- pgTAP suite passes (incl. the `crowd_pleaser` lives_ok): `npm run db:verify`
- Linting passes: `npm run lint`
- Typecheck passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- Solo end-to-end: save a session with genres + mood → "Get recommendations" returns three picks labeled Safe pick / Crowd-pleaser / Wild card within the < 10 s budget.
- Picks persist: one `recommendations` run + three `recommendation_picks` rows, the middle with `role = 'crowd_pleaser'`.
- No taste core saved: the flow still returns three picks (no `/profiles` redirect, no crash) from tonight's genres + mood alone.
- Excluded genres still repel: a session excluding a broad genre yields no pick dominated by it (crowd-pleaser guard included).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Entry flow + pre-fill UX

### Overview

Make home the real entry point (FR-003) and seed the new-session form from the remembered core with a tonight-only hint (FR-004). After this phase the full north-star demo path is: home → CTA → (sign-in) → pre-filled session form → three solo picks.

### Changes Required:

#### 1. MovieMate home

**File**: `src/components/Welcome.astro`

**Intent**: Replace the starter hero and feature cards with MovieMate's actual pitch and one primary CTA "Start a movie night" → `/sessions` (middleware already routes logged-out visitors through sign-in).

**Contract**: Keep the cosmic layout, orbs, star field, and `Topbar`. Hero headline/subcopy pitch the product (three role-labeled picks for tonight, no catalog); primary CTA links to `/sessions`; secondary link "Edit taste core" → `/profiles`. The three feature cards become product cards (remembered taste core pre-fills tonight / solo or duo / three role-labeled picks). Pure content + links change — no new components or logic.

#### 2. Post-auth landing on the session form

**File**: `src/pages/api/auth/signin.ts`, `src/pages/auth/callback.ts`

**Intent**: "Home → login → start session" becomes literal — both the sign-in success and the email-confirm callback land on `/sessions` instead of `/` and `/dashboard`.

**Contract**: `signin.ts:19` redirect → `/sessions`; `callback.ts:26` redirect → `/sessions`. Error paths unchanged.

#### 3. Pre-fill the new-session form from the core

**File**: `src/pages/sessions.astro`

**Intent**: Seed tonight's genre pickers from the remembered core when starting a new session; surface the no-core nudge instead of any gate.

**Contract**: When `editSession` is null, load the core (`viewer_profiles` → `preferred_genre_ids, excluded_genre_ids`, `maybeSingle()`) and pass them as `preferredGenreIds`/`excludedGenreIds` to `SessionForm`, plus a new `prefilledFromCore` flag (true only when a core row exists and it contributed at least the seed). When no core row exists, render a soft nudge line above/below the form: no taste core yet — link to `/profiles` to set one so future nights pre-fill. Edit mode (`editSession` present) is unchanged — it keeps seeding from the session row.

#### 4. Tonight-only hint in the form

**File**: `src/components/sessions/SessionForm.tsx`

**Intent**: Make the no-overwrite contract legible where it matters (PRD FR-004 Socrates: "pre-filling hides that genres are still editable").

**Contract**: New optional prop `prefilledFromCore?: boolean`; when true, render one helper line near the genre pickers: "Pre-filled from your taste core — edits apply to tonight only." No other form behavior changes.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Typecheck passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- Home shows the MovieMate hero; "Start a movie night" → logged-out lands on sign-in, then `/sessions`; logged-in goes straight to `/sessions`.
- Signing in (and confirming email) lands on `/sessions`.
- With a saved core: the new-session form arrives pre-filled with the core's genres and shows the tonight-only hint; editing genres + saving the session does not change `/profiles`.
- With no core: form is blank, the soft nudge with the `/profiles` link appears, and recommendations still work.
- Edit mode (`?saved=<id>`) still shows the session's own saved values, not the core.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This closes S-02 — reconcile the roadmap (§At a glance, slice body, Backlog Handoff per `lessons.md`) on archive.

---

## Testing Strategy

### DB tests (pgTAP, `npm run db:verify`):

- `supabase/tests/recommendations_isolation.sql` gains a `lives_ok` for an owner-scoped `crowd_pleaser` insert and keeps the unknown-role `throws_ok`; `plan(N)` bumped (Phase 2, change #2).
- `viewer_profiles_isolation.sql` and `movie_night_sessions_isolation.sql` are unaffected.

### Unit Tests:

- None in this slice (decision): the repo has no unit-test runner, and test infrastructure is owned by the upcoming `/10x-test-plan` rollout. The generalized engine (cardinality branch, crowd signal) is the highest-priority target for that rollout — flag it there.

### Integration Tests:

- Manual end-to-end only (below); automated e2e is also deferred to the test rollout.

### Manual Testing Steps:

1. `npm run db:reset` — both migrations apply; `npm run db:verify` passes.
2. Home: MovieMate hero + CTA; click through logged-out → sign-in → `/sessions`.
3. With a saved core: new-session form pre-filled + hint; tweak genres for tonight, save, confirm `/profiles` core unchanged.
4. Request recommendations: three picks labeled Safe pick / Crowd-pleaser / Wild card, < 10 s; middle pick persisted as `crowd_pleaser`.
5. Delete the core row (or use a fresh account): session flow still completes with three picks; nudge line shows on the form.
6. Session excluding a broad genre (e.g. Comedy): no pick dominated by it.
7. Wild card's genres differ from the safe pick's.

## Performance Considerations

None new. One DB read is removed from the recommendations path (no `viewer_profiles` load); no AI on the path (S-04). The < 10 s budget is comfortably unaffected.

## Migration Notes

Additive CHECK widening only — no data movement, no rows invalidated (existing roles remain in the domain). Reversible by re-narrowing the CHECK (valid while no `crowd_pleaser` rows exist). `viewer_profiles` is untouched.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-02 (session-first-solo-flow)
- PRD: `context/foundation/prd.md` → US-01, FR-003, FR-004, FR-008, FR-009; OQ-1 (resolved: `crowd_pleaser`)
- Upstream frame: `context/changes/session-first-flow/frame.md` (root causes D2/D3/D5)
- Prior slice: `context/archive/2026-06-06-remembered-taste-core/plan.md` (the shim this deletes)
- Engine: `src/lib/recommend/scoring.ts`, `src/lib/recommend/roles.ts`
- Read path: `src/pages/api/recommendations.ts`
- Role CHECK: `supabase/migrations/20260606115345_recommendations.sql:41`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Engine generalization (pure lib)

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 8fb98b7
- [x] 1.2 Typecheck passes: `npx astro check` — 8fb98b7
- [x] 1.3 Build passes: `npm run build` — 8fb98b7

#### Manual

- [x] 1.4 Existing flow still returns three duo-labeled picks via the interim shim — 8fb98b7

### Phase 2: Role migration + solo read path

#### Automated

- [x] 2.1 Migration applies cleanly: `npm run db:reset` — a13356a
- [x] 2.2 pgTAP suite passes (incl. crowd_pleaser lives_ok): `npm run db:verify` — a13356a
- [x] 2.3 Linting passes: `npm run lint` — a13356a
- [x] 2.4 Typecheck passes: `npx astro check` — a13356a
- [x] 2.5 Build passes: `npm run build` — a13356a

#### Manual

- [x] 2.6 Solo end-to-end: three picks Safe / Crowd-pleaser / Wild card within budget — a13356a
- [x] 2.7 Picks persist: run + three rows, middle role = crowd_pleaser — a13356a
- [x] 2.8 No core saved: flow still returns three picks (no redirect, no crash) — a13356a
- [x] 2.9 Excluded genres still repel picks (incl. the crowd-pleaser slot) — a13356a

### Phase 3: Entry flow + pre-fill UX

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Typecheck passes: `npx astro check`
- [x] 3.3 Build passes: `npm run build`

#### Manual

- [x] 3.4 Home hero + CTA path: logged-out → sign-in → `/sessions`; logged-in → `/sessions`
- [x] 3.5 Sign-in and email-confirm land on `/sessions`
- [x] 3.6 Pre-fill + hint with saved core; tonight edits don't change the core
- [x] 3.7 No core: blank form + soft nudge, recommendations still work
- [x] 3.8 Edit mode still seeds from the session row, not the core
