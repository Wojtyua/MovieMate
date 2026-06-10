# One-Shot Recommend Implementation Plan

## Overview

Collapse the two-click recommendation flow into a single "set tonight's preferences → see three picks" action, and retire the user-facing "save session / saved session" mental model. Today the user submits `SessionForm` (POST `/api/sessions`, which persists the session and reloads `/sessions?saved=<id>`), then clicks a second "Get recommendations" button in a separate block (POST `/api/recommendations`). After this change there is one form and one submit: the server persists the session invisibly, runs retrieval + scoring, and redirects straight to the picks — with a full-screen interstitial covering the work.

The session row stays persisted (the `recommendations.session_id NOT NULL` FK requires it) — only its *creation as a user step* is removed. Because this runs on the recommendations pipeline (test-plan Risk #1 "fewer than three picks" / Risk #2 graceful degradation), the merge must preserve those guarantees exactly.

## Current State Analysis

- **Two endpoints, sequential.** `/api/sessions` (`src/pages/api/sessions.ts`) validates the session fields (mood / intensity / genres / runtime / note), inserts **or** updates a `movie_night_sessions` row, and redirects `/sessions?saved=<id>`. `/api/recommendations` (`src/pages/api/recommendations.ts:48-179`) reloads that session by id, retrieves TMDB candidates, scores via `recommend()`, persists the run + picks, and redirects to `/sessions/<id>/recommendations`.
- **Two forms on the page.** `SessionForm` (`sessions.astro:91-103`) posts to `/api/sessions`. A separate "Your saved session" block (`sessions.astro:118-144`) holds a second `<form>` posting to `/api/recommendations`, containing the hidden `session_id`, the `SecondViewer` island, and the "Get recommendations" button.
- **The leaked mental model.** Copy like "Your saved session", "Recommendations use your saved preferences — save any changes above first" (`sessions.astro:121-123`) and the form's "Start session" / "Update session" / "Session saved" (`SessionForm.tsx:193,198`) present the session as an object the user manages.
- **Second viewer is already inline + ephemeral.** `SecondViewer.tsx` emits repeated `second_*` hidden fields read via `formData.getAll()` (`recommendations.ts:94-109`); never persisted. Direct precedent for posting form data straight into a recommend action.
- **Pending UI pattern exists.** `SubmitButton` (`src/components/auth/SubmitButton.tsx`) uses `useFormStatus()` from `react-dom`; the pending state already works during native form submission.
- **Edit mode.** `sessions.astro:44-47` re-fills the form from the latest session when `?saved=<id>` matches — the mechanism we will reuse (sourced differently) for error recovery.
- **No test harness yet.** Vitest is bootstrapped in `test-plan.md` §3 Phase 1 (change `testing-always-three-picks-core`, not yet implemented). Verification here is lint + `astro check` + build + manual runtime checks.

## Desired End State

- `/sessions` shows one form (preferences + optional second viewer). Submitting it shows a full-screen interstitial, then lands on `/sessions/<id>/recommendations` with three picks. There is no "save session" step, no "saved session" block, and no second button.
- Server-side, the single endpoint validates the fields, inserts a new session row, runs the pipeline, and redirects to the picks. On any pipeline failure it redirects back to `/sessions?error=…` with the form **pre-filled from the just-saved session** so tonight's inputs survive a retry.
- `/api/sessions` is gone; the consolidated endpoint owns the whole action. The retrieve + score + persist pipeline lives in a reusable `src/lib/recommend-run.ts` helper.
- The always-three-picks and external-edge fallback behaviors are byte-for-byte the same as today (same `recommend()` call, same error→redirect cases), just relocated.

Verify by: submitting the form once and landing on three picks; forcing a TMDB failure and confirming the form returns pre-filled with an error; confirming `/api/sessions` 404s and no "saved session" copy remains. `npm run lint`, `npx astro check`, `npm run build` pass.

### Key Discoveries:

- The pipeline's error/redirect cases (`recommendations.ts:113-176`: TMDB not configured, TMDB unreachable, empty candidates, empty picks, run-insert error, picks-insert error) all redirect to `/sessions?error=…` — they must be preserved exactly when extracted.
- `useFormStatus()` (`SubmitButton.tsx:12`) means the interstitial can be a sibling client component inside the same `<form>` that renders an overlay while `pending` — no manual submit-state wiring.
- Tonight's session genres ARE the taste (`recommendations.ts:88-92`, FR-008) — there is no `/profiles` precondition; a session with no genres still scores.
- The redirect target after a run is already `/sessions/<id>/recommendations` (`recommendations.ts:179`) — reused unchanged.

## What We're NOT Doing

- Not changing the scoring engine (`src/lib/recommend`), the `recommend()` contract, role rules, or any scoring weights.
- Not changing the database schema, the FK, or RLS. The session row is still persisted.
- Not changing the picks page (`sessions/[id]/recommendations.astro`) or its "← Back to session" link.
- Not building the AI note-understanding pipeline (S-04) — the note is still persisted but unused by retrieval.
- Not preserving an "edit / update an existing session" affordance or "Start another session" — both are retired.
- Not rendering picks inline (we keep POST-redirect-GET to the existing SSR picks page).
- Not adding automated tests (no harness yet; the Phase 1 extraction is structured so test-plan Phase 1 can pin it later).

## Implementation Approach

Refactor before behavior change. Phase 1 extracts the retrieve + score + persist pipeline into a lib helper with **no behavior change** — the existing two-step flow keeps working and the always-three-picks logic becomes an isolated unit. Phase 2 performs the user-visible flip atomically: the endpoint, the form, and the page change together so the app is coherent at the phase boundary (no half-migrated dual-mode endpoint).

## Critical Implementation Details

**State sequencing.** The endpoint must **persist the session row before running the pipeline** (the FK requires it, and the error-recovery design depends on it): insert session → run pipeline → on failure redirect to `/sessions?error=…` (the just-saved session is now the latest row). If the session insert itself fails, redirect with the error and let the page fall back to core-seeding.

**User experience spec.** The interstitial is a client component inside the `SessionForm` `<form>` that reads `useFormStatus().pending` and renders a fixed full-screen overlay ("Finding tonight's picks…") while the native POST is in flight. It naturally disappears when the browser navigates (to the picks page on success, or back to `/sessions` on error). Because it keys off `useFormStatus`, it also guards against double-submit alongside the already-disabled `SubmitButton`.

**Error-path seeding rule (sessions.astro).** Normally the form seeds from the taste core (fresh one-shot). When `?error=` is present, seed from the **latest session row** instead (the one just persisted) so the user's mood / genres / runtime / note survive. This is input preservation, not a return of "edit mode" — the "saved session" block stays gone.

## Phase 1: Extract the Recommendation Pipeline into a Lib Helper

### Overview

Move the retrieve + score + persist logic out of `/api/recommendations` into a reusable, behavior-preserving helper. The endpoint becomes a thin wrapper. No user-visible change.

### Changes Required:

#### 1. Pipeline helper

**File**: `src/lib/recommend-run.ts` (new)

**Intent**: Hold the "given a loaded session (+ optional second taste), retrieve candidates, score, and persist the run + picks" pipeline so both the (current) endpoint and the (Phase 2) consolidated endpoint call one implementation, and so the guarantee logic is unit-testable in isolation.

**Contract**: Export an async function taking the Supabase client, the authenticated `user`, the loaded session (id + scoring inputs + genre/runtime fields), and the optional second `Taste`; returning a discriminated result — success carrying the `recommendationId` (and/or the redirect target `/sessions/<id>/recommendations`), or a typed failure carrying the user-facing message for each existing case (TMDB not configured, TMDB unreachable, empty candidates, empty picks, run-insert error, picks-insert error). The helper performs the TMDB client creation, `fetchCandidates`, `recommend()`, and the `recommendations` + `recommendation_picks` inserts exactly as `recommendations.ts:111-176` does today. It does NOT call `context.redirect` — it returns data; the caller maps results to redirects.

#### 2. Endpoint delegates to the helper

**File**: `src/pages/api/recommendations.ts`

**Intent**: Replace the inline pipeline body with a call to the helper, preserving every current redirect.

**Contract**: After loading the session and parsing the optional second viewer (unchanged, `:63-109`), call the helper and map its result to the existing redirects — success → `context.redirect('/sessions/<id>/recommendations')`; each failure → `redirectError(context, '/sessions', <message>)`. The route's external behavior (status codes, redirect URLs, messages) is identical to before.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Type/template check passes: `npx astro check`
- [ ] Production build succeeds: `npm run build`

#### Manual Verification:

- [ ] The existing two-step flow still works end-to-end: start a session, then "Get recommendations", and land on three picks.
- [ ] A forced TMDB failure still redirects back to `/sessions` with the same error message as before.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: One-Shot Flip (Endpoint + UI Together)

### Overview

Make a single submit persist the session and run the pipeline, redirect to the picks, retire the "saved session" model, and add the interstitial. Endpoint, form, and page change together; `/api/sessions` is deleted.

### Changes Required:

#### 1. Consolidated one-shot endpoint

**File**: `src/pages/api/recommendations.ts`

**Intent**: Accept the full preference form, validate it, insert a new session row, then run the pipeline (Phase 1 helper) — one action, one redirect.

**Contract**: The POST reads the same field set `/api/sessions` validated (mood, intensity, preferred/excluded genre ids, runtime, note) using the same validation rules (reuse the parsing/validation from `sessions.ts` — move it here or into a small shared parser). On valid input: insert a new `movie_night_sessions` row (`user_id` + fields), then build the `taste` from that row, parse the optional second viewer (existing `:94-109`), and call the Phase 1 helper. Success → redirect `/sessions/<id>/recommendations`. Validation failure or any helper failure → `redirectError(context, '/sessions', <message>)`. No `session_id` input path / no update branch (edit mode is retired). Auth + Supabase-config guards unchanged.

#### 2. Delete the standalone session endpoint

**File**: `src/pages/api/sessions.ts`

**Intent**: Remove the now-unused save endpoint; its validation lives in the consolidated endpoint.

**Contract**: Delete the file. Confirm nothing else references `/api/sessions` (only `SessionForm` did).

#### 3. SessionForm → one-shot

**File**: `src/components/sessions/SessionForm.tsx`

**Intent**: Make this the single form for the whole action: post to the consolidated endpoint, include the second viewer, show the interstitial, and drop the edit-mode affordances and "save" language.

**Contract**: Change `action` to the consolidated endpoint (`/api/recommendations`). Remove the `sessionId` hidden input and the `editing` / "Update session" / "Start another session" / `justSaved` "Session saved" branches. Render `<SecondViewer />` inside the form (above the submit). Submit button label → tonight-picks framing (e.g. "Get tonight's picks"), `pendingText` → "Finding tonight's picks…". Keep `ServerError`. Keep the genre/mood/runtime/note fields and the disjoint-set toggle logic. The `prefilledFromCore` hint stays.

#### 4. Interstitial overlay

**File**: `src/components/sessions/Interstitial.tsx` (new), used inside `SessionForm`

**Intent**: Cover the multi-second retrieval+scoring wait with a branded full-screen overlay.

**Contract**: A client component that reads `useFormStatus().pending` and, when pending, renders a fixed full-screen cosmic-styled overlay with a spinner and "Finding tonight's picks…". Must be rendered **inside** the `<form>` so `useFormStatus` sees the submission. No props required.

#### 5. sessions.astro → single form, error-refill seeding, retire copy

**File**: `src/pages/sessions.astro`

**Intent**: Remove the saved-session block and the edit-mode logic; seed the form from the core normally and from the just-saved session on error; drop "save session" language.

**Contract**: Remove the "Your saved session" block (`:118-144`), the `SecondViewer` import (now inside `SessionForm`), and `hasRecommendation`. Replace the `editSession`/`savedId`/`justSaved` logic with: if `?error=` is present, load the latest session row and seed the form fields from it (input preservation); otherwise seed genres from the taste core as today. Update the intro copy to the one-shot framing (no "save"/"saved session" wording). Keep the `noCore` hint. The page still renders inside the Phase-1 `Layout` shell (`<div class="p-4">…`).

### Success Criteria:

#### Automated Verification:

- [ ] No remaining references to `/api/sessions`: `grep -rn "/api/sessions" src` is empty.
- [ ] No remaining "saved session" / "Get recommendations" copy on the form page: `grep -rni "saved session\|Get recommendations" src/pages/sessions.astro` is empty.
- [ ] Linting passes: `npm run lint`
- [ ] Type/template check passes: `npx astro check`
- [ ] Production build succeeds: `npm run build`

#### Manual Verification:

- [ ] From `/sessions`, one submit shows the interstitial and lands on `/sessions/<id>/recommendations` with three picks (solo path).
- [ ] Adding a second viewer and submitting yields duo picks (safe / compromise / wild card).
- [ ] A forced TMDB / pipeline failure returns to `/sessions` with an error AND the form pre-filled with the just-entered mood / genres / runtime / note.
- [ ] `/api/sessions` returns 404; no "saved session" block or second button remains anywhere on `/sessions`.
- [ ] The interstitial appears during the wait and disappears on arrival; the submit button can't be double-fired.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

No automated harness exists yet (Vitest arrives in test-plan §3 Phase 1). Phase 1 is deliberately structured to leave the always-three-picks pipeline as an isolated `recommend-run.ts` unit that those future tests can pin. Verification for this change is the quality gates plus manual runtime checks.

### Manual Testing Steps:

1. Solo: set preferences, submit once → interstitial → three picks.
2. Duo: add a second viewer, submit → duo-labeled picks.
3. Failure: simulate TMDB unreachable (or no matching films) → back on `/sessions` with error + preserved inputs; resubmit succeeds.
4. Confirm `/api/sessions` 404s and no "save/saved session" copy or second button remains.
5. Confirm the picks page and its "← Back to session" link still work.

## Performance Considerations

No new latency: the same single TMDB retrieval + scoring runs, now in one request instead of two (one fewer round-trip + page reload). The interstitial is pure client rendering keyed off `useFormStatus`.

## Migration Notes

No data migration. Existing sessions and recommendation runs are unaffected. Stale bookmarks to `/api/sessions` will 404 (it was never a navigable page). Each one-shot submit inserts a new session row (same as "Start session" today); no update path.

## References

- Frame brief: `context/changes/one-shot-recommend/frame.md`
- Change identity: `context/changes/one-shot-recommend/change.md`
- Pipeline + guarantees: `context/foundation/test-plan.md` §2 Risk #1 / #2
- Current pipeline: `src/pages/api/recommendations.ts:111-179`
- Current validation: `src/pages/api/sessions.ts:28-126`
- Pending-state precedent: `src/components/auth/SubmitButton.tsx`
- Second-viewer inline precedent: `src/components/sessions/SecondViewer.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract the Recommendation Pipeline into a Lib Helper

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — e63a930
- [x] 1.2 Type/template check passes: `npx astro check` — e63a930
- [x] 1.3 Production build succeeds: `npm run build` — e63a930

#### Manual

- [x] 1.4 Existing two-step flow still works end-to-end → three picks — superseded by p2 (two-step flow retired); verified via 2.6
- [x] 1.5 Forced TMDB failure still redirects to `/sessions` with the same error message — superseded by p2; verified via 2.8

### Phase 2: One-Shot Flip (Endpoint + UI Together)

#### Automated

- [x] 2.1 No remaining `/api/sessions` references: `grep -rn "/api/sessions" src` is empty — 130ed3b
- [x] 2.2 No "saved session" / "Get recommendations" copy: `grep -rni "saved session\|Get recommendations" src/pages/sessions.astro` is empty — 130ed3b
- [x] 2.3 Linting passes: `npm run lint` — 130ed3b
- [x] 2.4 Type/template check passes: `npx astro check` — 130ed3b
- [x] 2.5 Production build succeeds: `npm run build` — 130ed3b

#### Manual

- [x] 2.6 One submit → interstitial → three picks (solo) — 130ed3b
- [x] 2.7 Second viewer → duo picks (safe / compromise / wild card) — 130ed3b
- [x] 2.8 Pipeline failure → back on `/sessions` with error + form pre-filled with just-entered inputs; resubmit succeeds — 130ed3b
- [x] 2.9 `/api/sessions` 404s; no saved-session block or second button remains — 130ed3b
- [x] 2.10 Interstitial shows during the wait and clears on arrival; no double-submit — 130ed3b (overlay too brief to observe on near-instant responses; component correctly gated on useFormStatus pending)
