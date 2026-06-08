# Optional Inline Second Viewer (Duo Path) Implementation Plan

## Overview

Roadmap slice **S-03**. Let the operator optionally add a *second viewer's* genre taste **inline for tonight** (or stay solo) and receive duo picks labeled **safe / compromise / wild card**, scored against both present tastes. The second taste is captured **on-device and never persisted** — it rides only the `POST /api/recommendations` request and never touches the session row.

This is a **wiring slice, not an engine slice**. S-02 already generalized the deterministic engine to one-or-two tastes and left the duo branch live but unreachable in production. The work is three small deltas plus one new UI surface: extract the reusable genre picker, branch the recommendations API on an optional second taste, and add a second-viewer React island that deposits hidden inputs into the existing recommendations form.

## Current State Analysis

What already exists and is correct on `main` (from `research.md`):

- **Engine accepts the tuple union.** `recommend(tastes: [Taste] | [Taste, Taste], …)` and `scoreCandidate(…, tastes, …)`; the two-taste math (`combined`, `balance`, `perTaste`, excluded-overlap) is real, not stubbed (`src/lib/recommend/scoring.ts:108-132`, `src/lib/recommend/roles.ts:100-146`).
- **Middle pick branches on cardinality at runtime.** `tastes.length === 2` → `compromise` (argmax `balance`); else → `crowd_pleaser` (argmax `crowd`) (`src/lib/recommend/roles.ts:127-146`). Safe = argmax `combined`; wild card = genre-disjoint-from-safe (both cardinality-agnostic).
- **DB role domain already admits `compromise`.** CHECK is `('safe','compromise','wild_card','crowd_pleaser')` (`supabase/migrations/20260607073440_solo_role_crowd_pleaser.sql`), with pgTAP coverage (`supabase/tests/recommendations_isolation.sql:105-138`). No migration needed.
- **Display already maps duo labels.** `ROLE_LABEL`/`ROLE_RANK` include `compromise` → "Compromise" (`src/pages/sessions/[id]/recommendations.astro:24-30`). No display change.
- **The recommendations trigger is a plain server-rendered Astro `<form>`** (`src/pages/sessions.astro:128-136`) carrying only a hidden `session_id`. It is **separate** from the React `SessionForm`, which POSTs to `/api/sessions`.
- **`GenrePicker` is reusable but co-located.** It lives inside `SessionForm.tsx:215-254` — generic, stateless, `Set<number>` + toggle callback. Reuse for a second viewer requires extraction.
- **The API builds one taste from tonight's session genres.** `recommendations.ts:88-92` constructs `taste` from session columns; `:120` calls `recommend([taste], …)`, hardwired to the one-taste array; `:105-110` passes `taste.preferred_genre_ids` as the discover hint.

## Desired End State

On `/sessions`, beneath the "Get recommendations" trigger, the operator sees an **"Add a second viewer"** affordance. Activating it reveals two genre pickers (preferred / avoid) for a guest whose taste exists only in the browser. Submitting "Get recommendations" with a populated second viewer produces three picks labeled **Safe pick / Compromise / Wild card**, scored against *both* tastes. Staying solo (or toggling the second viewer off) produces the existing solo picks (**Safe pick / Crowd-pleaser / Wild card**). The second viewer's genres are **never written to any table** — they leave no persisted trace by construction, because they route only through `/api/recommendations`, which writes only `recommendations` + `recommendation_picks` (never the session row).

**Verification:** Add a second viewer with distinct genres, get recommendations, confirm the middle card reads "Compromise". Inspect the DB — no second-viewer genres anywhere. Toggle the second viewer off, get recommendations, confirm the middle card reverts to "Crowd-pleaser".

### Key Discoveries:

- Engine, DB, and display need **zero change** — cardinality drives `compromise`, the `balance` metric, and the label for free once `[taste, second]` is passed (`research.md` Architecture Insights).
- The asymmetric "never persisted" guarantee is enforced **by omission**: route the second taste only through `/api/recommendations`, never `/api/sessions` (`research.md:143`).
- The TMDB discover hint is computed by the **caller**; the duo blend is `session.preferred ∪ second.preferred` unioned at the API layer (`src/lib/tmdb-discover.ts:31-42`, `research.md:125`).
- Server parses repeated form fields via `formData.getAll(...)` — the same pattern `SessionForm` uses for `preferred_genre_ids` (`SessionForm.tsx:158-165`).

## What We're NOT Doing

- **No engine change.** Duo scoring/roles ship intact; no weight retuning unless manual testing shows duo picks are off (out of scope unless observed).
- **No migration / no new table.** The role domain already includes `compromise`.
- **No display change.** `compromise` → "Compromise" is already mapped.
- **No `/api/sessions` change.** The second taste bypasses session persistence entirely.
- **No second-person login or persistence.** Honors the PRD "no second-person login" Non-Goal — the second viewer is ephemeral, on-device only.
- **No solo-label rename.** Roadmap OQ-1/OQ-2 is closed by keeping solo "Crowd-pleaser" / duo "Compromise" as already implemented (documentation close-out, not code).
- **No discover-pool hardening** (extra pages, fallback retries). OR-union strictly broadens supply; the existing "No matching films" redirect already guards the empty case.

## Implementation Approach

Three sequenced phases, each independently verifiable:

1. **Extract `GenrePicker`** into a shared module so both `SessionForm` and the new island import one source of truth. Pure refactor — no behavior change.
2. **Branch the API** on an optional, sanitized second taste, building `[taste]` or `[taste, second]` and unioning the discover hint. Independently testable without UI (the backend simply ignores the fields when absent).
3. **Add the second-viewer island** with a toggle (clears on collapse) that emits hidden `second_*` inputs into the recommendations form, completing the user-visible flow.

Doing extraction first gives the island a shared component; doing the API before the island means the UI has a working endpoint the moment it ships.

## Phase 1: Extract `GenrePicker` into a shared module

### Overview

Move `GenrePicker` out of `SessionForm.tsx` into its own file so it can be imported by both `SessionForm` and the new second-viewer island. No behavior or styling change.

### Changes Required:

#### 1. New shared GenrePicker component

**File**: `src/components/sessions/GenrePicker.tsx` (new)

**Intent**: House the existing `GenrePicker` as an exported component so two islands can share one implementation, keeping styling and toggle behavior in sync.

**Contract**: Export `GenrePicker` with the existing prop shape unchanged — `{ label: string; kind: "preferred" | "excluded"; selected: Set<number>; onToggle: (kind, id) => void }`. Move the `GenrePickerProps` interface and the component body verbatim from `SessionForm.tsx:215-254`. It depends on `MOVIE_GENRES` (`@/lib/genres`) and `cn` (`@/lib/utils`).

#### 2. SessionForm imports the shared component

**File**: `src/components/sessions/SessionForm.tsx`

**Intent**: Consume the extracted component instead of the local definition, with no change to rendered output.

**Contract**: Add an import for `GenrePicker` from `./GenrePicker`; delete the local `GenrePickerProps` interface and `GenrePicker` function (`:215-254`). The two `<GenrePicker … />` call sites (`:155-156`) are unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or the project's `astro check` / `tsc` step)
- Linting passes: `npm run lint`
- Existing tests pass: `npm test`

#### Manual Verification:

- `/sessions` form renders identically — both genre pickers work, mutual-exclusion between preferred/avoid still clears the other side.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: API duo branch

### Overview

Teach `POST /api/recommendations` to read an optional second viewer's genres from FormData, sanitize them, build `[taste]` or `[taste, second]`, and union the second's preferred genres into the TMDB discover hint. Absent fields → unchanged solo behavior.

### Changes Required:

#### 1. Parse and sanitize the optional second taste

**File**: `src/pages/api/recommendations.ts`

**Intent**: Read `second_preferred_genre_ids` / `second_excluded_genre_ids` as repeated form fields (same pattern as session genres), and build a `second: Taste` **only** when the viewer actually selected at least one genre. Sanitize self-overlap so a genre never appears in both preferred and excluded.

**Contract**: After the existing solo `taste` is built (`:88-92`), read the two repeated fields via `form.getAll("second_preferred_genre_ids")` / `form.getAll("second_excluded_genre_ids")`, coerce to int arrays (reuse `toIntArray` or map `Number` over the string values). Drop any id present in both lists from the excluded list (mirror the disjoint rule in `SessionForm.tsx:46-77`). Construct `second: Taste | null` — `null` when **both** sanitized lists are empty (empty→solo fallback). The `Taste` type is already imported.

#### 2. Branch the engine call and discover hint on cardinality

**File**: `src/pages/api/recommendations.ts`

**Intent**: Pass `[taste, second]` to the engine when a second taste is present, and widen the discover hint to the union of both viewers' preferred genres so the candidate pool covers both. The engine handles everything downstream (compromise role, balance metric) for free.

**Contract**: Change the discover `genreIds` (`:107`) from `taste.preferred_genre_ids` to the **set-union** of `taste.preferred_genre_ids` and (when present) `second.preferred_genre_ids` — dedupe via a `Set`. Change the engine call (`:120`) from `recommend([taste], …)` to `recommend(second ? [taste, second] : [taste], …)`. Excluded genres remain scoring penalties, never discover filters (unchanged). No change to persistence (`:125-152`) — `pick.role` already carries `compromise` when produced.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Existing tests pass (recommendations route + engine): `npm test`

#### Manual Verification:

- POST to `/api/recommendations` with `session_id` only (no second fields) → unchanged solo picks (Safe / Crowd-pleaser / Wild card).
- POST with populated `second_*` fields → middle pick persists as `compromise`; results page shows "Compromise".
- POST with `second_*` fields present but empty → falls back to solo (no compromise role).
- DB inspection confirms no second-viewer genres are written to `movie_night_sessions` or any table.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Second-viewer island

### Overview

Add a React island beside the "Get recommendations" form: an "Add a second viewer" toggle that reveals two shared `GenrePicker`s and emits hidden `second_preferred_genre_ids` / `second_excluded_genre_ids` inputs **into that form**. Collapsing the toggle clears the second taste so nothing stale rides along.

### Changes Required:

#### 1. Second-viewer island component

**File**: `src/components/sessions/SecondViewer.tsx` (new)

**Intent**: Capture an optional, ephemeral second taste in the browser and surface it as hidden form inputs the plain recommendations POST can carry. Solo stays the default; the second viewer is opt-in and clears on opt-out.

**Contract**: A client island holding `enabled: boolean`, `preferred: Set<number>`, `excluded: Set<number>`. Renders an "Add a second viewer" toggle/button (collapsed by default). When enabled, render two `GenrePicker`s (from `./GenrePicker`) wired to a local `toggle(kind, id)` that keeps preferred/excluded mutually exclusive (same logic as `SessionForm.tsx:46-77`). When **enabled**, emit hidden inputs: `[...preferred].map(id => <input name="second_preferred_genre_ids" value={id} />)` and the excluded equivalent — matching the repeated-field pattern in `SessionForm.tsx:158-165`. When **disabled**, render no hidden inputs and clear `preferred`/`excluded` state so a later re-open starts blank (clears-on-off). Style to match the existing dark/glass UI (`sessions.astro` classes). No `<form>` of its own — it renders *inside* the recommendations form.

#### 2. Mount the island inside the recommendations form

**File**: `src/pages/sessions.astro`

**Intent**: Place the second-viewer island within the existing "Get recommendations" `<form>` so its hidden inputs are submitted alongside `session_id`.

**Contract**: Inside the `<form method="POST" action="/api/recommendations">` block (`:128-136`), between the hidden `session_id` input and the submit button, render `<SecondViewer client:load />`. Import `SecondViewer` from `@/components/sessions/SecondViewer` in the frontmatter. The island only appears in the `latest && (…)` "Your saved session" block, so it shows only when a session exists to recommend against.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Tests pass: `npm test`

#### Manual Verification:

- "Add a second viewer" toggle reveals two genre pickers; mutual exclusion between preferred/avoid works.
- Picking distinct genres for the second viewer and clicking "Get recommendations" yields a "Compromise" middle card.
- Toggling the second viewer off then getting recommendations reverts to solo picks (Crowd-pleaser middle card) — confirming clears-on-off.
- Three distinct picks come back for a typical duo combination (discover-union supply check).
- DB shows no second-viewer genres persisted anywhere.

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit / Integration Tests:

- Engine duo path is already covered by S-02's tests; no new engine tests needed.
- If the recommendations route has integration coverage, add a case asserting that `second_*` fields produce a `compromise` pick and that empty `second_*` fields fall back to solo. Otherwise this is covered by manual verification.

### Manual Testing Steps:

1. Solo run (no second viewer) → Safe / Crowd-pleaser / Wild card, unchanged.
2. Duo run with distinct second-viewer genres → Safe / Compromise / Wild card.
3. Enable second viewer, select nothing, run → solo fallback (no compromise).
4. Enable, select, then disable → run reverts to solo (clears-on-off proven).
5. Inspect `movie_night_sessions` and all tables → no second-viewer genres persisted.
6. Duo run with overlapping/broad genres → still ≥3 distinct picks.

## Performance Considerations

The discover-union strictly broadens the TMDB candidate pool (OR-union of genres), so the existing 3-page fetch supplies at least as many candidates as the solo path. No added latency beyond a slightly wider `with_genres` query.

## Migration Notes

None. No schema or data migration — the `compromise` role domain and display mapping already ship.

## References

- Research: `context/changes/optional-inline-second-viewer/research.md`
- Change identity: `context/changes/optional-inline-second-viewer/change.md`
- Engine cardinality branch: `src/lib/recommend/roles.ts:127-146`
- Recommendations API: `src/pages/api/recommendations.ts:88-120`
- Recommendations trigger form: `src/pages/sessions.astro:128-136`
- GenrePicker (to extract): `src/components/sessions/SessionForm.tsx:215-254`
- Repeated-field hidden-input pattern: `src/components/sessions/SessionForm.tsx:158-165`
- Discover genre union: `src/lib/tmdb-discover.ts:31-42`
- Role domain CHECK: `supabase/migrations/20260607073440_solo_role_crowd_pleaser.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract GenrePicker into a shared module

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — fd97dc9
- [x] 1.2 Linting passes: `npm run lint` — fd97dc9
- [x] 1.3 Existing tests pass: `npm test` — fd97dc9

#### Manual

- [ ] 1.4 `/sessions` form renders identically — both genre pickers work, preferred/avoid mutual exclusion intact

### Phase 2: API duo branch

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — 208b7c2
- [x] 2.2 Linting passes: `npm run lint` — 208b7c2
- [x] 2.3 Existing tests pass: `npm test` — 208b7c2

#### Manual

- [ ] 2.4 Solo POST (no second fields) → unchanged solo picks
- [ ] 2.5 Duo POST (populated second fields) → middle pick persists as `compromise` / "Compromise"
- [ ] 2.6 Second fields present but empty → solo fallback (no compromise role)
- [ ] 2.7 DB inspection: no second-viewer genres written anywhere

### Phase 3: Second-viewer island

#### Automated

- [x] 3.1 Type checking passes: `npm run build`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Tests pass: `npm test`

#### Manual

- [ ] 3.4 Toggle reveals two pickers; mutual exclusion works
- [ ] 3.5 Distinct second-viewer genres → "Compromise" middle card
- [ ] 3.6 Toggle off → reverts to solo (Crowd-pleaser) — clears-on-off proven
- [ ] 3.7 Three distinct picks return for a typical duo combination
- [ ] 3.8 DB shows no second-viewer genres persisted
